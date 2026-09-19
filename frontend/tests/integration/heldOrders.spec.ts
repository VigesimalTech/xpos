/**
 * @vitest-environment jsdom
 *
 * Held orders end to end on the till: the cart's own code, through the real preload bridge
 * and IPC handlers, into the local MariaDB and back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { closeTestDb, clearSyncTables, createTestDb } from "./support/localDb";
import { query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/services/pricingService", () => ({
	resolveCartPricing: vi.fn(async () => null),
	refreshPricingRuleSnapshot: vi.fn(async () => []),
}));
vi.mock("@/stores/posStore", () => ({
	usePosStore: vi.fn(() => ({
		taxes: [],
		posOpeningShift: { name: "7" },
		profileName: "Test POS Profile",
		currency: "USD",
		disableRoundedTotal: true,
		allowChangePostingDate: false,
		stockSettings: { allow_negative_stock: true },
	})),
}));

import { call } from "@/services/api";
import { addPendingInvoice } from "@/services/dbBridge";
import { useCartStore } from "@/stores/cartStore";

const ITEMS = [
	{ item_code: "TEA", item_name: "Tea", qty: 2, rate: 3, uom: "Nos" },
	{ item_code: "BUN", item_name: "Bun", qty: 1, rate: 4, uom: "Nos" },
];

/** Hold the cart the way the cart's Save as Draft does on the desktop. */
async function holdCart(): Promise<void> {
	const cart = useCartStore();
	const data = cart.getInvoiceData("Test POS Profile", "7");
	await addPendingInvoice({
		data: { ...data, is_draft: true, pos_opening_shift_local_id: "7" },
		customer_name: "Walk-in Customer",
		grand_total: 10,
	});
	cart.clearAll();
}

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
	await import("../../electron/preload");
});

afterAll(async () => {
	await closeTestDb();
});

beforeEach(async () => {
	await clearSyncTables();
	setActivePinia(createPinia());
	vi.mocked(call).mockReset();
});

describe("held orders on the till", () => {
	it("a held order is listed in Held Invoices and restores into the cart", async () => {
		const cart = useCartStore();
		cart.loadFromInvoice({
			customer: "Walk-in Customer",
			customer_name: "Walk-in Customer",
			items: ITEMS,
		});
		await holdCart();
		expect(cart.items).toHaveLength(0);

		const drafts = await cart.fetchDraftInvoices("shift");
		expect(drafts).toHaveLength(1);
		expect(drafts[0]).toMatchObject({ customer: "Walk-in Customer", grand_total: 10, total_qty: 3 });

		expect(await cart.loadDraftInvoice(drafts[0].name)).toBe(true);

		expect(cart.customer?.name).toBe("Walk-in Customer");
		expect(cart.items.map((i) => [i.item_code, i.qty, i.rate])).toEqual([
			["TEA", 2, 3],
			["BUN", 1, 4],
		]);
		expect(await cart.fetchDraftInvoices("shift")).toEqual([]);
		expect(await query("SELECT `id` FROM `pending_invoices`")).toEqual([]);
		expect(call).not.toHaveBeenCalled();
	});

	it("a restored order held again is listed again, once", async () => {
		const cart = useCartStore();
		cart.loadFromInvoice({
			customer: "Walk-in Customer",
			customer_name: "Walk-in Customer",
			items: ITEMS,
		});
		await holdCart();
		await cart.loadDraftInvoice((await cart.fetchDraftInvoices("shift"))[0].name);

		await holdCart();

		expect(await cart.fetchDraftInvoices("shift")).toHaveLength(1);
	});

	it("a held order can be deleted", async () => {
		const cart = useCartStore();
		cart.loadFromInvoice({
			customer: "Walk-in Customer",
			customer_name: "Walk-in Customer",
			items: ITEMS,
		});
		await holdCart();

		expect(await cart.deleteHeldOrderOnTill((await cart.fetchDraftInvoices("shift"))[0].name)).toBe(true);

		expect(await cart.fetchDraftInvoices("shift")).toEqual([]);
	});
});

describe("the test bridge", () => {
	it("refuses a live Vue array, as Electron's IPC does", async () => {
		const { reactive } = await import("vue");
		const payments = reactive([{ mode_of_payment: "Cash", amount: 1 }]);

		await expect(window.electronAPI!.db.addPendingInvoice({ data: { payments } })).rejects.toThrow(
			/could not be cloned/,
		);
	});
});
