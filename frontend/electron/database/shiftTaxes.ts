/**
 * The taxes and rounding a till's sale is priced with, as ERPNext's shifts API gives the web
 * POS (xpos/api/shifts.py): the POS Profile's Sales Taxes and Charges Template, its
 * tax_inclusive, and Global Defaults' disable_rounded_total.
 *
 * The till returned no taxes and rounding on, whatever ERPNext said: on a POS Profile with
 * VAT every sale was charged without it, ERPNext added it back, and refused the sale as
 * part-paid (bug hunt, 22 Sep 2026).
 */
export interface TaxRow {
	description: string;
	charge_type: string;
	rate: number;
	account_head: string;
	included_in_print_rate: number;
}

export interface ShiftPricing {
	taxes: TaxRow[];
	tax_inclusive: boolean;
	disable_rounded_total: boolean;
}

/**
 * ERPNext's Stock Settings as the till last cached them: whether a sale may take stock below
 * zero. The till returned none, so it never knew ERPNext allowed negative stock.
 */
export function shiftStockSettings(erpSettings: string | null | undefined): {
	allow_negative_stock: boolean;
} {
	try {
		const settings = JSON.parse(erpSettings || "null");
		return { allow_negative_stock: Boolean(Number(settings?.stock_settings?.allow_negative_stock || 0)) };
	} catch {
		return { allow_negative_stock: false };
	}
}

export function shiftPricing(
	profile: { taxes_and_charges?: unknown; tax_inclusive?: unknown } | null | undefined,
	charges: {
		description?: unknown;
		charge_type?: unknown;
		rate?: unknown;
		account_head?: unknown;
		included_in_print_rate?: unknown;
	}[],
	erpSettings: string | null | undefined,
): ShiftPricing {
	let disableRounded = false;
	try {
		const settings = JSON.parse(erpSettings || "null");
		disableRounded = Boolean(Number(settings?.global_defaults?.disable_rounded_total || 0));
	} catch {
		// No cached settings yet: ERPNext's default, rounding on.
	}
	if (!profile?.taxes_and_charges) {
		return { taxes: [], tax_inclusive: false, disable_rounded_total: disableRounded };
	}
	const taxes = charges.map((tax) => {
		const account = String(tax.account_head || "");
		return {
			description: String(tax.description || "") || (account ? account.split(" - ")[0] : "Tax"),
			charge_type: String(tax.charge_type || ""),
			rate: Number(tax.rate) || 0,
			account_head: account,
			included_in_print_rate: Number(tax.included_in_print_rate) ? 1 : 0,
		};
	});
	return {
		taxes,
		tax_inclusive: Boolean(Number(profile.tax_inclusive || 0)),
		disable_rounded_total: disableRounded,
	};
}
