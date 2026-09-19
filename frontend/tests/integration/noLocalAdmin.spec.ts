/**
 * Only cashiers from ERPNext sign in on the till. Setup used to create a local
 * admin with a password that lived only on the till: ERPNext could not see,
 * disable or audit it, and sales made under it named no ERPNext user.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoke } from "./support/electronShim";
import { closeTestDb, createTestDb, testDbConfig } from "./support/localDb";
import { closeDatabase, execute, initDatabase, query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { hashPassword } from "../../electron/database/passwordHash";

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
});

afterAll(async () => {
	await closeTestDb();
});

describe("K23: no local admin on the till", () => {
	it("offers no way to create a till-only user", async () => {
		await expect(
			invoke("db:create-local-user", { username: "admin", password: "secret1", fullName: "Admin" }),
		).rejects.toThrow(/No IPC handler/);
	});

	it("removes a local admin left by an older setup, and keeps the cashiers from ERPNext", async () => {
		await execute("DELETE FROM `pos_users`");
		const { hash, salt } = await hashPassword("secret1");
		await execute(
			"INSERT INTO `pos_users` (`name`, `username`, `full_name`, `password_hash`, `password_salt`, `role`, `enabled`) VALUES (?, ?, ?, ?, ?, 'Manager', 1)",
			["admin", "admin", "Administrator", hash, salt],
		);
		await invoke("db:upsert-pos-users", [
			{
				name: "cashier@example.com",
				username: "cashier",
				full_name: "Test Cashier",
				password_hash: "",
				enabled: 1,
				pos_profile: "Shop 1",
			},
		]);

		// The next start of the app runs the migrations.
		await closeDatabase();
		await initDatabase(testDbConfig);

		const rows = await query<{ name: string }>("SELECT `name` FROM `pos_users` ORDER BY `name`");
		expect(rows.map((r) => r.name)).toEqual(["cashier@example.com"]);
	});
});
