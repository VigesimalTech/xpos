/**
 * Sales of a shift that ERPNext refused (dead-lettered after its answers): paid at the
 * till, so their cash is in the drawer, but not in ERPNext and not in the shift's close.
 * The close says so, and sends the list for ERPNext to note on the closing (decided
 * 21 Sep 2026, option A: the close goes without them, honestly).
 */
export interface RefusedSale {
	local_id: string;
	grand_total: number;
	error: string;
}

export function refusedOf(
	rows: { status: string; local_id: string; grand_total: unknown; error: unknown }[],
): RefusedSale[] {
	return rows
		.filter((r) => r.status === "dead_letter")
		.map((r) => ({
			local_id: r.local_id,
			grand_total: Number(r.grand_total) || 0,
			error: String(r.error ?? ""),
		}));
}
