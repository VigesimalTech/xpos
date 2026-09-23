/**
 * The audit log (K20), from the screens: what the cashier did that leaves no sale
 * behind.
 *
 * On the desktop till each event is written to the till's database and synced to ERPNext
 * (electron/audit); approvals and wrong PINs are recorded by the main process itself.
 *
 * On the web POS (K38) the page sends each event to ERPNext itself. While ERPNext cannot be
 * reached, events wait in the browser and go with the next one, or when the connection
 * returns. The server takes the cashier from the session, never from the event.
 *
 * Never in the way of the sale: it does not wait and never throws.
 */
import { isElectron, type AuditRecord } from "@/services/electronBridge";
import { useAuthStore } from "@/stores/authStore";
import { usePosStore } from "@/stores/posStore";
import { call } from "@/services/api";

export type AuditEntry = Omit<AuditRecord, "cashier" | "pos_profile" | "shift">;

const WEB_QUEUE_KEY = "xpos_web_audit_queue";
const WEB_METHOD = "xpos.api.audit.record_web_audit_events";

interface WebEvent {
	local_id: string;
	event_type: string;
	event_time: string;
	pos_profile: string | null;
	pos_opening_shift: string | null;
	item_code?: string | null;
	item_name?: string | null;
	qty?: number | null;
	amount?: number | null;
	reference?: string | null;
	description?: string | null;
}

function readQueue(): WebEvent[] {
	try {
		const raw = localStorage.getItem(WEB_QUEUE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeQueue(events: WebEvent[]): void {
	try {
		if (events.length) localStorage.setItem(WEB_QUEUE_KEY, JSON.stringify(events));
		else localStorage.removeItem(WEB_QUEUE_KEY);
	} catch {
		// Storage refused (private window, quota): the event cannot wait, but the sale goes on.
	}
}

function nowForServer(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
		d.getMinutes(),
	)}:${pad(d.getSeconds())}`;
}

let flushing: Promise<void> | null = null;

/** Send the web POS's waiting events. Those ERPNext accepted leave the queue. */
export function flushWebAudit(): Promise<void> {
	if (isElectron()) return Promise.resolve();
	flushing ??= (async () => {
		try {
			const queue = readQueue();
			if (!queue.length) return;
			const { accepted } = await call<{ accepted: string[] }>(WEB_METHOD, { events: queue });
			const done = new Set(accepted || []);
			writeQueue(readQueue().filter((e) => !done.has(e.local_id)));
		} catch (err) {
			console.warn("Audit log: will send again later", err);
		} finally {
			flushing = null;
		}
	})();
	return flushing;
}

let listening = false;

function recordOnWeb(entry: AuditEntry): void {
	// Events left waiting go when the connection returns, not only with the next one.
	if (!listening) {
		listening = true;
		window.addEventListener("online", () => void flushWebAudit());
	}
	const pos = usePosStore();
	const event: WebEvent = {
		local_id: crypto.randomUUID(),
		event_type: entry.event_type,
		event_time: nowForServer(),
		pos_profile: pos.posProfile?.name ?? null,
		pos_opening_shift: pos.posOpeningShift?.name ?? null,
		item_code: entry.item_code ?? null,
		item_name: entry.item_name ?? null,
		qty: entry.qty ?? null,
		amount: entry.amount ?? null,
		reference: entry.reference ?? null,
		description: entry.description ?? null,
	};
	writeQueue([...readQueue(), event]);
	void flushWebAudit();
}

export function recordAudit(entry: AuditEntry): void {
	try {
		if (!isElectron()) {
			recordOnWeb(entry);
			return;
		}
		if (!window.electronAPI?.audit) return;
		const pos = usePosStore();
		const event: AuditRecord = {
			...entry,
			cashier: useAuthStore().userName,
			pos_profile: pos.posProfile?.name ?? null,
			shift: pos.posOpeningShift?.name ?? null,
		};
		// Plain data: IPC refuses Vue's reactive proxies (K13).
		void window.electronAPI.audit
			.record(JSON.parse(JSON.stringify(event)))
			.catch((err) => console.error("Audit log:", err));
	} catch (err) {
		console.error("Audit log:", err);
	}
}
