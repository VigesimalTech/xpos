/**
 * Expenses and bank drops taken on the till reach ERPNext: the sync engine
 * against the real local database and a fake Frappe server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invoke, rendererEvents, setOnline } from "./support/electronShim";
import { FakeFrappe, FrappeError } from "./support/fakeFrappe";
import { clearSyncTables, createTestDb, closeTestDb } from "./support/localDb";
import { query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";

const SYNC_CASH_MOVEMENT = "xpos.api.cash_movements.sync_cash_movement";
const CREATE_OPENING_SHIFT = "xpos.api.shifts.create_opening_shift";
const CREATE_CLOSING_SHIFT = "xpos.api.shifts.create_closing_shift";
const CASHIER = "cashier@example.com";

const frappe = new FakeFrappe();
let serverUrl = "";

async function openShift(): Promise<number> {
	const { id } = await invoke<{ id: number }>("db:create-pos-opening-shift", {
		pos_profile: "Test POS Profile",
		user: CASHIER,
		company: "Test Company",
		opening_amounts: [{ mode_of_payment: "Cash", opening_amount: 100 }],
	});
	return id;
}

async function recordExpense(shiftId: number, amount = 25): Promise<number> {
	const { id } = await invoke<{ id: number }>("db:create-expense", {
		to_account: "Travel - TC",
		amount,
		remarks: "Taxi",
		posting_date: "2026-09-19",
		user: CASHIER,
		pos_opening_entry_id: shiftId,
	});
	return id;
}

async function recordBankDrop(shiftId: number, amount = 500): Promise<number> {
	const { id } = await invoke<{ id: number }>("db:create-bank-drop", {
		to_account: "Back Office Cash - TC",
		amount,
		remarks: "Evening drop",
		posting_date: "2026-09-19",
		user: CASHIER,
		pos_opening_entry_id: shiftId,
	});
	return id;
}

function sent(call: { args: Record<string, unknown> }) {
	const data = call.args.data;
	return (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown>;
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
	initSyncEngine({ serverUrl, csrfToken: "", sessionCookies: "", apiKey: "k", apiSecret: "s" });
	frappe.on(CREATE_OPENING_SHIFT, () => ({ name: "POS-OPEN-0001" }));
});

describe("expenses and bank drops reach ERPNext", () => {
	it("an expense is sent for the cashier, against the server's shift, on the till's date", async () => {
		const shift = await openShift();
		await recordExpense(shift);

		await runSyncCyclePublic();

		const calls = frappe.callsTo(SYNC_CASH_MOVEMENT);
		expect(calls).toHaveLength(1);
		expect(sent(calls[0])).toMatchObject({
			movement_type: "Expense",
			pos_opening_shift: "POS-OPEN-0001",
			account: "Travel - TC",
			amount: 25,
			remarks: "Taxi",
			posting_date: "2026-09-19",
			cashier: CASHIER,
		});
		const [row] = await query<{ local_id: string; sync_status: string; erp_id: string }>(
			"SELECT `local_id`, `sync_status`, `erp_id` FROM `expenses`",
		);
		expect(calls[0].args.local_id).toBe(row.local_id);
		expect(row.local_id).toMatch(/^[0-9a-f-]{36}$/);
		expect(row.sync_status).toBe("synced");
		expect(row.erp_id).toBeTruthy();
	});

	it("K19: a movement a manager approved on the till is sent with the approver", async () => {
		const shift = await openShift();
		await invoke("db:create-expense", {
			to_account: "Travel - TC",
			amount: 25,
			remarks: "Taxi",
			posting_date: "2026-09-19",
			user: CASHIER,
			pos_opening_entry_id: shift,
			approved_by: "manager@example.com",
		});
		await recordBankDrop(shift);

		await runSyncCyclePublic();

		const [expense, drop] = frappe.callsTo(SYNC_CASH_MOVEMENT).map(sent);
		expect(expense).toMatchObject({ cashier: CASHIER, xpos_approved_by: "manager@example.com" });
		expect(drop).not.toHaveProperty("xpos_approved_by");
	});

	it("a bank drop is sent as a deposit", async () => {
		const shift = await openShift();
		await recordBankDrop(shift);

		await runSyncCyclePublic();

		const [call] = frappe.callsTo(SYNC_CASH_MOVEMENT);
		expect(sent(call)).toMatchObject({
			movement_type: "Deposit",
			account: "Back Office Cash - TC",
			amount: 500,
		});
	});

	it("is sent after its shift and before the shift's close, so the close counts it", async () => {
		const shift = await openShift();
		await recordExpense(shift);
		await recordBankDrop(shift);
		await invoke("db:create-pos-closing-entry", {
			pos_opening_entry_id: shift,
			pos_profile: "Test POS Profile",
			user: CASHIER,
			company: "Test Company",
			details: [],
		});

		await runSyncCyclePublic();

		const order = frappe.calls
			.map((c) => c.method)
			.filter((m) => [CREATE_OPENING_SHIFT, SYNC_CASH_MOVEMENT, CREATE_CLOSING_SHIFT].includes(m));
		expect(order).toEqual([
			CREATE_OPENING_SHIFT,
			SYNC_CASH_MOVEMENT,
			SYNC_CASH_MOVEMENT,
			CREATE_CLOSING_SHIFT,
		]);
	});

	it("waits while its shift has not reached ERPNext", async () => {
		frappe.on(CREATE_OPENING_SHIFT, () => {
			throw new FrappeError(503, "down");
		});
		const shift = await openShift();
		await recordExpense(shift);

		await runSyncCyclePublic();

		expect(frappe.callsTo(SYNC_CASH_MOVEMENT)).toHaveLength(0);
		const [row] = await query<{ sync_status: string }>("SELECT `sync_status` FROM `expenses`");
		expect(row.sync_status).toBe("pending");
	});

	it("keeps ERPNext's reason when it is refused, and tries again next time", async () => {
		frappe.on(SYNC_CASH_MOVEMENT, () => {
			throw new FrappeError(417, "POS Expense is disabled for POS Profile Test POS Profile.");
		});
		const shift = await openShift();
		await recordExpense(shift);

		await runSyncCyclePublic();

		const [row] = await query<{ sync_status: string; error: string }>(
			"SELECT `sync_status`, `error` FROM `expenses`",
		);
		expect(row.sync_status).toBe("failed");
		expect(row.error).toContain("POS Expense is disabled");

		frappe.on(SYNC_CASH_MOVEMENT, () => ({ name: "POS-CM-0001" }));
		await runSyncCyclePublic();
		const [after] = await query<{ sync_status: string; error: string | null }>(
			"SELECT `sync_status`, `error` FROM `expenses`",
		);
		expect(after).toEqual({ sync_status: "synced", error: null });
	});

	it("can be deleted until it reaches ERPNext, not after", async () => {
		const shift = await openShift();
		const unsent = await recordExpense(shift, 10);
		expect(await invoke("db:delete-expense", unsent)).toBe(true);

		const sentId = await recordExpense(shift, 20);
		await runSyncCyclePublic();
		expect(await invoke("db:delete-expense", sentId)).toBe(false);
		expect(await query("SELECT `id` FROM `expenses`")).toHaveLength(1);
	});
});
