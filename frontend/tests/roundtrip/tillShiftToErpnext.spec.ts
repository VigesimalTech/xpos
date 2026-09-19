/**
 * A day on the till, synced to a real ERPNext as the till's own API user: its
 * expenses and bank drops are posted once, for the cashier, and its close is made
 * by ERPNext from its own records, taking only the cash the cashier counted.
 */
import { readFileSync } from "fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoke, setOnline } from "../integration/support/electronShim";
import { closeTestDb, createTestDb } from "../integration/support/localDb";
import { execute, query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";

interface Keys {
	api_key: string;
	api_secret: string;
}
interface Site {
	url: string;
	company: string;
	item: string;
	rate: number;
	customer: string;
	pos_profile: string;
	api_key: string;
	api_secret: string;
	tills: Record<string, Keys>;
	supervisor: string;
	expense_account: string;
	deposit_account: string;
}

const configPath = process.env.XPOS_RT_CONFIG;
const site: Site = configPath
	? {
			url: process.env.XPOS_RT_URL || "http://test_site:8000",
			...JSON.parse(readFileSync(configPath, "utf8")),
		}
	: (null as never);

/** Read as the admin key: the checks are about what ERPNext holds, not what the till may read. */
async function erp<T>(path: string): Promise<T> {
	const res = await fetch(`${site.url}${path}`, {
		headers: { Authorization: `token ${site.api_key}:${site.api_secret}`, Accept: "application/json" },
	});
	const body = await res.json();
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
	return body as T;
}

async function list(doctype: string, filters: unknown[], fields: string[]) {
	const q = `filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(fields))}`;
	const { data } = await erp<{ data: Record<string, any>[] }>(`/api/resource/${doctype}?${q}`);
	return data;
}

const EXPENSE = 10;
const DROP = 20;

describe.skipIf(!configPath)("P6, P8: a till's cash and close land correctly in ERPNext", () => {
	let shiftId = 0;
	let serverShift = "";

	beforeAll(async () => {
		await createTestDb();
		registerDbHandlers();
		setOnline(true);
		const till = site.tills[site.pos_profile];
		initSyncEngine({
			serverUrl: site.url,
			csrfToken: "",
			sessionCookies: "",
			apiKey: till.api_key,
			apiSecret: till.api_secret,
		});

		({ id: shiftId } = await invoke<{ id: number }>("db:create-pos-opening-shift", {
			pos_profile: site.pos_profile,
			user: site.supervisor,
			company: site.company,
			opening_amounts: [{ mode_of_payment: "Cash", opening_amount: 0 }],
		}));
		await invoke("db:add-pending-invoice", {
			data: {
				pos_profile: site.pos_profile,
				customer: site.customer,
				items: [
					{ item_code: site.item, qty: 1, rate: site.rate, price_list_rate: site.rate, uom: "Nos" },
				],
				payments: [{ mode_of_payment: "Cash", amount: site.rate }],
				pos_opening_shift_local_id: String(shiftId),
				xpos_cashier: site.supervisor,
				is_return: 0,
			},
			customer_name: site.customer,
			grand_total: site.rate,
		});
		await invoke("db:create-expense", {
			to_account: site.expense_account,
			amount: EXPENSE,
			remarks: "RT taxi",
			user: site.supervisor,
			pos_opening_entry_id: shiftId,
		});
		await invoke("db:create-bank-drop", {
			to_account: site.deposit_account,
			amount: DROP,
			remarks: "RT drop",
			user: site.supervisor,
			pos_opening_entry_id: shiftId,
		});
		const counted = site.rate - EXPENSE - DROP;
		await invoke("db:create-pos-closing-entry", {
			pos_opening_entry_id: shiftId,
			pos_profile: site.pos_profile,
			user: site.supervisor,
			company: site.company,
			payment_details: [
				{
					mode_of_payment: "Cash",
					opening_amount: 0,
					expected_amount: counted,
					closing_amount: counted,
				},
			],
		});
		await invoke("db:close-pos-shift", shiftId);

		await runSyncCyclePublic();

		const [row] = await query<{ erp_id: string }>(
			"SELECT `erp_id` FROM `pos_opening_shifts` WHERE `id` = ?",
			[shiftId],
		);
		serverShift = row?.erp_id;
	});

	afterAll(async () => {
		stopSyncEngine();
		await closeTestDb();
	});

	it("opens the shift in ERPNext for the cashier", async () => {
		expect(serverShift).toBeTruthy();
		const [shift] = await list(
			"POS Opening Shift",
			[["name", "=", serverShift]],
			["user", "pos_profile"],
		);
		expect(shift).toMatchObject({ user: site.supervisor, pos_profile: site.pos_profile });
	});

	it("posts the expense and the bank drop once each, for the cashier", async () => {
		const failed = await query<{ error: string }>(
			"SELECT `error` FROM `expenses` WHERE `sync_status` <> 'synced' UNION ALL SELECT `error` FROM `bank_drops` WHERE `sync_status` <> 'synced'",
		);
		expect(failed, JSON.stringify(failed)).toHaveLength(0);

		const movements = await list(
			"POS Cash Movement",
			[["pos_opening_shift", "=", serverShift]],
			["movement_type", "amount", "user", "docstatus", "journal_entry"],
		);
		expect(movements).toHaveLength(2);
		for (const m of movements) {
			expect(m).toMatchObject({ user: site.supervisor, docstatus: 1 });
			expect(m.journal_entry).toBeTruthy();
		}
		expect(movements.map((m) => [m.movement_type, m.amount]).sort()).toEqual([
			["Deposit", DROP],
			["Expense", EXPENSE],
		]);
	});

	it("closes the shift from ERPNext's records, with the cash counted on the till", async () => {
		const [closing] = await list(
			"POS Closing Shift",
			[["pos_opening_shift", "=", serverShift]],
			["name", "docstatus", "user"],
		);
		expect(closing, "no POS Closing Shift").toBeTruthy();
		expect(closing).toMatchObject({ docstatus: 1, user: site.supervisor });

		const { data } = await erp<{ data: { payment_reconciliation: Record<string, any>[] } }>(
			`/api/resource/POS Closing Shift/${encodeURIComponent(closing.name)}`,
		);
		const cash = data.payment_reconciliation.find((r) => r.mode_of_payment === "Cash");
		// ERPNext's expected: the sale, less the expense and the bank drop.
		expect(cash).toMatchObject({
			expected_amount: site.rate - EXPENSE - DROP,
			closing_amount: site.rate - EXPENSE - DROP,
			difference: 0,
		});
	});

	it("does not post anything twice when the till sends it all again", async () => {
		for (const table of ["expenses", "bank_drops", "pos_closing_entries"]) {
			await execute(`UPDATE \`${table}\` SET \`sync_status\` = 'pending'`);
		}
		await runSyncCyclePublic();

		expect(
			await list("POS Cash Movement", [["pos_opening_shift", "=", serverShift]], ["name"]),
		).toHaveLength(2);
		expect(
			await list(
				"POS Closing Shift",
				[
					["pos_opening_shift", "=", serverShift],
					["docstatus", "=", 1],
				],
				["name"],
			),
		).toHaveLength(1);
	});
});
