/**
 * @vitest-environment jsdom
 *
 * Held orders on the desktop till: saved as drafts in the till's own database, listed and
 * restored from there by Held Invoices, and never sent to ERPNext as a sale.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const rows: Array<Record<string, unknown>> = [];
const deletePendingInvoice = vi.fn(async (id: number) => {
	rows.splice(
		rows.findIndex((r) => r.id === id),
		1,
	);
});

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));
vi.mock("@/services/dbBridge", () => ({
	getCachedItemByCode: vi.fn(async () => null),
	getCachedStockForItem: vi.fn(async () => null),
	getPendingInvoices: vi.fn(async () => rows),
	deletePendingInvoice: (id: number) => deletePendingInvoice(id),
}));
vi.mock("@/stores/posStore", () => ({
	usePosStore: vi.fn(() => ({
		taxes: [],
		posOpeningShift: { name: "3" },
		profileName: "POS-PROFILE-1",
		currency: "USD",
		disableRoundedTotal: true,
		allowChangePostingDate: false,
		stockSettings: { allow_negative_stock: true },
	})),
}));
vi.mock("@/services/pricingService", () => ({
	resolveCartPricing: vi.fn(async () => ({ updates: [], free_lines: [], invoice_updates: {} })),
	refreshPricingRuleSnapshot: vi.fn(async () => []),
}));

import { call } from "@/services/api";
import { useCartStore } from "@/stores/cartStore";

function row(id: number, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	return {
		id,
		status: "pending",
		data: JSON.stringify(data),
		customer_name: "Walk-In",
		grand_total: 30,
		created_at: `2026-09-19 16:1${id}:00`,
		...extra,
	};
}

const items = [{ item_code: "ITEM-1", item_name: "Item 1", qty: 3, rate: 10, uom: "Nos" }];

describe("held orders on the desktop till", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.mocked(call).mockReset();
		deletePendingInvoice.mockClear();
		rows.length = 0;
		rows.push(
			row(1, { customer: "Walk-In", items, is_draft: false, pos_opening_shift: "3" }),
			row(2, { customer: "Walk-In", items, is_draft: true, pos_opening_shift: "3" }),
			row(3, { customer: "Walk-In", items, is_draft: true, pos_opening_shift: "2" }),
			row(
				4,
				{ customer: "Walk-In", items, is_draft: true, pos_opening_shift: "3" },
				{ status: "dead_letter" },
			),
			row(
				5,
				{ customer: "Walk-In", items, is_draft: true, pos_opening_shift: "3" },
				{ status: "synced" },
			),
		);
	});

	it("lists this shift's held orders from the till, newest first, without asking ERPNext", async () => {
		const drafts = await useCartStore().fetchDraftInvoices("shift");

		expect(drafts.map((d) => d.name)).toEqual(["LOCAL-4", "LOCAL-2"]);
		expect(drafts[0]).toMatchObject({ customer: "Walk-In", grand_total: 30, total_qty: 3 });
		expect(call).not.toHaveBeenCalled();
	});

	it("lists every shift's held orders for the profile scope", async () => {
		const drafts = await useCartStore().fetchDraftInvoices("profile");

		expect(drafts.map((d) => d.name)).toEqual(["LOCAL-4", "LOCAL-3", "LOCAL-2"]);
	});

	it("restores a held order into the cart and takes it off the list", async () => {
		const cart = useCartStore();

		expect(await cart.loadDraftInvoice("LOCAL-2")).toBe(true);

		expect(cart.items.map((i) => [i.item_code, i.qty])).toEqual([["ITEM-1", 3]]);
		expect(deletePendingInvoice).toHaveBeenCalledWith(2);
		expect((await cart.fetchDraftInvoices("shift")).map((d) => d.name)).toEqual(["LOCAL-4"]);
		expect(call).not.toHaveBeenCalled();
	});

	it("deletes a held order on the till", async () => {
		expect(await useCartStore().deleteHeldOrderOnTill("LOCAL-4")).toBe(true);
		expect(deletePendingInvoice).toHaveBeenCalledWith(4);
		expect(await useCartStore().deleteHeldOrderOnTill("ACC-SINV-0001")).toBe(false);
	});
});
