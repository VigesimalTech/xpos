/**
 * K19: a manager approves, with their PIN on the same till and offline, what the
 * cashier may not do alone. The PIN is checked as at sign-in (K6), with the same
 * lockout; who may approve comes from the pulled POS users and POS Profile.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "./support/electronShim";
import { closeTestDb, createTestDb } from "./support/localDb";
import { execute } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { hashPassword } from "../../electron/database/passwordHash";
import { registerApprovalHandlers } from "../../electron/approval/approvalHandlers";

type Verdict = {
	ok: boolean;
	approver?: string;
	reason?: string;
	attemptsLeft?: number;
	lockedUntil?: string;
};

const PROFILE = "Shop POS";
const CASHIER = "cashier@example.com";
const MANAGER = "manager@example.com";
const SUPERVISOR = "supervisor@example.com";

async function pullUser(name: string, pin: string, extra: Record<string, unknown> = {}) {
	const { hash, salt } = await hashPassword(pin);
	await invoke("db:upsert-pos-users", [
		{
			name,
			username: name.split("@")[0],
			full_name: name.split("@")[0],
			password_hash: "",
			enabled: 1,
			pos_profile: PROFILE,
			company: "Co",
			pin_hash: hash,
			pin_salt: salt,
			discount_limit: 0,
			approve_exceptions: 0,
			expense: 0,
			...extra,
		},
	]);
}

async function profile(extra: Record<string, unknown> = {}) {
	await execute("DELETE FROM `pos_profiles`");
	await invoke("db:upsert-pos-profiles", [
		{
			name: PROFILE,
			company: "Co",
			max_discount_percentage_allowed: 100,
			xpos_allow_self_approval: 0,
			...extra,
		},
	]);
}

const request = (extra: Record<string, unknown> = {}) => ({
	cashier: CASHIER,
	posProfile: PROFILE,
	...extra,
});
const verify = (approver: string, pin: string, extra: Record<string, unknown> = {}) =>
	invoke<Verdict>("approval:verify", approver, pin, request(extra));

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
	registerApprovalHandlers();
});

afterAll(async () => {
	await closeTestDb();
});

beforeEach(async () => {
	await execute("DELETE FROM `pos_users`");
	await profile();
	await pullUser(CASHIER, "1111", { discount_limit: 10 });
	await pullUser(MANAGER, "2222", { approve_exceptions: 1, discount_limit: 30, expense: 1 });
	await pullUser(SUPERVISOR, "3333", { approve_exceptions: 1, discount_limit: 10 });
});

describe("K19: a manager's PIN approves on the till", () => {
	it("offers only those who may approve this", async () => {
		const names = (r: { name: string }[]) => r.map((a) => a.name);

		expect(names(await invoke("approval:approvers", request({ discountPct: 25 })))).toEqual([MANAGER]);
		expect(names(await invoke("approval:approvers", request({ discountPct: 5 })))).toEqual([
			MANAGER,
			SUPERVISOR,
		]);
		expect(names(await invoke("approval:approvers", request({ permission: "expense" })))).toEqual([
			MANAGER,
		]);
	});

	it("approves with the right PIN and names the approver", async () => {
		expect(await verify(MANAGER, "2222", { discountPct: 25 })).toEqual({ ok: true, approver: MANAGER });
	});

	it("refuses a wrong PIN and says how many tries are left", async () => {
		expect(await verify(MANAGER, "9999", { discountPct: 25 })).toMatchObject({
			ok: false,
			reason: "wrong_pin",
			attemptsLeft: 4,
		});
	});

	it("locks the approver out after five wrong PINs, as at sign-in", async () => {
		for (let i = 0; i < 4; i++) await verify(MANAGER, "9999");
		expect(await verify(MANAGER, "9999")).toMatchObject({ ok: false, reason: "locked" });
		expect(await verify(MANAGER, "2222")).toMatchObject({ ok: false, reason: "locked" });
	});

	it("refuses someone who may not approve this before asking for a PIN", async () => {
		expect(await verify(SUPERVISOR, "3333", { discountPct: 25 })).toMatchObject({
			ok: false,
			reason: "over_limit",
		});
		// A refusal is not a wrong PIN: it does not count towards the lockout.
		for (let i = 0; i < 6; i++) await verify(SUPERVISOR, "3333", { discountPct: 25 });
		expect(await verify(SUPERVISOR, "3333", { discountPct: 5 })).toEqual({
			ok: true,
			approver: SUPERVISOR,
		});
	});

	it("refuses the cashier approving their own exception unless the POS Profile allows it", async () => {
		await pullUser(CASHIER, "1111", { approve_exceptions: 1, discount_limit: 50 });

		expect(await verify(CASHIER, "1111", { discountPct: 25 })).toMatchObject({
			ok: false,
			reason: "self_approval",
		});

		await profile({ xpos_allow_self_approval: 1 });
		expect(await verify(CASHIER, "1111", { discountPct: 25 })).toEqual({ ok: true, approver: CASHIER });
	});

	it("holds the approver to the POS Profile's maximum discount", async () => {
		await profile({ max_discount_percentage_allowed: 20 });

		expect(await verify(MANAGER, "2222", { discountPct: 25 })).toMatchObject({
			ok: false,
			reason: "over_limit",
		});
	});

	it("refuses someone who is not a user of this till", async () => {
		expect(await verify("stranger@example.com", "0000")).toMatchObject({
			ok: false,
			reason: "unknown_user",
		});
	});
});
