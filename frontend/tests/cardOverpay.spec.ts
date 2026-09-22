/**
 * Change only comes out of cash. The till gave cash change against a card payment; ERPNext
 * refused the sale ("change of 0 is due") and the drawer was short (bug hunt, 22 Sep 2026).
 */
import { describe, expect, it } from "vitest";
import { nonCashExcess } from "@/services/tenderLegs";
import type { TenderLeg } from "@/types/pos.types";

const leg = (mode: string, amount: number): TenderLeg => ({
	id: mode,
	mode_of_payment: mode,
	currency: "NGN",
	native_amount: amount,
	exchange_rate: 1,
	base_amount: amount,
});
const isCash = (mode: string) => mode === "Cash";

describe("card tender and change", () => {
	it("a card paying more than is due is refused, by how much", () => {
		expect(nonCashExcess([leg("Credit Card", 50)], 34, isCash, "NGN")).toBe(16);
	});

	it("a card paying exactly what is due is fine", () => {
		expect(nonCashExcess([leg("Credit Card", 34)], 34, isCash, "NGN")).toBe(0);
	});

	it("cash covering the rest, with change, is fine: the change comes out of the cash", () => {
		expect(nonCashExcess([leg("Credit Card", 20), leg("Cash", 50)], 34, isCash, "NGN")).toBe(0);
	});

	it("card plus cash where the card alone is over is refused", () => {
		expect(nonCashExcess([leg("Credit Card", 40), leg("Cash", 10)], 34, isCash, "NGN")).toBe(6);
	});

	it("a return's due is negative: its size is what counts", () => {
		expect(nonCashExcess([leg("Credit Card", 34)], -34, isCash, "NGN")).toBe(0);
	});
});
