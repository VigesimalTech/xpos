/**
 * The till's audit log (K20): what happened here that leaves no sale behind. A line
 * deleted or a quantity lowered, a sale cleared, a held order discarded, a receipt
 * printed again, a manager's approval, a wrong PIN.
 *
 * Every event is written to the local database first, online or not, and the sync
 * engine sends them to ERPNext (xpos.api.audit.sync_audit_events). Recording never
 * throws: a till must go on selling if the log cannot be written.
 *
 * Approvals and wrong PINs are recorded here in the main process, where every PIN is
 * checked, so no screen can forget them; the renderer may record only what happens
 * in its screens (RENDERER_EVENTS).
 */
import crypto from "crypto";
import { ipcMain } from "electron";
import { execute, queryOne } from "../database/dbService";
import { createLogger } from "../logger";

const log = createLogger("Audit");

export type AuditEventType =
	| "line_removed"
	| "qty_lowered"
	| "sale_cleared"
	| "held_order_discarded"
	| "reprint"
	| "approval"
	| "pin_failed";

/** What the renderer may record. Approvals and wrong PINs come from the main process only. */
export const RENDERER_EVENTS: ReadonlySet<string> = new Set([
	"line_removed",
	"qty_lowered",
	"sale_cleared",
	"held_order_discarded",
	"reprint",
]);

export interface AuditEvent {
	event_type: AuditEventType;
	pos_profile?: string | null;
	/** The till's own shift id (pos_opening_shifts.id). */
	shift?: string | number | null;
	/** Who was signed in on the till. */
	cashier?: string | null;
	/** The manager who approved it with their PIN. */
	approved_by?: string | null;
	/** For a wrong PIN: whose PIN was tried. */
	pin_user?: string | null;
	item_code?: string | null;
	item_name?: string | null;
	qty?: number | null;
	amount?: number | null;
	/** The invoice or held order it concerns. */
	reference?: string | null;
	description?: string | null;
	details?: unknown;
}

function text(value: unknown, length: number): string | null {
	if (value === undefined || value === null || value === "") return null;
	return String(value).slice(0, length);
}

function number(value: unknown): number | null {
	const n = Number(value);
	return value === undefined || value === null || value === "" || !Number.isFinite(n) ? null : n;
}

/** Write one event to the local log. Returns its local id, or null if it could not be written. */
export async function recordAuditEvent(event: AuditEvent): Promise<string | null> {
	const localId = crypto.randomUUID();
	try {
		const shift = number(event.shift);
		await execute(
			`INSERT INTO \`audit_events\`
			   (\`local_id\`, \`event_type\`, \`event_time\`, \`pos_profile\`, \`pos_opening_entry_id\`,
			    \`cashier\`, \`approved_by\`, \`pin_user\`, \`item_code\`, \`item_name\`, \`qty\`, \`amount\`,
			    \`reference\`, \`description\`, \`details\`)
			 VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				localId,
				event.event_type,
				text(event.pos_profile, 255),
				shift === null ? null : Math.trunc(shift),
				text(event.cashier, 255),
				text(event.approved_by, 255),
				text(event.pin_user, 255),
				text(event.item_code, 255),
				text(event.item_name, 255),
				number(event.qty),
				number(event.amount),
				text(event.reference, 255),
				text(event.description, 1000),
				event.details === undefined || event.details === null
					? null
					: JSON.stringify(event.details).slice(0, 60_000),
			],
		);
		return localId;
	} catch (err) {
		log.error(`Could not record ${event.event_type} in the audit log`, err);
		return null;
	}
}

/**
 * A wrong PIN, at sign-in or for an approval. `pinUser` is whose PIN was tried, as the
 * till knows them; an unknown name is not logged, since no one's PIN was checked.
 */
export async function recordPinFailure(
	pinUser: string,
	result: { reason?: string; attemptsLeft?: number },
	context: { for: "sign_in" | "approval"; cashier?: string; pos_profile?: string; shift?: string | number },
): Promise<void> {
	if (result.reason !== "wrong_pin" && result.reason !== "locked") return;
	const user = await queryOne<{ name: string; pos_profile: string | null }>(
		"SELECT `name`, `pos_profile` FROM `pos_users` WHERE `username` = ? OR `name` = ?",
		[pinUser, pinUser],
	).catch(() => null);
	if (!user) return;
	await recordAuditEvent({
		event_type: "pin_failed",
		pin_user: user.name,
		cashier: context.cashier ?? null,
		pos_profile: context.pos_profile || user.pos_profile,
		shift: context.shift ?? null,
		description:
			result.reason === "locked"
				? `Wrong PIN (${context.for.replace("_", " ")}): locked`
				: `Wrong PIN (${context.for.replace("_", " ")}), ${result.attemptsLeft ?? 0} tries left`,
		details: { for: context.for, reason: result.reason, attempts_left: result.attemptsLeft },
	});
}

export function registerAuditHandlers(): void {
	ipcMain.handle("audit:record", async (_e, event: AuditEvent) => {
		if (!event || !RENDERER_EVENTS.has(event.event_type)) {
			log.warn(`Refused an audit event from the renderer: ${event?.event_type}`);
			return null;
		}
		return recordAuditEvent(event);
	});
}
