/**
 * K18: every synced sale is checked against the cashier's rights in ERPNext.
 *
 * Each till syncs with its own API key, which is not an admin, and says which
 * cashier made the sale. The server records the cashier, and flags (or, where
 * the POS Profile says so, rejects) a sale that goes beyond what that cashier
 * may do alone: here, a discount over their limit.
 */
import { readFileSync } from "fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoke, setOnline } from "../integration/support/electronShim";
import { closeTestDb, createTestDb } from "../integration/support/localDb";
import { query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";

interface Keys {
	api_key: string;
	api_secret: string;
}
interface Site extends Keys {
	url: string;
	company: string;
	item: string;
	rate: number;
	customer: string;
	pos_profile: string;
	pos_profile_2: string;
	tills: Record<string, Keys>;
	discount_limits: Record<string, number>;
	reject_profile: string;
}

const configPath = process.env.XPOS_RT_CONFIG;
const site: Site = configPath
	? {
			url: process.env.XPOS_RT_URL || "http://test_site:8000",
			...JSON.parse(readFileSync(configPath, "utf8")),
		}
	: (null as never);

const CASHIER = "rt-cashier@example.com"; // on the first shop, limit 10%
const OTHER_SHOP_CASHIER = "rt-other@example.com"; // on the second shop only, limit 0

type ServerInvoice = {
	name: string;
	docstatus: number;
	xpos_cashier: string;
	xpos_policy_flags: string | null;
};

async function invoiceFor(localId: string): Promise<ServerInvoice | undefined> {
	const filters = encodeURIComponent(JSON.stringify([["xpos_local_id", "=", localId]]));
	const fields = encodeURIComponent(
		JSON.stringify(["name", "docstatus", "xpos_cashier", "xpos_policy_flags"]),
	);
	const res = await fetch(`${site.url}/api/resource/Sales Invoice?filters=${filters}&fields=${fields}`, {
		headers: { Authorization: `token ${site.api_key}:${site.api_secret}`, Accept: "application/json" },
	});
	const body = (await res.json()) as { data: ServerInvoice[] };
	if (!res.ok) throw new Error(`Sales Invoice: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
	return body.data[0];
}

async function localRow(localId: string) {
	const [row] = await query<{ status: string; error: string | null }>(
		"SELECT `status`, `error` FROM `pending_invoices` WHERE `local_id` = ?",
		[localId],
	);
	return row;
}

/** Sync as a shop's till, the way a till signed in to that shop does. */
function syncAsTill(profile: string): Promise<void> {
	stopSyncEngine();
	const keys = site.tills[profile];
	initSyncEngine({
		serverUrl: site.url,
		csrfToken: "",
		sessionCookies: "",
		apiKey: keys.api_key,
		apiSecret: keys.api_secret,
	});
	return runSyncCyclePublic();
}

async function openShift(profile: string, cashier: string): Promise<number> {
	const { id } = await invoke<{ id: number }>("db:create-pos-opening-shift", {
		pos_profile: profile,
		user: cashier,
		company: site.company,
		opening_amounts: [{ mode_of_payment: "Cash", opening_amount: 0 }],
	});
	return id;
}

/** One unit at the list price, less `discountPct` off the cart, rung up by `cashier`. */
async function ringUpSale(
	profile: string,
	shiftId: number,
	cashier: string,
	discountPct = 0,
): Promise<string> {
	const total = site.rate * (1 - discountPct / 100);
	const { local_id } = await invoke<{ local_id: string }>("db:add-pending-invoice", {
		data: {
			pos_profile: profile,
			customer: site.customer,
			items: [
				{ item_code: site.item, qty: 1, rate: site.rate, price_list_rate: site.rate, uom: "Nos" },
			],
			additional_discount_percentage: discountPct,
			apply_discount_on: "Grand Total",
			payments: [{ mode_of_payment: "Cash", amount: total }],
			pos_opening_shift_local_id: shiftId,
			xpos_cashier: cashier,
			is_return: 0,
		},
		customer_name: site.customer,
		grand_total: total,
	});
	return local_id;
}

describe.skipIf(!configPath)("K18: the server checks each sale against the cashier's rights", () => {
	let shop1Shift = 0;
	let shop2Shift = 0;

	beforeAll(async () => {
		await createTestDb();
		registerDbHandlers();
		setOnline(true);
		expect(site.discount_limits[`${CASHIER}|${site.pos_profile}`]).toBe(10);
		expect(site.reject_profile).toBe(site.pos_profile_2);
		shop1Shift = await openShift(site.pos_profile, CASHIER);
		shop2Shift = await openShift(site.pos_profile_2, OTHER_SHOP_CASHIER);
	});

	afterAll(async () => {
		stopSyncEngine();
		await closeTestDb();
	});

	it("records the cashier, not the till's API user, on a sale within policy", async () => {
		const localId = await ringUpSale(site.pos_profile, shop1Shift, CASHIER);

		await syncAsTill(site.pos_profile);

		const local = await localRow(localId);
		expect(local, `sync error: ${local?.error}`).toMatchObject({ status: "synced" });
		expect(await invoiceFor(localId)).toMatchObject({ docstatus: 1, xpos_cashier: CASHIER });
		expect((await invoiceFor(localId))?.xpos_policy_flags || "").toBe("");
	});

	it("accepts a discount within the cashier's limit", async () => {
		const localId = await ringUpSale(site.pos_profile, shop1Shift, CASHIER, 10);

		await syncAsTill(site.pos_profile);

		const local = await localRow(localId);
		expect(local, `sync error: ${local?.error}`).toMatchObject({ status: "synced" });
		expect((await invoiceFor(localId))?.xpos_policy_flags || "").not.toContain("discount limit");
	});

	it("records a discount over the cashier's limit and flags it with the reason", async () => {
		const localId = await ringUpSale(site.pos_profile, shop1Shift, CASHIER, 25);

		await syncAsTill(site.pos_profile);

		const local = await localRow(localId);
		expect(local, `sync error: ${local?.error}`).toMatchObject({ status: "synced" });
		const invoice = await invoiceFor(localId);
		expect(invoice).toMatchObject({ docstatus: 1, xpos_cashier: CASHIER });
		expect(invoice?.xpos_policy_flags).toContain(
			"25% cart discount, over rt-cashier@example.com's discount limit of 10%",
		);
	});

	it("flags a sale by a cashier who is not on the shop's POS Profile", async () => {
		const localId = await ringUpSale(site.pos_profile, shop1Shift, OTHER_SHOP_CASHIER);

		await syncAsTill(site.pos_profile);

		const local = await localRow(localId);
		expect(local, `sync error: ${local?.error}`).toMatchObject({ status: "synced" });
		expect((await invoiceFor(localId))?.xpos_policy_flags).toContain(
			`Cashier ${OTHER_SHOP_CASHIER} is not on POS Profile ${site.pos_profile}`,
		);
	});

	it("refuses an out-of-policy sale where the POS Profile says Reject, and the till keeps it", async () => {
		// Limit 0: no discount without a manager.
		const localId = await ringUpSale(site.pos_profile_2, shop2Shift, OTHER_SHOP_CASHIER, 5);

		await syncAsTill(site.pos_profile_2);

		const local = await localRow(localId);
		expect(local.status).not.toBe("synced");
		expect(local.error).toContain("outside the POS Profile's policy");
		expect(await invoiceFor(localId)).toBeUndefined();
	});

	it("accepts a sale within policy on the Reject shop", async () => {
		const localId = await ringUpSale(site.pos_profile_2, shop2Shift, OTHER_SHOP_CASHIER);

		await syncAsTill(site.pos_profile_2);

		const local = await localRow(localId);
		expect(local, `sync error: ${local?.error}`).toMatchObject({ status: "synced" });
		expect(await invoiceFor(localId)).toMatchObject({ docstatus: 1, xpos_cashier: OTHER_SHOP_CASHIER });
	});
});
