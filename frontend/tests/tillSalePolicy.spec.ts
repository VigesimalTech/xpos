/**
 * K19: the till checks a sale against the cashier's rights before taking payment, with
 * the rules the server applies again when it syncs (xpos/api/sale_policy.py), and says
 * what a manager would have to approve.
 */
import { describe, expect, it } from "vitest";
import { saleNeeds, type SaleLine } from "@/services/tillSalePolicy";

const NO_RIGHTS = {
	allow_change_price: false,
	show_edit_discount_field: false,
	apply_additional_discount: false,
	sale_return: false,
};
const ALL_RIGHTS = {
	allow_change_price: true,
	show_edit_discount_field: true,
	apply_additional_discount: true,
	sale_return: true,
};

const line = (extra: Partial<SaleLine> = {}): SaleLine => ({
	item_code: "ITEM-A",
	qty: 1,
	rate: 100,
	...extra,
});

function needs(
	lines: SaleLine[],
	{ rights = NO_RIGHTS, limit = 0, profileMax = 100, cartPct = 0, isReturn = false } = {},
) {
	return saleNeeds(
		{ lines, cartDiscountPct: cartPct, isReturn },
		{ rights, discountLimit: limit, profileMaxDiscount: profileMax },
	);
}

describe("K19: what a sale needs a manager to approve", () => {
	it("a plain sale at the list price needs nothing", () => {
		expect(needs([line(), line({ item_code: "ITEM-B", rate: 50 })])).toEqual({
			permissions: [],
			discountPct: 0,
			reasons: [],
		});
	});

	it("a line discount within the cashier's limit and rights needs nothing", () => {
		expect(needs([line({ discount_percentage: 10 })], { rights: ALL_RIGHTS, limit: 10 }).reasons).toEqual(
			[],
		);
	});

	it("a line discount over the limit needs the discount approved", () => {
		const n = needs([line({ discount_percentage: 25 })], { rights: ALL_RIGHTS, limit: 10 });
		expect(n.discountPct).toBe(25);
		expect(n.permissions).toEqual([]);
		expect(n.reasons.join(" ")).toContain("25% off");
	});

	it("any discount without the Edit Discount permission needs that permission", () => {
		const n = needs([line({ discount_percentage: 5 })], { limit: 10 });
		expect(n.permissions).toEqual(["show_edit_discount_field"]);
		expect(n.discountPct).toBe(5);
	});

	it("0 means no discount without a manager", () => {
		expect(needs([line({ discount_amount: 1 })], { rights: ALL_RIGHTS, limit: 0 }).discountPct).toBe(1);
	});

	it("a price below the list price counts as a discount, and needs Change Price", () => {
		const n = needs([line({ rate: 80, list_rate: 100 })], { limit: 50 });
		expect(n.permissions).toEqual(["allow_change_price"]);
		expect(n.discountPct).toBe(20);
	});

	it("a cart discount needs Apply Additional Discount and counts against the limit", () => {
		const n = needs([line()], {
			rights: { ...NO_RIGHTS, show_edit_discount_field: true },
			limit: 10,
			cartPct: 15,
		});
		expect(n.permissions).toEqual(["apply_additional_discount"]);
		expect(n.discountPct).toBe(15);
	});

	it("discounts each within the limit can add up past it", () => {
		const n = needs([line({ discount_percentage: 10 })], { rights: ALL_RIGHTS, limit: 10, cartPct: 10 });
		expect(n.discountPct).toBe(19);
	});

	it("the POS Profile's maximum caps the cashier's limit", () => {
		expect(
			needs([line({ discount_percentage: 15 })], { rights: ALL_RIGHTS, limit: 30, profileMax: 10 })
				.discountPct,
		).toBe(15);
	});

	it("a return needs Sale Return", () => {
		expect(needs([line({ qty: -1 })], { isReturn: true }).permissions).toEqual(["sale_return"]);
	});

	it("free items are not discounts", () => {
		expect(needs([line({ is_free_item: true, rate: 0, list_rate: 100 })]).reasons).toEqual([]);
	});
});
