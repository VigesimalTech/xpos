/**
 * @vitest-environment jsdom
 *
 * K54: on the till, the item list follows the POS Profile's Hide Unavailable Items; a scan
 * does not. A scanned item that is out of stock is still found, so the cashier is told it is
 * out of stock (or sells it, where the profile allows) rather than that the barcode is unknown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({
	call: vi.fn(),
	isNetworkError: vi.fn(() => false),
	default: { call: vi.fn() },
}));

const pos = vi.hoisted(() => ({
	sellingPriceList: "Standard Selling",
	warehouse: "Shop - TC",
	useOfflineMode: true,
	hideUnavailableItems: false,
}));
vi.mock("@/stores/posStore", () => ({ usePosStore: vi.fn(() => pos) }));

import { useItemStore } from "@/stores/itemStore";

const SOLD_OUT = { item_code: "SOLD-OUT", item_name: "Sold Out", barcode: "4000", actual_qty: 0 };
const getItems = vi.fn(async (opts: unknown) => {
	structuredClone(opts);
	return [SOLD_OUT];
});
const getItemByBarcode = vi.fn(async () => ({ item_code: "SOLD-OUT" }));

beforeEach(() => {
	setActivePinia(createPinia());
	getItems.mockClear();
	pos.hideUnavailableItems = false;
	window.electronAPI = { db: { getItems, getItemByBarcode } } as never;
});

describe("K54: the till's item list and Hide Unavailable Items", () => {
	it("K54: with it on, the item list asks for items in stock only", async () => {
		pos.hideUnavailableItems = true;
		await useItemStore().fetchItems("Shop");
		expect(getItems.mock.calls[0][0]).toMatchObject({ inStockOnly: true });
	});

	it("K54: with it off, the item list asks for every item, as before", async () => {
		await useItemStore().fetchItems("Shop");
		expect(getItems.mock.calls[0][0]).not.toMatchObject({ inStockOnly: true });
	});

	it("K54: with it on, a scan still finds an out-of-stock item", async () => {
		pos.hideUnavailableItems = true;
		const found = await useItemStore().searchByBarcode("4000");
		expect(found).toMatchObject({ item_code: "SOLD-OUT" });
		for (const [opts] of getItems.mock.calls) expect(opts).not.toMatchObject({ inStockOnly: true });
	});
});
