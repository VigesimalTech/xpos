import { describe, expect, it } from "vitest";
import { onProfile, pinsOf, profileAccessOf } from "../electron/database/profileAccess";

// One user, a cashier on Shop A (the row, as ERPNext fills it from their first profile)
// and a supervisor on Shop B.
const row = {
	name: "u@x",
	role: "Cashier",
	pos_profile: "Shop A",
	discount_limit: 5,
	close_shift: 0,
	approve_exceptions: 0,
	pin_hash: "hashA",
	pin_salt: "saltA",
	profile_access: JSON.stringify({
		"Shop A": {
			role: "Cashier",
			discount_limit: 5,
			close_shift: 0,
			pin_hash: "hashA",
			pin_salt: "saltA",
		},
		"Shop B": {
			role: "Supervisor",
			discount_limit: 30,
			close_shift: 1,
			approve_exceptions: 1,
			pin_hash: "hashB",
			pin_salt: "saltB",
		},
	}),
};

describe("a user on two POS Profiles", () => {
	it("has the role, limit and rights of the profile of the shift", () => {
		const onB = onProfile(row, "Shop B");
		expect(onB.role).toBe("Supervisor");
		expect(onB.discount_limit).toBe(30);
		expect(onB.close_shift).toBe(1);
		expect(onB.approve_exceptions).toBe(1);
		expect(onB.pos_profile).toBe("Shop B");
		expect(onProfile(row, "Shop A").role).toBe("Cashier");
	});

	it("keeps the row as it is with no profile, or one it has no entry for", () => {
		expect(onProfile(row, undefined)).toBe(row);
		expect(onProfile(row, "Shop C")).toBe(row);
	});

	it("keeps the row of an older ERPNext that sends no profile access", () => {
		const old = { ...row, profile_access: null };
		expect(onProfile(old, "Shop B")).toBe(old);
		expect(profileAccessOf({ profile_access: "not json" })).toEqual({});
	});

	it("signs in with a PIN set on any of their profiles, each tried once", () => {
		expect(pinsOf(row)).toEqual([
			{ hash: "hashA", salt: "saltA" },
			{ hash: "hashB", salt: "saltB" },
		]);
		expect(pinsOf({ pin_hash: "", pin_salt: "", profile_access: null })).toEqual([]);
	});
});
