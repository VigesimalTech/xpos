/**
 * K19: the manager-approval permissions reach the till with each cashier pull, and a
 * field the till has no column for no longer fails the whole pull.
 *
 * A till stores each field of a pulled cashier in a column of its own. The server sends
 * the newer permission keys only to a till that asks for them by name, so an older till
 * keeps working; from here on, a till also skips any field it does not know.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invoke, setOnline } from "./support/electronShim";
import { FakeFrappe } from "./support/fakeFrappe";
import { closeTestDb, createTestDb } from "./support/localDb";
import { execute, upsertBatch } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";

const GET_POS_USERS = "xpos.api.auth.get_pos_users";
const APPROVAL_KEYS = [
	"approve_exceptions",
	"void_after_payment",
	"no_sale_drawer",
	"return_without_receipt",
];

const frappe = new FakeFrappe();
let serverUrl = "";

/** One sync cycle against the fake server, the way the till runs them. */
async function syncOnce(): Promise<void> {
	stopSyncEngine();
	initSyncEngine({ serverUrl, csrfToken: "", sessionCookies: "", apiKey: "k", apiSecret: "s" });
	await runSyncCyclePublic();
}

function manager(extra: Record<string, unknown> = {}) {
	return {
		name: "manager@example.com",
		username: "manager",
		full_name: "Manager",
		enabled: 1,
		password_hash: "",
		pin_hash: "",
		pin_salt: "",
		role: "Manager",
		pos_profile: "Test POS",
		warehouse: "Stores",
		company: "Test Co",
		discount_limit: 30,
		modified: "2026-09-21 08:00:00", // as Frappe sends it; MariaDB refuses an ISO "Z" datetime
		approve_exceptions: 1,
		void_after_payment: 1,
		no_sale_drawer: 0,
		return_without_receipt: 1,
		...extra,
	};
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
	frappe.reset();
	setOnline(true);
	await execute("DELETE FROM `pos_users`");
	await execute("DELETE FROM `sync_meta`");
});

describe("K19: approval permissions on the till", () => {
	it("asks for the approval permissions by name when it pulls cashiers", async () => {
		frappe.on(GET_POS_USERS, () => [manager()]);

		await syncOnce();

		const [call] = frappe.callsTo(GET_POS_USERS);
		const fields = typeof call.args.fields === "string" ? JSON.parse(call.args.fields) : call.args.fields;
		expect(fields).toEqual(expect.arrayContaining(APPROVAL_KEYS));
	});

	it("keeps each cashier's approval permissions", async () => {
		frappe.on(GET_POS_USERS, () => [manager()]);

		await syncOnce();

		const user = await invoke<Record<string, unknown>>("db:get-pos-user", "manager@example.com");
		expect(user).toMatchObject({
			approve_exceptions: 1,
			void_after_payment: 1,
			no_sale_drawer: 0,
			return_without_receipt: 1,
		});
	});

	it("skips a field it has no column for, instead of failing the pull", async () => {
		frappe.on(GET_POS_USERS, () => [manager({ a_field_from_a_newer_server: 1 })]);

		await syncOnce();

		const user = await invoke<Record<string, unknown>>("db:get-pos-user", "manager@example.com");
		expect(user).toMatchObject({ name: "manager@example.com", approve_exceptions: 1 });
		expect(user).not.toHaveProperty("a_field_from_a_newer_server");
	});

	it("writes nothing for a row that is only unknown fields", async () => {
		await expect(upsertBatch("pos_users", [{ nothing_known: 1 }], "name")).resolves.toBe(0);
	});
});
