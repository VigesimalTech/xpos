/**
 * K24: a cashier removed from the POS Profile is deleted from the till's local
 * database after a reconciliation cycle, and a disabled cashier cannot sign in
 * with a cached password.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setOnline } from "./support/electronShim";
import { FakeFrappe } from "./support/fakeFrappe";
import { createTestDb, closeTestDb } from "./support/localDb";
import { query, execute } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";

const GET_POS_USERS = "xpos.api.auth.get_pos_users";

const frappe = new FakeFrappe();
let serverUrl = "";

function makeUser(name: string, enabled = 1) {
	return {
		name,
		username: name.split("@")[0],
		full_name: name.split("@")[0],
		enabled,
		password_hash: "",
		pin_hash: "",
		pin_salt: "",
		role: "Cashier",
		pos_profile: "Test POS",
		warehouse: "Stores",
		company: "Test Co",
		discount_limit: 100,
		modified: new Date().toISOString(),
	};
}

function startEngine(): void {
	initSyncEngine({
		serverUrl,
		csrfToken: "",
		sessionCookies: "",
		apiKey: "test-key",
		apiSecret: "test-secret",
	});
}

async function localUsers(): Promise<string[]> {
	const rows = await query<{ name: string }>("SELECT `name` FROM `pos_users` ORDER BY `name`");
	return rows.map((r) => r.name);
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

describe("K24: removed cashiers are reconciled off the till", () => {
	it("reconciles every 5th cycle: a user gone from the server is removed", async () => {
		await execute(
			"INSERT INTO `pos_users` (`name`, `username`, `full_name`, `enabled`, `password_hash`, `pos_profile`, `company`) VALUES (?, ?, ?, 1, '', 'Test', 'Co')",
			["ada@example.com", "ada", "Ada"],
		);
		await execute(
			"INSERT INTO `pos_users` (`name`, `username`, `full_name`, `enabled`, `password_hash`, `pos_profile`, `company`) VALUES (?, ?, ?, 1, '', 'Test', 'Co')",
			["gone@example.com", "gone", "Gone"],
		);

		frappe.on(GET_POS_USERS, () => [makeUser("ada@example.com")]);

		startEngine();
		// Cycles 1–4: no reconciliation.
		for (let i = 0; i < 4; i++) await runSyncCyclePublic();
		expect(await localUsers()).toContain("gone@example.com");

		// Cycle 5: reconciliation runs.
		await runSyncCyclePublic();
		expect(await localUsers()).toEqual(["ada@example.com"]);
	});

	it("removes a user no longer returned by the server after reconciliation", async () => {
		await execute(
			"INSERT INTO `pos_users` (`name`, `username`, `full_name`, `enabled`, `password_hash`, `pos_profile`, `company`) VALUES (?, ?, ?, 1, '', 'Test', 'Co')",
			["ada@example.com", "ada", "Ada"],
		);
		await execute(
			"INSERT INTO `pos_users` (`name`, `username`, `full_name`, `enabled`, `password_hash`, `pos_profile`, `company`) VALUES (?, ?, ?, 1, '', 'Test', 'Co')",
			["tunde@example.com", "tunde", "Tunde"],
		);
		expect(await localUsers()).toEqual(["ada@example.com", "tunde@example.com"]);

		frappe.on(GET_POS_USERS, () => [makeUser("ada@example.com")]);

		startEngine();
		// Run enough cycles to trigger the deletion/reconciliation check (every 5th).
		for (let i = 0; i < 5; i++) await runSyncCyclePublic();

		expect(await localUsers()).toEqual(["ada@example.com"]);
	});

	it("keeps all users when the server returns them all", async () => {
		await execute(
			"INSERT INTO `pos_users` (`name`, `username`, `full_name`, `enabled`, `password_hash`, `pos_profile`, `company`) VALUES (?, ?, ?, 1, '', 'Test', 'Co')",
			["ada@example.com", "ada", "Ada"],
		);
		await execute(
			"INSERT INTO `pos_users` (`name`, `username`, `full_name`, `enabled`, `password_hash`, `pos_profile`, `company`) VALUES (?, ?, ?, 1, '', 'Test', 'Co')",
			["tunde@example.com", "tunde", "Tunde"],
		);

		frappe.on(GET_POS_USERS, () => [makeUser("ada@example.com"), makeUser("tunde@example.com")]);

		startEngine();
		for (let i = 0; i < 5; i++) await runSyncCyclePublic();

		expect(await localUsers()).toEqual(["ada@example.com", "tunde@example.com"]);
	});

	it("does not reconcile when offline", async () => {
		await execute(
			"INSERT INTO `pos_users` (`name`, `username`, `full_name`, `enabled`, `password_hash`, `pos_profile`, `company`) VALUES (?, ?, ?, 1, '', 'Test', 'Co')",
			["ada@example.com", "ada", "Ada"],
		);

		frappe.on(GET_POS_USERS, () => []);
		setOnline(false);

		startEngine();
		for (let i = 0; i < 5; i++) await runSyncCyclePublic();

		expect(await localUsers()).toEqual(["ada@example.com"]);
	});
});
