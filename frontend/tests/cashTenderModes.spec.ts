/**
 * @vitest-environment jsdom
 *
 * Which of a POS Profile's payment methods are cash: change comes only out of them. The till
 * builds its profile's payment rows from its own tables, without the Mode of Payment's type
 * that ERPNext adds for the web POS; with none marked cash, every cash payment above the
 * total was refused as a card overpayment and the till could give no change (release sweep,
 * 22 Sep 2026).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/electronBridge", () => ({ isElectron: () => true, setTillIdentity: vi.fn() }));

import { usePosStore } from "@/stores/posStore";

beforeEach(() => setActivePinia(createPinia()));

const modes = () =>
	usePosStore()
		.cashTenderModes.map((m) => m.mode_of_payment)
		.sort();

describe("cash payment methods", () => {
	it("are those of type Cash", () => {
		usePosStore().posProfile = {
			name: "Shop 1",
			payments: [
				{ mode_of_payment: "Cash", default: 1, type: "Cash" },
				{ mode_of_payment: "Petty Cash", default: 0, type: "Cash" },
				{ mode_of_payment: "Credit Card", default: 0, type: "Bank" },
			],
		} as never;
		expect(modes()).toEqual(["Cash", "Petty Cash"]);
	});

	it("include the profile's cash mode when the rows carry no type, as on the till", () => {
		usePosStore().posProfile = {
			name: "Shop 1",
			cash_mode_of_payment: "Cash",
			payments: [
				{ mode_of_payment: "Cash", default: 1 },
				{ mode_of_payment: "Credit Card", default: 0 },
			],
		} as never;
		expect(modes()).toEqual(["Cash"]);
	});

	it("go by the type where there is one, even for the profile's cash mode", () => {
		usePosStore().posProfile = {
			name: "Shop 1",
			cash_mode_of_payment: "Credit Card",
			payments: [{ mode_of_payment: "Credit Card", default: 1, type: "Bank" }],
		} as never;
		expect(modes()).toEqual([]);
	});
});
