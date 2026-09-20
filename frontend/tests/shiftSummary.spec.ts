/**
 * The till's shift summary follows the server's rules (xpos/api/shifts.py), so the
 * figures a cashier counts against on the till are the ones ERPNext closes with.
 */
import { describe, expect, it } from "vitest";
import { saleFromPending, summarizeShift, type ShiftSale } from "../electron/database/shiftSummary";

function sale(extra: Partial<ShiftSale> = {}): ShiftSale {
	return {
		local_id: "s1",
		grand_total: 100,
		net_total: 100,
		is_return: false,
		currency: "NGN",
		customer: "Walk-in",
		customer_name: "Walk-in",
		payments: [{ mode_of_payment: "Cash", amount: 100 }],
		change_amount: 0,
		change_legs: [],
		taxes: [],
		...extra,
	};
}

const base = {
	openingBalances: [{ mode_of_payment: "Cash", opening_amount: 1000 }],
	cashMode: "Cash",
	currency: "NGN",
	cashOut: 0,
};

describe("the till's shift summary", () => {
	it("expects the float plus what was taken", () => {
		const summary = summarizeShift({ ...base, sales: [sale(), sale({ local_id: "s2" })] });
		expect(summary.expected_amounts.Cash).toEqual({ amount: 1200, currency: "NGN" });
		expect(summary.total_invoices).toBe(2);
		expect(summary.grand_total).toBe(200);
	});

	it("does not count change handed back", () => {
		const summary = summarizeShift({
			...base,
			sales: [sale({ payments: [{ mode_of_payment: "Cash", amount: 150 }], change_amount: 50 })],
		});
		expect(summary.expected_amounts.Cash.amount).toBe(1100);
	});

	it("takes change legs off their own mode", () => {
		const summary = summarizeShift({
			...base,
			sales: [
				sale({
					payments: [{ mode_of_payment: "Card", amount: 150 }],
					change_amount: 50,
					change_legs: [{ mode_of_payment: "Cash", currency: "NGN", amount: 50 }],
				}),
			],
		});
		expect(summary.expected_amounts.Card.amount).toBe(150);
		expect(summary.expected_amounts.Cash.amount).toBe(950);
	});

	it("keeps a foreign tender in its own currency", () => {
		const summary = summarizeShift({
			...base,
			sales: [
				sale({
					payments: [
						{
							mode_of_payment: "Cash USD",
							amount: 150000,
							pos_tender_currency: "USD",
							pos_tender_amount: 100,
						},
					],
				}),
			],
		});
		expect(summary.payment_summary["Cash USD"]).toEqual({ amount: 100, currency: "USD" });
	});

	it("takes expenses and bank drops out of the cash drawer", () => {
		const summary = summarizeShift({ ...base, sales: [sale()], cashOut: 300 });
		expect(summary.expected_amounts.Cash.amount).toBe(800);
		expect(summary.cash_out).toBe(300);
	});

	it("counts a return against the shift", () => {
		const summary = summarizeShift({
			...base,
			sales: [
				sale(),
				sale({
					local_id: "r1",
					is_return: true,
					grand_total: -40,
					net_total: -40,
					payments: [{ mode_of_payment: "Cash", amount: -40 }],
				}),
			],
		});
		expect(summary.returns_count).toBe(1);
		expect(summary.grand_total).toBe(60);
		expect(summary.expected_amounts.Cash.amount).toBe(1060);
	});

	it("reads a queued sale, with a return's totals negative as in ERPNext", () => {
		const read = saleFromPending(
			{ local_id: "L1", grand_total: 40, customer_name: "Ada" },
			{
				is_return: true,
				customer: "CUST-1",
				payments: [{ mode_of_payment: "Cash", amount: -40 }],
				receipt: {
					grand_total: 40,
					net_total: 35,
					currency: "NGN",
					taxes: [{ description: "VAT", rate: 7.5, amount: 5 }],
				},
			},
			"USD",
		);
		expect(read).toMatchObject({ grand_total: -40, net_total: -35, is_return: true, currency: "NGN" });
		const summary = summarizeShift({ ...base, sales: [read] });
		expect(summary.tax_summary).toEqual([{ account_head: "VAT", rate: 7.5, amount: -5 }]);
	});
});
