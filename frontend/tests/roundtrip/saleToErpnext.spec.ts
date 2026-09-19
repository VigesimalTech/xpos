/**
 * A sale made on the desktop till, synced to a real ERPNext: the Sales
 * Invoice exists once, with the right total and payment, and stock goes down.
 */
import { readFileSync } from "fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoke, setOnline } from "../integration/support/electronShim";
import { closeTestDb, createTestDb } from "../integration/support/localDb";
import { execute, query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";

interface Site {
	url: string;
	company: string;
	warehouse: string;
	item: string;
	rate: number;
	customer: string;
	pos_profile: string;
	user: string;
	api_key: string;
	api_secret: string;
}

const configPath = process.env.XPOS_RT_CONFIG;
const site: Site = configPath
	? {
			url: process.env.XPOS_RT_URL || "http://test_site:8000",
			...JSON.parse(readFileSync(configPath, "utf8")),
		}
	: (null as never);

async function erp<T>(path: string): Promise<T> {
	const res = await fetch(`${site.url}${path}`, {
		headers: { Authorization: `token ${site.api_key}:${site.api_secret}`, Accept: "application/json" },
	});
	const body = await res.json();
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
	return body as T;
}

async function invoicesFor(localId: string) {
	const filters = encodeURIComponent(JSON.stringify([["xpos_local_id", "=", localId]]));
	const fields = encodeURIComponent(
		JSON.stringify([
			"name",
			"docstatus",
			"grand_total",
			"paid_amount",
			"is_pos",
			"update_stock",
			"pos_profile",
		]),
	);
	const { data } = await erp<{ data: Record<string, unknown>[] }>(
		`/api/resource/Sales Invoice?filters=${filters}&fields=${fields}`,
	);
	return data;
}

async function stockQty(): Promise<number> {
	const { message } = await erp<{ message: number | null }>(
		`/api/method/frappe.client.get_value?doctype=Bin&fieldname=actual_qty&filters=${encodeURIComponent(
			JSON.stringify({ item_code: site.item, warehouse: site.warehouse }),
		)}`,
	);
	return Number((message as unknown as { actual_qty?: number })?.actual_qty ?? 0);
}

async function sync(): Promise<void> {
	await runSyncCyclePublic();
}

async function openShift(): Promise<number> {
	const { id } = await invoke<{ id: number }>("db:create-pos-opening-shift", {
		pos_profile: site.pos_profile,
		user: site.user,
		company: site.company,
		opening_amounts: [{ mode_of_payment: "Cash", opening_amount: 0 }],
	});
	return id;
}

async function ringUpSale(shiftId: number, qty: number): Promise<string> {
	const total = qty * site.rate;
	const { local_id } = await invoke<{ local_id: string }>("db:add-pending-invoice", {
		data: {
			pos_profile: site.pos_profile,
			customer: site.customer,
			items: [
				{
					item_code: site.item,
					qty,
					rate: site.rate,
					price_list_rate: site.rate,
					uom: "Nos",
				},
			],
			payments: [{ mode_of_payment: "Cash", amount: total }],
			pos_opening_shift_local_id: shiftId,
			is_return: 0,
		},
		customer_name: site.customer,
		grand_total: total,
	});
	return local_id;
}

describe.skipIf(!configPath)("O2: a sale from the till lands correctly in ERPNext", () => {
	let shiftId = 0;

	beforeAll(async () => {
		await createTestDb();
		registerDbHandlers();
		setOnline(true);
		initSyncEngine({
			serverUrl: site.url,
			csrfToken: "",
			sessionCookies: "",
			apiKey: site.api_key,
			apiSecret: site.api_secret,
		});
		shiftId = await openShift();
	});

	afterAll(async () => {
		stopSyncEngine();
		await closeTestDb();
	});

	it("creates one submitted POS Sales Invoice with the right total and payment", async () => {
		const localId = await ringUpSale(shiftId, 2);
		const stockBefore = await stockQty();

		await sync();

		const [local] = await query<{ status: string; error: string | null; server_name: string | null }>(
			"SELECT `status`, `error`, `server_name` FROM `pending_invoices` WHERE `local_id` = ?",
			[localId],
		);
		expect(local, `sync error: ${local?.error}`).toMatchObject({ status: "synced" });

		const invoices = await invoicesFor(localId);
		expect(invoices).toHaveLength(1);
		expect(invoices[0]).toMatchObject({
			name: local.server_name,
			docstatus: 1,
			is_pos: 1,
			pos_profile: site.pos_profile,
			grand_total: 2 * site.rate,
			paid_amount: 2 * site.rate,
		});
		expect(await stockQty()).toBe(stockBefore - 2);
	});

	it("does not create a second invoice when the till sends the same sale again", async () => {
		const localId = await ringUpSale(shiftId, 1);
		await sync();
		const stockAfterFirst = await stockQty();

		// A lost reply: the till never saw the result, so it sends again.
		await execute("UPDATE `pending_invoices` SET `status` = 'pending' WHERE `local_id` = ?", [localId]);
		await sync();

		expect(await invoicesFor(localId)).toHaveLength(1);
		expect(await stockQty()).toBe(stockAfterFirst);
	});
});
