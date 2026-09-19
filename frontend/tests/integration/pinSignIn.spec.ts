/**
 * Signing in on the till with a PIN, offline. The PIN hash comes from ERPNext
 * with the POS users (xpos.api.pin hashes it the same way); the till checks it
 * locally and locks a cashier out after too many wrong tries.
 */
import { createHash } from "crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "./support/electronShim";
import { closeTestDb, createTestDb } from "./support/localDb";
import { execute } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { hashPassword } from "../../electron/database/passwordHash";

type PinResult = { ok: boolean; attemptsLeft?: number; lockedUntil?: string; reason?: string };

const CASHIER = "cashier@example.com";

async function pullUser(pin: string | null, extra: Record<string, unknown> = {}) {
	const hashed = pin ? await hashPassword(pin) : null;
	await invoke("db:upsert-pos-users", [
		{
			name: CASHIER,
			username: "cashier",
			full_name: "Test Cashier",
			password_hash: "",
			enabled: 1,
			pin_hash: hashed?.hash ?? "",
			pin_salt: hashed?.salt ?? "",
			...extra,
		},
	]);
}

const verify = (pin: string) => invoke<PinResult>("db:verify-pin", CASHIER, pin);

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
});

afterAll(async () => {
	await closeTestDb();
});

beforeEach(async () => {
	await execute("DELETE FROM `pos_users`");
});

afterEach(() => {
	vi.useRealTimers();
});

describe("K6: a cashier signs in on the till with a PIN", () => {
	it("accepts the right PIN", async () => {
		await pullUser("4821");
		expect(await verify("4821")).toMatchObject({ ok: true });
	});

	it("refuses a wrong PIN and says how many tries are left", async () => {
		await pullUser("4821");
		expect(await verify("1111")).toEqual({ ok: false, attemptsLeft: 4, reason: "wrong_pin" });
	});

	it("says so when the cashier has no PIN yet", async () => {
		await pullUser(null);
		expect(await verify("4821")).toEqual({ ok: false, reason: "no_pin" });
	});

	it("locks the cashier out after 5 wrong PINs, even for the right one", async () => {
		await pullUser("4821");
		for (let i = 0; i < 5; i++) await verify("0000");

		const result = await verify("4821");

		expect(result.ok).toBe(false);
		expect(result.reason).toBe("locked");
		expect(result.lockedUntil).toBeTruthy();
	});

	it("lets the cashier in again once the lock has passed", async () => {
		await pullUser("4821");
		for (let i = 0; i < 5; i++) await verify("0000");
		await execute("UPDATE `pos_users` SET `pin_locked_until` = NOW() - INTERVAL 1 SECOND");

		expect(await verify("4821")).toMatchObject({ ok: true });
	});

	it("starts the count again after a right PIN", async () => {
		await pullUser("4821");
		for (let i = 0; i < 4; i++) await verify("0000");
		await verify("4821");

		expect(await verify("0000")).toMatchObject({ attemptsLeft: 4 });
	});

	it("takes a PIN changed in ERPNext on the next pull, and keeps the lockout count", async () => {
		await pullUser("4821");
		await verify("0000");
		await pullUser("7392");

		expect(await verify("4821")).toMatchObject({ ok: false, attemptsLeft: 3 });
		expect(await verify("7392")).toMatchObject({ ok: true });
	});

	it("never accepts a PIN for a disabled cashier", async () => {
		await pullUser("4821", { enabled: 0 });
		expect(await verify("4821")).toMatchObject({ ok: false, reason: "disabled" });
	});

	it("does not treat the legacy unsalted hash as a PIN", async () => {
		// A PIN with no salt would fall back to the old SHA-256 password check.
		await pullUser(null, { pin_hash: createHash("sha256").update("4821").digest("hex"), pin_salt: "" });
		expect(await verify("4821")).toMatchObject({ ok: false, reason: "no_pin" });
	});

	it("lists who can sign in with a PIN, without exposing any hash", async () => {
		await pullUser("4821");
		await invoke("db:upsert-pos-users", [
			{
				name: "nopin@example.com",
				username: "nopin",
				full_name: "No PIN",
				password_hash: "",
				enabled: 1,
				pin_hash: "",
				pin_salt: "",
			},
			{
				name: "off@example.com",
				username: "off",
				full_name: "Disabled",
				password_hash: "",
				enabled: 0,
				pin_hash: "x",
				pin_salt: "y",
			},
		]);

		const users = await invoke<Record<string, unknown>[]>("db:get-pin-users");

		expect(users).toEqual([{ name: CASHIER, username: "cashier", full_name: "Test Cashier" }]);
	});
});
