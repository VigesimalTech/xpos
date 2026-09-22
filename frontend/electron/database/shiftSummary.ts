/**
 * The shift summary a till shows when it closes a shift, from its own records, so a
 * shift closes offline. It follows the server's rules (xpos/api/shifts.py) so the two
 * agree: each mode's figures are in its own tender currency, change handed back is not
 * collected, and cash taken out as expenses and bank drops leaves the cash mode.
 *
 * It is what the cashier counts against. ERPNext works the expected amounts out again
 * from its own records when the closing reaches it; only the counted amounts come from
 * the till.
 */

export interface ModeTotal {
	amount: number;
	currency: string;
}

export interface ShiftSale {
	grand_total: number;
	net_total: number;
	is_return: boolean;
	currency: string;
	customer: string;
	customer_name: string;
	local_id: string;
	payments: Array<{
		mode_of_payment?: string;
		amount?: number;
		pos_tender_currency?: string;
		pos_tender_amount?: number;
	}>;
	change_amount: number;
	change_legs: Array<{ mode_of_payment?: string; currency?: string; amount?: number }>;
	taxes: Array<{ description?: string; rate?: number; amount?: number }>;
}

export interface ShiftSummaryInput {
	sales: ShiftSale[];
	openingBalances: Array<{ mode_of_payment: string; opening_amount: number }>;
	cashMode: string;
	currency: string;
	/** Expenses and bank drops recorded in the shift. */
	cashOut: number;
}

export interface ShiftSummary {
	total_invoices: number;
	grand_total: number;
	net_total: number;
	returns_count: number;
	payment_summary: Record<string, ModeTotal>;
	opening_balances: Record<string, ModeTotal>;
	expected_amounts: Record<string, ModeTotal>;
	tax_summary: Array<{ account_head: string; rate: number; amount: number }>;
	cash_out: number;
	invoices: Array<{
		name: string;
		customer: string;
		customer_name: string;
		grand_total: number;
		is_return: number;
	}>;
}

const num = (value: unknown): number => {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
};

function collector(): [
	Record<string, ModeTotal>,
	(mode?: string, currency?: string, amount?: number) => void,
] {
	const totals: Record<string, ModeTotal> = {};
	const collect = (mode?: string, currency?: string, amount?: number) => {
		if (!mode) return;
		const entry = (totals[mode] ??= { amount: 0, currency: currency || "" });
		if (currency && !entry.currency) entry.currency = currency;
		entry.amount += num(amount);
	};
	return [totals, collect];
}

/** Where a sale's change came from when the till recorded no change legs (shifts.py resolve_legacy_change). */
function legacyChange(sale: ShiftSale, cashMode: string): [string, string, number] {
	const rows = sale.payments.filter((p) => p.mode_of_payment);
	const row = rows.find((p) => p.mode_of_payment === cashMode) ?? (rows.length === 1 ? rows[0] : undefined);
	if (!row) return [cashMode, sale.currency, sale.change_amount];
	const currency = row.pos_tender_currency;
	const native = num(row.pos_tender_amount);
	const base = num(row.amount);
	if (currency && currency !== sale.currency && native && base) {
		return [row.mode_of_payment!, currency, (sale.change_amount * native) / base];
	}
	return [row.mode_of_payment!, sale.currency, sale.change_amount];
}

/** Payments collected per mode, net of change (shifts.py get_shift_payment_totals). */
export function paymentTotals(sales: ShiftSale[], cashMode: string): Record<string, ModeTotal> {
	const [totals, collect] = collector();
	for (const sale of sales) {
		for (const p of sale.payments) {
			if (p.pos_tender_currency) collect(p.mode_of_payment, p.pos_tender_currency, p.pos_tender_amount);
			else collect(p.mode_of_payment, sale.currency, p.amount);
		}
		if (sale.change_legs.length) {
			for (const leg of sale.change_legs) {
				collect(leg.mode_of_payment, leg.currency || sale.currency, -num(leg.amount));
			}
		} else if (sale.change_amount > 0) {
			const [mode, currency, amount] = legacyChange(sale, cashMode);
			collect(mode, currency, -amount);
		}
	}
	return totals;
}

export function summarizeShift(input: ShiftSummaryInput): ShiftSummary {
	const { sales, cashMode, currency } = input;

	const opening_balances: Record<string, ModeTotal> = {};
	const [expected, collect] = collector();
	for (const row of input.openingBalances) {
		opening_balances[row.mode_of_payment] = { amount: num(row.opening_amount), currency };
		collect(row.mode_of_payment, currency, row.opening_amount);
	}

	const payment_summary = paymentTotals(sales, cashMode);
	for (const [mode, row] of Object.entries(payment_summary)) collect(mode, row.currency, row.amount);
	if (input.cashOut) collect(cashMode, undefined, -input.cashOut);

	const taxes = new Map<string, { account_head: string; rate: number; amount: number }>();
	for (const sale of sales) {
		for (const tax of sale.taxes) {
			const head = tax.description || "";
			const key = `${head}|${num(tax.rate)}`;
			const entry = taxes.get(key) ?? { account_head: head, rate: num(tax.rate), amount: 0 };
			entry.amount += (sale.is_return ? -1 : 1) * Math.abs(num(tax.amount));
			taxes.set(key, entry);
		}
	}

	return {
		total_invoices: sales.length,
		grand_total: sales.reduce((sum, s) => sum + s.grand_total, 0),
		net_total: sales.reduce((sum, s) => sum + s.net_total, 0),
		returns_count: sales.filter((s) => s.is_return).length,
		payment_summary,
		opening_balances,
		expected_amounts: expected,
		tax_summary: [...taxes.values()],
		cash_out: input.cashOut,
		invoices: sales.map((s) => ({
			name: s.local_id,
			customer: s.customer,
			customer_name: s.customer_name,
			grand_total: s.grand_total,
			is_return: s.is_return ? 1 : 0,
		})),
	};
}

/** A queued sale as the summary reads it. Returns carry negative totals, as in ERPNext. */
export function saleFromPending(
	row: { local_id: string; grand_total?: unknown; customer_name?: unknown },
	data: Record<string, unknown>,
	fallbackCurrency: string,
): ShiftSale {
	const receipt = (data.receipt as Record<string, unknown> | undefined) ?? {};
	const isReturn = Boolean(data.is_return);
	const sign = isReturn ? -1 : 1;
	const grand = num(receipt.grand_total ?? row.grand_total);
	const net = num(receipt.net_total ?? receipt.grand_total ?? row.grand_total);
	return {
		local_id: row.local_id,
		grand_total: sign * Math.abs(grand),
		net_total: sign * Math.abs(net),
		is_return: isReturn,
		currency: String(receipt.currency || data.currency || fallbackCurrency || ""),
		customer: String(data.customer || ""),
		customer_name: String(receipt.customer_name || row.customer_name || data.customer || ""),
		payments: Array.isArray(data.payments) ? (data.payments as ShiftSale["payments"]) : [],
		change_amount: num(data.change_amount),
		change_legs: Array.isArray(data.pos_change_legs)
			? (data.pos_change_legs as ShiftSale["change_legs"])
			: [],
		taxes: Array.isArray(receipt.taxes) ? (receipt.taxes as ShiftSale["taxes"]) : [],
	};
}

/** A JSON column as an object; MariaDB may hand it back as text or already parsed. */
export function parseJsonColumn(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object") return value as Record<string, unknown>;
	try {
		const parsed = JSON.parse(String(value ?? ""));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** A held order is not a sale yet: it stays on the till until it is paid. */
export function isHeldOrderData(data: Record<string, unknown>): boolean {
	return Boolean(data.is_draft);
}

/** Queued sales still to reach ERPNext, from their rows: held orders are not sales yet. */
export function countWaitingSales(rows: { data: unknown }[]): number {
	return rows.filter((row) => !isHeldOrderData(parseJsonColumn(row.data))).length;
}

/** The till's id for the shift a queued sale was made in. */
export function shiftOfSale(data: Record<string, unknown>): string {
	return String(data.pos_opening_shift_local_id ?? data.pos_opening_shift ?? "");
}
