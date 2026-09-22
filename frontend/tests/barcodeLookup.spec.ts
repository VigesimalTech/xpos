/**
 * @vitest-environment jsdom
 *
 * On the till a scanned barcode is found through every barcode the item has (item_barcodes),
 * not only the item's own barcode column: a barcode added in ERPNext and synced to the till
 * was "not found" (bug hunt, 22 Sep 2026).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/stores/posStore", () => ({
	usePosStore: () => ({ sellingPriceList: "Standard Selling", warehouse: "Stores" }),
}));

import { useItemStore } from "@/stores/itemStore";

const item = { item_code: "RT-DEC", item_name: "Decimal Item", rate: 33.33, barcode: null };

beforeEach(() => {
	setActivePinia(createPinia());
	window.electronAPI = {
		db: {
			getItemByBarcode: vi.fn(async (code: string) =>
				code === "RTDEC0001" ? { item_code: "RT-DEC" } : null,
			),
			getItems: vi.fn(async ({ search }: { search: string }) => (search === "RT-DEC" ? [item] : [])),
		},
	} as never;
});

describe("scanning on the till", () => {
	it("finds an item by any of its barcodes, with its price", async () => {
		expect(await useItemStore().searchByBarcode("RTDEC0001")).toMatchObject({
			item_code: "RT-DEC",
			rate: 33.33,
		});
	});

	it("an unknown barcode finds nothing", async () => {
		expect(await useItemStore().searchByBarcode("NOSUCHCODE")).toBeNull();
	});
});
