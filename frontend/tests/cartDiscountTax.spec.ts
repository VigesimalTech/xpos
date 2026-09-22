/**
 * @vitest-environment jsdom
 *
 * The cart's discount with tax, as ERPNext books it (taxes_and_totals.apply_discount_amount):
 * the discount lowers every line's net amount by one factor, and the tax charged at a rate
 * with it. Numbers from a real ERPNext (bug hunt, 22 Sep 2026): 3 x 33.33, 5% VAT, 10% off
 * the grand total booked net 89.99, VAT 4.50, grand 94.49. The till printed VAT 5.00.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/services/userRights", () => ({ hasPermission: () => true, getDiscountLimit: () => 100 }));
const pos = vi.hoisted(() => ({
	taxes: [
		{
			description: "VAT",
			charge_type: "On Net Total",
			rate: 5,
			account_head: "VAT - TS",
			included_in_print_rate: 0,
		},
	],
	taxInclusiveMode: false,
	disableRoundedTotal: true,
	profile: { name: "Shop POS", warehouse: "Stores", currency: "NGN" },
	posProfile: { name: "Shop POS", max_discount_percentage_allowed: 100 },
	currency: "NGN",
	tenderModeFor: vi.fn(() => undefined),
}));
vi.mock("@/stores/posStore", () => ({ usePosStore: vi.fn(() => pos) }));

import { useCartStore } from "@/stores/cartStore";
import type { CartItem } from "@/types/pos.types";

function cart(percent = 10, on = "Grand Total") {
	const c = useCartStore();
	c.items.push({
		item_code: "RT-DEC",
		item_name: "Decimal",
		qty: 3,
		rate: 33.33,
		uom: "Nos",
		discount_percentage: 0,
		discount_amount: 0,
	} as CartItem);
	c.discountPercentage = percent;
	c.applyDiscountOn = on;
	return c;
}

beforeEach(() => setActivePinia(createPinia()));

describe("a discount with tax, as ERPNext books it", () => {
	it("discount on the grand total: VAT on the discounted net, and ERPNext's grand total", () => {
		const c = cart(10, "Grand Total");
		expect(c.calculatedTaxes).toMatchObject([{ description: "VAT", amount: 4.5 }]);
		expect(c.grandTotal).toBeCloseTo(94.49, 2);
	});

	it("discount on the net total: VAT on the discounted net, not 5.00 on the full net", () => {
		const c = cart(10, "Net Total");
		expect(c.calculatedTaxes).toMatchObject([{ amount: 4.5 }]);
		// 99.99 - 9.999 = 89.991 net, + 4.4996 VAT. The till used to ask 94.99.
		expect(c.grandTotal).toBeCloseTo(94.49, 2);
	});

	it("no discount: the tax as before", () => {
		const c = cart(0);
		expect(c.calculatedTaxes).toMatchObject([{ amount: 5 }]);
		expect(c.grandTotal).toBeCloseTo(104.99, 2);
	});

	it("the receipt records the whole-sale discount off the lines, and the discounted net", () => {
		const r = cart(10, "Grand Total").getReceiptSnapshot("LOCAL-1");
		// 10.50 off the grand total is 10.00 off the lines and 0.50 off the VAT.
		expect(r.total_discount).toBeCloseTo(10.0, 2);
		expect(r.net_total).toBeCloseTo(89.99, 2);
		expect(r.taxes).toMatchObject([{ amount: 4.5 }]);
	});
});
