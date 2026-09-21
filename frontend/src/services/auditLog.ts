/**
 * The till's audit log (K20), from the screens: what the cashier did that leaves no
 * sale behind. Each event is written to the till's database and synced to ERPNext
 * (electron/audit). Approvals and wrong PINs are recorded by the main process itself.
 *
 * Desktop only, and never in the way of the sale: it does not wait and never throws.
 * The web POS has no local log.
 */
import { isElectron, type AuditRecord } from "@/services/electronBridge";
import { useAuthStore } from "@/stores/authStore";
import { usePosStore } from "@/stores/posStore";

export type AuditEntry = Omit<AuditRecord, "cashier" | "pos_profile" | "shift">;

export function recordAudit(entry: AuditEntry): void {
	if (!isElectron() || !window.electronAPI?.audit) return;
	try {
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
