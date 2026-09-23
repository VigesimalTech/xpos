/**
 * What this till holds that ERPNext does not have yet (K40): sales, held orders,
 * purchases, shifts and their closes, cash movements, stock adjustments and audit events.
 * Clearing the till's pending data is refused while any of it is here, whoever asks: a
 * paid sale must never vanish from the till before ERPNext has it.
 */

type Query = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface UnsentRecords {
	sales: number;
	held_orders: number;
	purchases: number;
	shifts: number;
	closes: number;
	cash_movements: number;
	stock_adjustments: number;
	audit_events: number;
	total: number;
}

const NOT_SENT = "`sync_status` <> 'synced'";

export async function countUnsent(
	query: Query,
	isHeldOrder: (data: unknown) => boolean,
): Promise<UnsentRecords> {
	const count = async (sql: string) => Number((await query<{ n: number }>(sql))[0]?.n || 0);

	// A sale ERPNext refused (dead_letter) is still unsent: a manager must settle it.
	const invoices = await query<{ data: unknown }>(
		"SELECT `data` FROM `pending_invoices` WHERE `status` IN ('pending', 'syncing', 'failed', 'dead_letter')",
	);
	const heldOrders = invoices.filter((row) => isHeldOrder(row.data)).length;

	const counts = {
		sales: invoices.length - heldOrders,
		held_orders: heldOrders,
		purchases: await count("SELECT COUNT(*) AS n FROM `pending_purchases` WHERE `status` <> 'synced'"),
		shifts: await count(`SELECT COUNT(*) AS n FROM \`pos_opening_shifts\` WHERE ${NOT_SENT}`),
		closes: await count(`SELECT COUNT(*) AS n FROM \`pos_closing_entries\` WHERE ${NOT_SENT}`),
		cash_movements:
			(await count(`SELECT COUNT(*) AS n FROM \`expenses\` WHERE ${NOT_SENT}`)) +
			(await count(`SELECT COUNT(*) AS n FROM \`bank_drops\` WHERE ${NOT_SENT}`)),
		stock_adjustments: await count(`SELECT COUNT(*) AS n FROM \`stock_adjustments\` WHERE ${NOT_SENT}`),
		audit_events: await count(`SELECT COUNT(*) AS n FROM \`audit_events\` WHERE ${NOT_SENT}`),
	};
	return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** What the till says when it will not clear: each kind of record waiting, in words. */
export function describeUnsent(unsent: UnsentRecords): string {
	const parts: [number, string, string][] = [
		[unsent.sales, "sale", "sales"],
		[unsent.held_orders, "held order", "held orders"],
		[unsent.purchases, "purchase", "purchases"],
		[unsent.shifts, "shift", "shifts"],
		[unsent.closes, "shift close", "shift closes"],
		[unsent.cash_movements, "cash movement", "cash movements"],
		[unsent.stock_adjustments, "stock adjustment", "stock adjustments"],
		[unsent.audit_events, "audit event", "audit events"],
	];
	return parts
		.filter(([n]) => n > 0)
		.map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
		.join(", ");
}
