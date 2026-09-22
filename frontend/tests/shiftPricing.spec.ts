/**
 * A till's sale is priced as ERPNext prices it: the POS Profile's taxes, tax_inclusive, and
 * Global Defaults' rounding. The till used none of them: on a profile with VAT every sale
 * was short, and ERPNext refused it as part-paid (bug hunt, 22 Sep 2026).
 */
import { describe, expect, it } from "vitest";
import { shiftPricing, shiftStockSettings } from "../electron/database/shiftTaxes";

const vat = [
	{
		description: "",
		charge_type: "On Net Total",
		rate: "5.000000",
		account_head: "VAT - TS",
		included_in_print_rate: 0,
	},
];

describe("pricing a till's sale as ERPNext does", () => {
	it("takes the POS Profile's tax template", () => {
		expect(shiftPricing({ taxes_and_charges: "Nigeria Tax - TS", tax_inclusive: 0 }, vat, null)).toEqual({
			taxes: [
				{
					description: "VAT",
					charge_type: "On Net Total",
					rate: 5,
					account_head: "VAT - TS",
					included_in_print_rate: 0,
				},
			],
			tax_inclusive: false,
			disable_rounded_total: false,
		});
	});

	it("no template, no taxes", () => {
		expect(shiftPricing({ taxes_and_charges: null }, vat, null).taxes).toEqual([]);
	});

	it("tax-inclusive profiles and inclusive rows stay so", () => {
		const p = shiftPricing(
			{ taxes_and_charges: "T", tax_inclusive: 1 },
			[{ ...vat[0], included_in_print_rate: 1 }],
			null,
		);
		expect(p.tax_inclusive).toBe(true);
		expect(p.taxes[0].included_in_print_rate).toBe(1);
	});

	it("rounding follows Global Defaults from the cached ERP settings", () => {
		const cached = JSON.stringify({ global_defaults: { disable_rounded_total: 1 } });
		expect(shiftPricing({}, [], cached).disable_rounded_total).toBe(true);
		expect(shiftPricing({}, [], JSON.stringify({ global_defaults: {} })).disable_rounded_total).toBe(
			false,
		);
		expect(shiftPricing({}, [], "not json").disable_rounded_total).toBe(false);
	});

	it("the till knows whether ERPNext allows negative stock", () => {
		expect(shiftStockSettings(JSON.stringify({ stock_settings: { allow_negative_stock: 1 } }))).toEqual({
			allow_negative_stock: true,
		});
		expect(shiftStockSettings(null)).toEqual({ allow_negative_stock: false });
	});
});
