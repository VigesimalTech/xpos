/**
 * A till in hub-and-till mode pushes its sales and purchase orders to the
 * shop's hub. A record is marked 'syncing' while it is sent; if the till
 * stops mid-send it must go again when the till starts. The hub stores
 * pushes by local_id, so one that did arrive is not duplicated.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "./support/electronShim";
import { clearSyncTables, closeTestDb, createTestDb } from "./support/localDb";
import { execute, query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initTillClient } from "../../electron/hub/tillClient";

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
});

afterAll(async () => {
	await closeTestDb();
});

beforeEach(async () => {
	await clearSyncTables();
});

async function statusOf(table: string, localId: string): Promise<string> {
	const [row] = await query<{ status: string }>(
		`SELECT \`status\` FROM \`${table}\` WHERE \`local_id\` = ?`,
		[localId],
	);
	return row.status;
}

describe("O3: a till resends what a crash left mid-send to the hub", () => {
	it("queues a sale left 'syncing' again when the till starts", async () => {
		const { local_id } = await invoke<{ local_id: string }>("db:add-pending-invoice", {
			data: { customer: "Walk-in Customer", items: [] },
			grand_total: 10,
		});
		await execute("UPDATE `pending_invoices` SET `status` = 'syncing' WHERE `local_id` = ?", [local_id]);

		await initTillClient("http://127.0.0.1:1", "TILL-01");

		expect(await statusOf("pending_invoices", local_id)).toBe("pending");
	});

	it("queues a purchase order left 'syncing' again when the till starts", async () => {
		const { local_id } = await invoke<{ local_id: string }>("db:add-pending-purchase", {
			type: "purchase_order",
			data: { supplier: "Test Supplier", items: [] },
			grand_total: 5,
		});
		await execute("UPDATE `pending_purchases` SET `status` = 'syncing' WHERE `local_id` = ?", [local_id]);

		await initTillClient("http://127.0.0.1:1", "TILL-01");

		expect(await statusOf("pending_purchases", local_id)).toBe("pending");
	});

	it("leaves a synced sale alone", async () => {
		const { local_id } = await invoke<{ local_id: string }>("db:add-pending-invoice", {
			data: { customer: "Walk-in Customer", items: [] },
			grand_total: 10,
		});
		await execute("UPDATE `pending_invoices` SET `status` = 'synced' WHERE `local_id` = ?", [local_id]);

		await initTillClient("http://127.0.0.1:1", "TILL-01");

		expect(await statusOf("pending_invoices", local_id)).toBe("synced");
	});
});
