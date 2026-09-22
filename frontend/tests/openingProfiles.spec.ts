/**
 * A shift opens only on a POS Profile the signed-in user is on in ERPNext. ERPNext refuses
 * a shift on any other, and every sale made in it would never sync (bug hunt: a manager on
 * one profile could open a shift on another, and the sale sat pending with no warning).
 */
import { describe, expect, it } from "vitest";
import { allowedProfiles, profilesForUser } from "../electron/database/openingProfiles";

const profiles = [{ name: "Shop A" }, { name: "Shop B" }, { name: "Shop C" }];

describe("the profiles a user may open a shift on", () => {
	it("offers only the profiles the user is on", () => {
		const user = { pos_profile: "Shop A", pos_profiles: JSON.stringify(["Shop A", "Shop C"]) };
		expect(profilesForUser(profiles, user).map((p) => p.name)).toEqual(["Shop A", "Shop C"]);
	});

	it("before the till has pulled the full list, falls back to the user's first profile", () => {
		expect(
			profilesForUser(profiles, { pos_profile: "Shop B", pos_profiles: null }).map((p) => p.name),
		).toEqual(["Shop B"]);
		expect([...allowedProfiles({ pos_profile: "Shop B", pos_profiles: "not json" })]).toEqual(["Shop B"]);
	});

	it("offers nothing to someone the till does not know", () => {
		expect(profilesForUser(profiles, null)).toEqual([]);
	});
});
