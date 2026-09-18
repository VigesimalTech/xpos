/**
 * @vitest-environment jsdom
 *
 * On the desktop app, items come from the local database over Electron IPC.
 * IPC copies its arguments with the structured-clone algorithm, which refuses
 * Vue's reactive proxies: passing one fails the call and the item list stays
 * empty. The fake IPC here clones its arguments the same way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({
	call: vi.fn(),
	isNetworkError: vi.fn(() => false),
	default: { call: vi.fn() },
}));

vi.mock("@/stores/posStore", () => ({
	usePosStore: vi.fn(() => ({
		sellingPriceList: "Standard Selling",
		warehouse: "Stores - TC",
		useOfflineMode: true,
	})),
}));

import { useItemStore } from "@/stores/itemStore";
import { searchCachedItems } from "@/services/dbBridge";

const ITEMS = [{ item_code: "ITEM-001", item_name: "Test Item" }];

/** Stand-in for window.electronAPI.db.getItems that copies its argument as IPC does. */
const getItems = vi.fn(async (opts: unknown) => {
	structuredClone(opts);
	return ITEMS;
});

beforeEach(() => {
	setActivePinia(createPinia());
	getItems.mockClear();
	window.electronAPI = { db: { getItems } } as never;
});

describe("S2: the desktop app lists and searches items", () => {
	it("loads the item list from the local database", async () => {
		const store = useItemStore();

		await store.fetchItems("Test POS Profile");

		expect(getItems).toHaveBeenCalledOnce();
		expect(store.items).toMatchObject(ITEMS);
	});

	it("passes the configured search fields as plain data", async () => {
		const store = useItemStore();
		store.searchTerm = "test";

		await store.fetchItems("Test POS Profile");

		expect(getItems.mock.calls[0][0]).toMatchObject({ searchFields: ["name", "item_name", "item_code"] });
	});

	it("searches cached items with reactive search fields", async () => {
		const { reactive } = await import("vue");
		const fields = reactive(["item_name", "barcode"]);

		await expect(searchCachedItems("test", "All Item Groups", fields)).resolves.toEqual(ITEMS);
	});
});
