/**
 * @vitest-environment jsdom
 *
 * VAT included in the price. ERPNext books a POS Profile's taxes as included exactly when
 * the profile is tax inclusive, whatever the template's own flag says (Actual charges never:
 * invoice_processing/creation.py). The cart went by the template's flag, which is usually
 * off: on an inclusive profile it added the VAT on top and charged 105.00 for what ERPNext
 * booked as 100, with 5.00 of change never given (release sweep, 22 Sep 2026). Numbers from
 * the same ERPNext: 3 x 33.33 with 5% VAT.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/services/userRights", () => ({ hasPermission: () => true, getDiscountLimit: () => 100 }));
const pos = vi.hoisted(() => ({
	taxes: [] as Record<string, unknown>[],
	taxInclusiveMode: true,
	disableRoundedTotal: true,
	profile: { name: "Shop POS", warehouse: "Stores", currency: "NGN" },
	posProfile: { name: "Shop POS", max_discount_percentage_allowed: 100 },
	currency: "NGN",
	tenderModeFor: vi.fn(() => undefined),
}));
vi.mock("@/stores/posStore", () => ({ usePosStore: vi.fn(() => pos) }));

import { useCartStore } from "@/stores/cartStore";
import type { CartItem } from "@/types/pos.types";

const vat = (included: number) => ({
	description: "VAT",
	charge_type: "On Net Total",
	rate: 5,
	account_head: "VAT - TS",
	included_in_print_rate: included,
});

function cart(percent = 0) {
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
	c.applyDiscountOn = "Grand Total";
	return c;
}

beforeEach(() => setActivePinia(createPinia()));

describe("an inclusive POS Profile, with the template's flag off", () => {
	beforeEach(() => {
		pos.taxInclusiveMode = true;
		pos.taxes = [vat(0)];
	});

	it("takes the VAT out of the price, as ERPNext books it", () => {
		const c = cart();
		expect(c.grandTotal).toBeCloseTo(99.99, 2);
		expect(c.calculatedTaxes).toMatchObject([{ included_in_print_rate: true }]);
		expect(c.calculatedTaxes[0].amount).toBeCloseTo(4.76, 2);
	});

	it("with 10% off the grand total: 89.99, as ERPNext booked it", () => {
		const c = cart(10);
		expect(c.grandTotal).toBeCloseTo(89.99, 2);
		expect(c.calculatedTaxes[0].amount).toBeCloseTo(4.29, 2);
	});
});

describe("a profile that is not inclusive, with the template's flag on", () => {
	it("adds the VAT on top, as ERPNext books it: it charged none", () => {
		pos.taxInclusiveMode = false;
		pos.taxes = [vat(1)];
		const c = cart();
		expect(c.grandTotal).toBeCloseTo(104.99, 2);
		expect(c.calculatedTaxes[0].amount).toBeCloseTo(5, 2);
	});
});

describe("the receipt of an inclusive sale", () => {
	beforeEach(() => {
		pos.taxInclusiveMode = true;
		pos.taxes = [vat(0)];
	});

	it("shows the net without the VAT in it, as ERPNext books it", () => {
		expect(cart().getReceiptSnapshot("LOCAL-1").net_total).toBeCloseTo(95.23, 2);
	});

	it("and with 10% off the grand total, to the cent ERPNext's own line rounding allows", () => {
		// ERPNext rounds line by line: net 85.71 and VAT 4.29 make 90.00 against its 89.99.
		// The till's 85.70 + 4.29 + 0.01 rounding adds up to the 90.00 charged.
		expect(cart(10).getReceiptSnapshot("LOCAL-2").net_total).toBeCloseTo(85.71, 1);
	});
});
