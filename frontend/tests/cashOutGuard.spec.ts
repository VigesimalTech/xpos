/**
 * Cash out of the drawer, checked when entered: the POS Profile's Cash Movement Max Amount
 * (ERPNext refused it only at sync, after the cash went), and Cash Out Within the Drawer
 * (a 2,000,000,000 expense was taken against 235,000 of cash) (22 Sep 2026).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/stores/posStore", () => ({ usePosStore: () => ({}) }));
vi.mock("@/services/dbBridge", () => ({ getShiftClosingSummary: vi.fn() }));
vi.mock("@/composables/useCurrency", () => ({ formatWithSymbol: (_c: string, v: number) => v.toFixed(2) }));

import { cashOutLimit } from "@/services/cashOutGuard";

describe("what may go out of the drawer", () => {
	it("over the profile's limit for one movement is refused", () => {
		expect(cashOutLimit(600, { cash_movement_max_amount: 500 }, 10_000)).toContain("limit of 500.00");
	});

	it("more than the drawer holds is refused, by default", () => {
		expect(cashOutLimit(1_000, {}, 235)).toContain("drawer should hold");
	});

	it("within both, it goes", () => {
		expect(cashOutLimit(200, { cash_movement_max_amount: 500 }, 235)).toBeNull();
	});

	it("with the drawer check switched off, only the limit counts", () => {
		expect(cashOutLimit(1_000, { xpos_cash_out_within_drawer: 0 }, 235)).toBeNull();
	});

	it("no limit set and no drawer figure (the web POS): it goes", () => {
		expect(cashOutLimit(1_000_000, {}, null)).toBeNull();
	});
});
