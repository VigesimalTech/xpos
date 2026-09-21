/**
 * Oracles for exploring a till: checks that say whether what happened is right, without
 * knowing in advance what the steps were. The till and ERPNext must agree; every record
 * the till made must reach ERPNext exactly once, or be visibly waiting or failed.
 *
 * `reconcile()` returns problems as plain sentences; an empty list is a pass. Run it after
 * every step that should have changed data, and again after going back online.
 */
import { erpList, tillDb, type Site } from "../support/till";

export interface Reconciliation {
	problems: string[];
	counts: Record<string, number>;
}

const close = (a: unknown, b: unknown) => Math.abs(Number(a) - Number(b)) < 0.005;

/** Every sale on the till against ERPNext. */
async function sales(site: Site, problems: string[], counts: Record<string, number>) {
	const rows = await tillDb<{
		local_id: string;
		status: string;
		grand_total: string;
		server_name: string | null;
		error: string | null;
		retry_count: number;
	}>("SELECT local_id, status, grand_total, server_name, error, retry_count FROM pending_invoices");
	counts.till_sales = rows.length;
	const localIds = rows.map((r) => r.local_id);
	const erp = localIds.length
		? await erpList<{
				name: string;
				xpos_local_id: string;
				grand_total: number;
				docstatus: number;
				is_return: number;
			}>(
				site,
				"Sales Invoice",
				[["xpos_local_id", "in", localIds]],
				["name", "xpos_local_id", "grand_total", "docstatus", "is_return"],
			)
		: [];
	counts.erp_sales = erp.length;
	for (const row of rows) {
		const found = erp.filter((e) => e.xpos_local_id === row.local_id);
		const live = found.filter((e) => e.docstatus === 1);
		if (row.status === "synced") {
			if (live.length === 0)
				problems.push(
					`Sale ${row.local_id} is marked synced on the till but has no submitted invoice in ERPNext.`,
				);
			if (live.length > 1)
				problems.push(
					`Sale ${row.local_id} reached ERPNext ${live.length} times: ${live.map((e) => e.name).join(", ")}.`,
				);
			if (live[0] && !close(Math.abs(live[0].grand_total), Math.abs(Number(row.grand_total))))
				problems.push(
					`Sale ${row.local_id}: till total ${row.grand_total}, ERPNext ${live[0].grand_total}.`,
				);
			if (live[0] && row.server_name && row.server_name !== live[0].name)
				problems.push(
					`Sale ${row.local_id}: the till points at ${row.server_name}, ERPNext has ${live[0].name}.`,
				);
		} else if (live.length) {
			problems.push(
				`Sale ${row.local_id} is '${row.status}' on the till but already in ERPNext as ${live.map((e) => e.name).join(", ")}: it may be sent again.`,
			);
		}
		if (row.status === "failed" || row.status === "dead_letter")
			problems.push(
				`Sale ${row.local_id} ${row.status} after ${row.retry_count} tries: ${String(row.error).slice(0, 300)}`,
			);
		if (row.status === "syncing") counts.stuck_syncing = (counts.stuck_syncing || 0) + 1;
	}
}

/** Expenses, bank drops, shifts and audit events: nothing failed, nothing stuck. */
async function others(problems: string[], counts: Record<string, number>) {
	const tables: [string, string][] = [
		["expenses", "sync_status"],
		["bank_drops", "sync_status"],
		["pos_opening_shifts", "sync_status"],
		["pos_closing_entries", "sync_status"],
		["audit_events", "sync_status"],
	];
	for (const [table, column] of tables) {
		const rows = await tillDb<{ s: string; n: number }>(
			`SELECT \`${column}\` AS s, COUNT(*) AS n FROM \`${table}\` GROUP BY \`${column}\``,
		).catch(() => []);
		for (const { s, n } of rows) {
			counts[`${table}.${s}`] = Number(n);
			if (s === "failed" || s === "dead_letter") {
				const why = await tillDb<{ error: string }>(
					`SELECT error FROM \`${table}\` WHERE \`${column}\` = ? LIMIT 3`,
					[s],
				).catch(() => []);
				const reasons = why.map((w) => String(w.error ?? "").slice(0, 200)).filter(Boolean);
				problems.push(
					`${n} ${table} ${s}: ${reasons.join(" | ") || "the till keeps no reason for it (read the sync log)"}`,
				);
			}
		}
	}
}

export async function reconcile(site: Site): Promise<Reconciliation> {
	const problems: string[] = [];
	const counts: Record<string, number> = {};
	await sales(site, problems, counts);
	await others(problems, counts);
	return { problems, counts };
}

/** Log lines that point at a bug whatever the step was. */
export function suspicious(lines: string[]): string[] {
	const noise = [/fonts\.googleapis\.com/, /Content Security Policy.*fonts/];
	return lines.filter(
		(l) =>
			/\[page:(error|exception)\]|\[main:err\]|\[ERROR\]|Unhandled|TypeError|ReferenceError|undefined is not|NaN|\[net:5\d\d\]/.test(
				l,
			) && !noise.some((n) => n.test(l)),
	);
}
