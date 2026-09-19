/**
 * Pushing sales made on the till to ERPNext: the sync engine against the
 * real local database and a fake Frappe server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invoke, rendererEvents, setOnline } from "./support/electronShim";
import { FakeFrappe, FrappeError } from "./support/fakeFrappe";
import { clearSyncTables, createTestDb, closeTestDb } from "./support/localDb";
import { query, execute } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";
import { SYNC_DEFAULTS } from "../../electron/sync/syncConfig";

const CREATE_INVOICE = "xpos.api.invoices.create_invoice";
const CREATE_PURCHASE_ORDER = "xpos.x_pos.api.purchase_orders.create_purchase_order";

const frappe = new FakeFrappe();
let serverUrl = "";

function startEngine(): void {
	initSyncEngine({
		serverUrl,
		csrfToken: "",
		sessionCookies: "",
		apiKey: "test-key",
		apiSecret: "test-secret",
	});
}

/** Queue a sale the way the till does when a payment completes. */
async function queueSale(total = 10): Promise<string> {
	const { local_id } = await invoke<{ local_id: string }>("db:add-pending-invoice", {
		data: {
			customer: "Walk-in Customer",
			pos_profile: "Test POS Profile",
			items: [{ item_code: "TEST-ITEM", qty: 1, rate: total }],
			payments: [{ mode_of_payment: "Cash", amount: total }],
		},
		customer_name: "Walk-in Customer",
		grand_total: total,
	});
	return local_id;
}

async function pendingInvoices() {
	return query<{
		local_id: string;
		status: string;
		server_name: string | null;
		error: string | null;
		retry_count: number;
	}>(
		"SELECT `local_id`, `status`, `server_name`, `error`, `retry_count` FROM `pending_invoices` ORDER BY `id`",
	);
}

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
	serverUrl = await frappe.start();
});

afterAll(async () => {
	stopSyncEngine();
	await frappe.stop();
	await closeTestDb();
});

beforeEach(async () => {
	stopSyncEngine();
	await clearSyncTables();
	frappe.reset();
	rendererEvents.length = 0;
	setOnline(true);
	startEngine();
});

describe("pushing sales to ERPNext", () => {
	it("O2: a queued sale is sent once, with its local id, and marked synced", async () => {
		const localId = await queueSale();

		await runSyncCyclePublic();
		await runSyncCyclePublic();

		const sent = frappe.callsTo(CREATE_INVOICE);
		expect(sent).toHaveLength(1);
		expect(sent[0].args.local_id).toBe(localId);
		expect(await pendingInvoices()).toMatchObject([
			{ local_id: localId, status: "synced", server_name: "SRV-1" },
		]);
	});

	it("O2: sales are sent oldest first", async () => {
		const first = await queueSale(1);
		const second = await queueSale(2);

		await runSyncCyclePublic();

		expect(frappe.callsTo(CREATE_INVOICE).map((c) => c.args.local_id)).toEqual([first, second]);
	});

	it("O1: nothing is sent while the till is offline, and it goes when back online", async () => {
		await queueSale();
		setOnline(false);

		await runSyncCyclePublic();
		expect(frappe.callsTo(CREATE_INVOICE)).toHaveLength(0);
		expect((await pendingInvoices())[0].status).toBe("pending");

		setOnline(true);
		await runSyncCyclePublic();
		expect((await pendingInvoices())[0].status).toBe("synced");
	});

	it("O3: a sale being sent when the till crashed is sent after restart", async () => {
		const localId = await queueSale();
		// The engine marks a sale 'syncing' just before the request. A crash or
		// power cut at that moment leaves it there.
		await execute("UPDATE `pending_invoices` SET `status` = 'syncing' WHERE `local_id` = ?", [localId]);

		stopSyncEngine();
		startEngine();
		await runSyncCyclePublic();

		expect(frappe.callsTo(CREATE_INVOICE).map((c) => c.args.local_id)).toEqual([localId]);
		expect((await pendingInvoices())[0].status).toBe("synced");
	});

	it("O3: a purchase order being sent when the till crashed is sent after restart", async () => {
		const { local_id } = await invoke<{ local_id: string }>("db:add-pending-purchase", {
			type: "purchase_order",
			data: { supplier: "Test Supplier", items: [{ item_code: "TEST-ITEM", qty: 1, rate: 5 }] },
			supplier_name: "Test Supplier",
			grand_total: 5,
		});
		await execute("UPDATE `pending_purchases` SET `status` = 'syncing' WHERE `local_id` = ?", [local_id]);

		stopSyncEngine();
		startEngine();
		await runSyncCyclePublic();

		expect(frappe.callsTo(CREATE_PURCHASE_ORDER).map((c) => c.args.local_id)).toEqual([local_id]);
	});

	it("O7: a sale ERPNext rejects keeps the reason and is retried, then set aside", async () => {
		const localId = await queueSale();
		frappe.on(CREATE_INVOICE, () => {
			throw new FrappeError(417, "Posting date is in a closed accounting period");
		});

		for (let i = 0; i < SYNC_DEFAULTS.maxRetries + 1; i++) await runSyncCyclePublic();

		expect(frappe.callsTo(CREATE_INVOICE)).toHaveLength(SYNC_DEFAULTS.maxRetries);
		const [row] = await pendingInvoices();
		expect(row.status).toBe("dead_letter");
		expect(row.retry_count).toBe(SYNC_DEFAULTS.maxRetries);
		expect(row.error).toContain("closed accounting period");
		expect(rendererEvents.filter((e) => e.channel === "sync-dead-letter")).toMatchObject([
			{ data: { localId, retryCount: SYNC_DEFAULTS.maxRetries } },
		]);
	});

	it("O7: one rejected sale does not hold back the others", async () => {
		const bad = await queueSale(1);
		const good = await queueSale(2);
		frappe.on(CREATE_INVOICE, (args) => {
			if (args.local_id === bad) throw new FrappeError(417, "Item TEST-ITEM is disabled");
			return { name: "SRV-GOOD" };
		});

		await runSyncCyclePublic();

		const rows = await pendingInvoices();
		expect(rows.find((r) => r.local_id === bad)?.status).toBe("failed");
		expect(rows.find((r) => r.local_id === good)).toMatchObject({
			status: "synced",
			server_name: "SRV-GOOD",
		});
	});
});
