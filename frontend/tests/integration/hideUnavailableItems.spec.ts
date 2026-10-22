/**
 * @vitest-environment jsdom
 *
 * K54: the POS Profile's Hide Unavailable Items, on the till. The web POS left
 * out-of-stock items out (the server filters them); the till read the setting and showed
 * every item anyway. The local item query now leaves them out when asked, in its SQL so a
 * page is still full, using the stock it already shows: the till's own count
 * (stock_cache) first, then ERPNext's (bins).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, createTestDb } from "./support/localDb";
import { execute } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";

const WH = "Shop - TC";

type Row = { item_code: string; actual_qty: number };

async function addItem(
	code: string,
	opts: { stock?: boolean; bin?: number; cache?: number; otherWh?: number } = {},
) {
	await execute(
		"INSERT INTO `items` (`item_code`, `item_name`, `item_group`, `is_stock_item`) VALUES (?, ?, 'Food', ?)",
		[code, code, opts.stock === false ? 0 : 1],
	);
	if (opts.bin !== undefined)
		await execute(
			"INSERT INTO `bins` (`name`, `item_code`, `warehouse`, `actual_qty`) VALUES (?, ?, ?, ?)",
			[`${code}-bin`, code, WH, opts.bin],
		);
	if (opts.otherWh !== undefined)
		await execute(
			"INSERT INTO `bins` (`name`, `item_code`, `warehouse`, `actual_qty`) VALUES (?, ?, 'Elsewhere - TC', ?)",
			[`${code}-other`, code, opts.otherWh],
		);
	if (opts.cache !== undefined)
		await execute(
			"INSERT INTO `stock_cache` (`cache_key`, `warehouse`, `item_code`, `actual_qty`) VALUES (?, ?, ?, ?)",
			[`${WH}::${code}`, WH, code, opts.cache],
		);
}

const getItems = (opts: Record<string, unknown>) =>
	window.electronAPI!.db.getItems({ warehouse: WH, ...opts }) as Promise<Row[]>;
const codes = (rows: Row[]) => rows.map((r) => r.item_code).sort();

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
	await import("../../electron/preload");
});

afterAll(async () => {
	await closeTestDb();
});

beforeEach(async () => {
	for (const t of ["items", "bins", "stock_cache"]) await execute(`DELETE FROM \`${t}\``);
	await addItem("IN-STOCK", { bin: 5 });
	await addItem("SOLD-OUT", { bin: 0 });
	await addItem("NO-BIN");
	await addItem("ONLY-ELSEWHERE", { otherWh: 9 });
	await addItem("SERVICE", { stock: false });
	// The till's own count wins over ERPNext's, as it does for the badge.
	await addItem("SOLD-HERE", { bin: 3, cache: 0 });
	await addItem("RESTOCKED-HERE", { bin: 0, cache: 2 });
});

describe("K54: Hide Unavailable Items on the till", () => {
	it("K54: without it, every item is listed, as before", async () => {
		expect(await getItems({})).toHaveLength(7);
	});

	it("K54: with it, out-of-stock stock items are left out; items not kept in stock stay", async () => {
		expect(codes(await getItems({ inStockOnly: true }))).toEqual([
			"IN-STOCK",
			"RESTOCKED-HERE",
			"SERVICE",
		]);
	});

	it("K54: stock is the till's warehouse's, not another's", async () => {
		expect(codes(await getItems({ inStockOnly: true }))).not.toContain("ONLY-ELSEWHERE");
	});

	it("K54: a page is full: the filter is in the query, not applied to a page afterwards", async () => {
		const page = await getItems({ inStockOnly: true, limit: 2 });
		expect(page).toHaveLength(2);
		const next = await getItems({ inStockOnly: true, limit: 2, offset: 2 });
		expect(codes([...page, ...next])).toEqual(["IN-STOCK", "RESTOCKED-HERE", "SERVICE"]);
	});

	it("K54: with it, a typed search leaves them out too, as the web POS does", async () => {
		expect(codes(await getItems({ inStockOnly: true, search: "SOLD" }))).toEqual([]);
		expect(codes(await getItems({ search: "SOLD" }))).toEqual(["SOLD-HERE", "SOLD-OUT"]);
	});
});
