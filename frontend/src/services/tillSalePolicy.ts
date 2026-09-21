/**
 * What a sale needs a manager to approve (K19), checked on the till before payment.
 *
 * The same rules the server applies to every synced sale (xpos/api/sale_policy.py
 * `policy_exceptions`): the cashier's POS Role permissions for a price change, a line
 * discount, a cart discount and a return; and their discount limit, the lower of their
 * own and the POS Profile's maximum (0 means none, 100 no cap), against each line, the
 * cart discount and the sale's discount in total. A price below the list counts as a
 * discount. The result is what one approval must cover: the permissions, and the
 * largest discount on the sale.
 */
import { __ } from "@/lib/translate";

export interface SaleLine {
	item_code: string;
	qty: number;
	rate: number;
	/** The price-list rate, when the cashier changed the price. */
	list_rate?: number;
	discount_percentage?: number;
	discount_amount?: number;
	is_free_item?: boolean;
}

export interface SaleForPolicy {
	lines: SaleLine[];
	cartDiscountPct: number;
	isReturn: boolean;
}

export interface CashierRights {
	rights: Partial<
		Record<
			"allow_change_price" | "show_edit_discount_field" | "apply_additional_discount" | "sale_return",
			boolean
		>
	>;
	discountLimit: unknown;
	profileMaxDiscount: unknown;
}

export interface SaleNeeds {
	permissions: string[];
	/** The largest discount on the sale, in percent, when anything needs approval. */
	discountPct: number;
	reasons: string[];
}

const TOLERANCE = 0.005;

function pct(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n: number) => String(round2(n));

export function saleNeeds(sale: SaleForPolicy, cashier: CashierRights): SaleNeeds {
	const limit = Math.min(pct(cashier.discountLimit), pct(cashier.profileMaxDiscount));
	const permissions = new Set<string>();
	const reasons: string[] = [];
	let overLimit = false;
	let largest = 0;
	let listTotal = 0;
	let netTotal = 0;

	if (sale.isReturn && !cashier.rights.sale_return) {
		permissions.add("sale_return");
		reasons.push(__("A return"));
	}

	for (const line of sale.lines) {
		if (line.is_free_item) continue;
		const qty = Math.abs(Number(line.qty) || 0);
		const rate = Number(line.rate) || 0;
		const discPct = Number(line.discount_percentage) || 0;
		const discAmt = Number(line.discount_amount) || 0;
		const base = line.list_rate !== undefined ? Number(line.list_rate) : rate;
		const paid = discPct ? rate * (1 - discPct / 100) : discAmt ? rate - discAmt : rate;

		if (
			line.list_rate !== undefined &&
			Math.abs(rate - base) > TOLERANCE &&
			!cashier.rights.allow_change_price
		) {
			permissions.add("allow_change_price");
			reasons.push(__("{0}: price changed from {1} to {2}", [line.item_code, fmt(base), fmt(rate)]));
		}
		if ((discPct || discAmt) && !cashier.rights.show_edit_discount_field) {
			permissions.add("show_edit_discount_field");
			reasons.push(__("{0}: a discount", [line.item_code]));
		}
		if (base > 0) {
			const linePct = ((base - paid) / base) * 100;
			largest = Math.max(largest, linePct);
			if (linePct > limit + TOLERANCE) {
				overLimit = true;
				reasons.push(
					__("{0}: {1}% off, over your limit of {2}%", [line.item_code, fmt(linePct), fmt(limit)]),
				);
			}
		}
		listTotal += base * qty;
		netTotal += paid * qty;
	}

	const cartPct = Number(sale.cartDiscountPct) || 0;
	if (cartPct > TOLERANCE) {
		largest = Math.max(largest, cartPct);
		if (!cashier.rights.apply_additional_discount) {
			permissions.add("apply_additional_discount");
			reasons.push(__("A cart discount"));
		}
		if (cartPct > limit + TOLERANCE) {
			overLimit = true;
			reasons.push(__("A {0}% cart discount, over your limit of {1}%", [fmt(cartPct), fmt(limit)]));
		}
	}

	if (listTotal > 0) {
		const totalPct = ((listTotal - netTotal * (1 - cartPct / 100)) / listTotal) * 100;
		largest = Math.max(largest, totalPct);
		if (!overLimit && totalPct > limit + TOLERANCE) {
			reasons.push(__("{0}% off in total, over your limit of {1}%", [fmt(totalPct), fmt(limit)]));
		}
	}

	return {
		permissions: [...permissions],
		discountPct: reasons.length ? round2(largest) : 0,
		reasons,
	};
}
