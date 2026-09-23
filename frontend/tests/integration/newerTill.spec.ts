/**
 * K41: a till newer than its ERPNext. The till asks for a POS Profile field the server
 * does not have yet, and Frappe refuses the whole query with HTTP 417 "Field not permitted
 * in query". The till leaves that field out and still gets the rest of the profile.
 *
 * K40: clearing the till's pending data is refused while a sale is unsent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "./support/electronShim";
import { FakeFrappe, FrappeError } from "./support/fakeFrappe";
import { clearSyncTables, createTestDb, closeTestDb } from "./support/localDb";
import { execute, query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";

const GET_LIST = "frappe.client.get_list";
const NEW_FIELD = "xpos_sync_status_detail";

const frappe = new FakeFrappe();
let serverUrl = "";

const asked = (args: Record<string, unknown>) =>
	typeof args.fields === "string"
		? (JSON.parse(args.fields) as string[])
		: ((args.fields as string[]) ?? []);

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
	frappe.reset();
	await clearSyncTables();
	await execute("DELETE FROM `pos_profiles`");
	initSyncEngine({ serverUrl, csrfToken: "", sessionCookies: "", apiKey: "k", apiSecret: "s" });
});

describe("a till newer than its server", () => {
	it("pulls its POS Profiles without the field the server does not know", async () => {
		// An older server: POS Profile has every field the till asks for but the new one.
		frappe.on(GET_LIST, (args) => {
			if (args.doctype !== "POS Profile") return [];
			if (asked(args).includes(NEW_FIELD))
				throw new FrappeError(417, `Field not permitted in query: ${NEW_FIELD}`);
			return [{ name: "Shop 1", company: "Test Co", modified: "2026-09-23 10:00:00" }];
		});

		await runSyncCyclePublic();

		const profiles = await query<{ name: string }>("SELECT `name` FROM `pos_profiles`");
		expect(profiles.map((p) => p.name)).toEqual(["Shop 1"]);
		const profilePulls = frappe.callsTo(GET_LIST).filter((c) => c.args.doctype === "POS Profile");
		expect(asked(profilePulls.at(-1)!.args)).not.toContain(NEW_FIELD);
		expect(asked(profilePulls.at(-1)!.args)).toContain("xpos_screen_access");
	});

	it("still fails a pull for any other error", async () => {
		frappe.on(GET_LIST, (args) => {
			if (args.doctype === "POS Profile") throw new FrappeError(403, "Not permitted");
			return [];
		});

		await runSyncCyclePublic();

		expect(await query("SELECT `name` FROM `pos_profiles`")).toEqual([]);
	});
});

describe("clearing the till's pending data", () => {
	it("is refused while a sale is unsent, and says so", async () => {
		await invoke("db:add-pending-invoice", {
			data: {
				customer: "Walk-in Customer",
				pos_profile: "Shop 1",
				items: [{ item_code: "X", qty: 1, rate: 10 }],
				payments: [{ mode_of_payment: "Cash", amount: 10 }],
			},
			customer_name: "Walk-in Customer",
			grand_total: 10,
		});

		const result = await invoke<{ cleared: boolean; waiting: string }>("db:clear-pending-data");

		expect(result).toMatchObject({ cleared: false, waiting: "1 sale" });
		expect(await query("SELECT `id` FROM `pending_invoices`")).toHaveLength(1);
	});
});
