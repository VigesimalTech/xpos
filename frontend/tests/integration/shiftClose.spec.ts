/**
 * Closing a shift on the till: the summary from the till's own records, the close
 * kept locally, and sync sending it once ERPNext has everything taken in the shift.
 * The real local database and sync engine against a fake Frappe server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invoke, rendererEvents, setOnline } from "./support/electronShim";
import { FakeFrappe, FrappeError } from "./support/fakeFrappe";
import { clearSyncTables, createTestDb, closeTestDb } from "./support/localDb";
import { execute, query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";

const CREATE_OPENING_SHIFT = "xpos.api.shifts.create_opening_shift";
const CREATE_INVOICE = "xpos.api.invoices.create_invoice";
const SYNC_CASH_MOVEMENT = "xpos.api.cash_movements.sync_cash_movement";
const CREATE_CLOSING_SHIFT = "xpos.api.shifts.create_closing_shift";
const CASHIER = "cashier@example.com";
const PROFILE = "Test POS Profile";

const frappe = new FakeFrappe();
let serverUrl = "";

async function openShift(user = CASHIER): Promise<number> {
	const { id } = await invoke<{ id: number }>("db:create-pos-opening-shift", {
		pos_profile: PROFILE,
		user,
		company: "Test Company",
		opening_amounts: [{ mode_of_payment: "Cash", opening_amount: 1000 }],
	});
	return id;
}

async function sell(shift: number, paid: number, extra: Record<string, unknown> = {}): Promise<void> {
	await invoke("db:add-pending-invoice", {
		data: {
			customer: "Walk-in",
			pos_profile: PROFILE,
			pos_opening_shift: String(shift),
			pos_opening_shift_local_id: String(shift),
			is_draft: false,
			items: [{ item_code: "ITEM", qty: 1, rate: paid }],
			payments: [{ mode_of_payment: "Cash", amount: paid }],
			receipt: { grand_total: paid, net_total: paid, currency: "NGN", taxes: [] },
			...extra,
		},
		customer_name: "Walk-in",
		grand_total: paid,
	});
}

async function closeOnTill(shift: number, counted: number, approvedBy?: string): Promise<void> {
	await invoke("db:create-pos-closing-entry", {
		...(approvedBy ? { approved_by: approvedBy } : {}),
		pos_opening_entry_id: shift,
		pos_profile: PROFILE,
		user: CASHIER,
		company: "Test Company",
		posting_date: "2026-09-19",
		payment_details: [
			{
				mode_of_payment: "Cash",
				opening_amount: 1000,
				expected_amount: counted,
				closing_amount: counted,
			},
		],
	});
	await invoke("db:close-pos-shift", shift);
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
	await execute("DELETE FROM `pos_opening_entry_details`");
	await execute("DELETE FROM `pos_closing_entry_details`");
	frappe.reset();
	rendererEvents.length = 0;
	setOnline(true);
	initSyncEngine({ serverUrl, csrfToken: "", sessionCookies: "", apiKey: "k", apiSecret: "s" });
	frappe.on(CREATE_OPENING_SHIFT, () => ({ name: "POS-OPEN-0001" }));
});

describe("closing a shift on the till", () => {
	it("sums the shift from the till's own records, offline", async () => {
		setOnline(false);
		const shift = await openShift();
		await sell(shift, 300);
		await sell(shift, 500, { payments: [{ mode_of_payment: "Cash", amount: 600 }], change_amount: 100 });
		await sell(shift, 999, { is_draft: true }); // a held order is not a sale
		const other = await openShift("other@example.com");
		await sell(other, 70); // another shift's sale
		await invoke("db:create-expense", {
			to_account: "Travel",
			amount: 50,
			user: CASHIER,
			pos_opening_entry_id: shift,
		});
		await invoke("db:create-bank-drop", {
			to_account: "Safe",
			amount: 200,
			user: CASHIER,
			pos_opening_entry_id: shift,
		});

		const summary = await invoke<Record<string, any>>("db:get-shift-closing-summary", shift);

		expect(summary.total_invoices).toBe(2);
		expect(summary.grand_total).toBe(800);
		expect(summary.opening_balances.Cash.amount).toBe(1000);
		// 1000 float + 300 + (600 - 100 change) - 50 expense - 200 bank drop
		expect(summary.expected_amounts.Cash.amount).toBe(1550);
		// P9: two sales and two cash movements have not reached ERPNext; the held order is not counted.
		expect(summary.unsent_count).toBe(4);
		expect(frappe.calls).toHaveLength(0);
	});

	it("sends the close after the shift, its sales and its cash movements, with the counted cash", async () => {
		const shift = await openShift();
		await sell(shift, 300);
		await invoke("db:create-expense", {
			to_account: "Travel",
			amount: 50,
			user: CASHIER,
			pos_opening_entry_id: shift,
		});
		await closeOnTill(shift, 1240);

		await runSyncCyclePublic();

		const order = frappe.calls
			.map((c) => c.method)
			.filter((m) =>
				[CREATE_OPENING_SHIFT, CREATE_INVOICE, SYNC_CASH_MOVEMENT, CREATE_CLOSING_SHIFT].includes(m),
			);
		expect(order).toEqual([
			CREATE_OPENING_SHIFT,
			SYNC_CASH_MOVEMENT,
			CREATE_INVOICE,
			CREATE_CLOSING_SHIFT,
		]);

		const [close] = frappe.callsTo(CREATE_CLOSING_SHIFT);
		expect(sent(close)).toMatchObject({
			pos_opening_shift: "POS-OPEN-0001",
			user: CASHIER,
			payment_reconciliation: [
				expect.objectContaining({ mode_of_payment: "Cash", closing_amount: 1240 }),
			],
		});
		const [row] = await query<{ sync_status: string }>("SELECT `sync_status` FROM `pos_closing_entries`");
		expect(row.sync_status).toBe("synced");
	});

	it("K19: a close a manager approved on the till is sent with the approver", async () => {
		const shift = await openShift();
		await closeOnTill(shift, 1000, "manager@example.com");

		await runSyncCyclePublic();

		const [close] = frappe.callsTo(CREATE_CLOSING_SHIFT);
		expect(sent(close)).toMatchObject({ user: CASHIER, xpos_approved_by: "manager@example.com" });
	});

	it("waits while a sale in the shift has not reached ERPNext", async () => {
		frappe.on(CREATE_INVOICE, () => {
			throw new FrappeError(503, "down");
		});
		const shift = await openShift();
		await sell(shift, 300);
		await closeOnTill(shift, 1300);

		await runSyncCyclePublic();

		expect(frappe.callsTo(CREATE_CLOSING_SHIFT)).toHaveLength(0);
		const [waiting] = await query<{ sync_status: string }>(
			"SELECT `sync_status` FROM `pos_closing_entries`",
		);
		expect(waiting.sync_status).toBe("pending");

		frappe.on(CREATE_INVOICE, () => ({ name: "ACC-SINV-0001" }));
		await runSyncCyclePublic();
		expect(frappe.callsTo(CREATE_CLOSING_SHIFT)).toHaveLength(1);
	});

	it("sends shifts and closes under the till's UUIDs, not its numeric ids", async () => {
		const shift = await openShift();
		await closeOnTill(shift, 1000);

		await runSyncCyclePublic();

		const uuid = /^[0-9a-f-]{36}$/;
		expect(frappe.callsTo(CREATE_OPENING_SHIFT)[0].args.local_id).toMatch(uuid);
		expect(frappe.callsTo(CREATE_CLOSING_SHIFT)[0].args.local_id).toMatch(uuid);
	});
});
