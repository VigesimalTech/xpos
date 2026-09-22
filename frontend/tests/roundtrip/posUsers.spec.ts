/**
 * Which cashiers a till gets. A till's API user is assigned to its shop's POS
 * Profile; the till should list that shop's cashiers only, each with that
 * shop's profile. An API user on no profile (an admin key) gets everyone.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

interface Keys {
	api_key: string;
	api_secret: string;
}
interface Site {
	url: string;
	pos_profile: string;
	pos_profile_2: string;
	tills: Record<string, Keys>;
	unassigned: Keys;
}

const configPath = process.env.XPOS_RT_CONFIG;
const site: Site = configPath
	? {
			url: process.env.XPOS_RT_URL || "http://test_site:8000",
			...JSON.parse(readFileSync(configPath, "utf8")),
		}
	: (null as never);

type PosUser = { name: string; pos_profile: string; role: string; profile_access?: string };

async function pull(keys: Keys, fields?: string[]): Promise<PosUser[]> {
	const params = new URLSearchParams({ limit_page_length: "500" });
	if (fields) params.set("fields", JSON.stringify(fields));
	const res = await fetch(`${site.url}/api/method/xpos.api.auth.get_pos_users?${params}`, {
		headers: { Authorization: `token ${keys.api_key}:${keys.api_secret}`, Accept: "application/json" },
	});
	const body = (await res.json()) as { message: PosUser[] };
	if (!res.ok) throw new Error(`get_pos_users: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
	return body.message;
}

async function posUsersFor(keys: Keys): Promise<Map<string, string>> {
	return new Map((await pull(keys)).map((u) => [u.name, u.pos_profile]));
}

describe.skipIf(!configPath)("K17: a till gets its own shop's cashiers", () => {
	it("gives a shop's till that shop's cashiers, and not the other shop's", async () => {
		const users = await posUsersFor(site.tills[site.pos_profile]);

		expect(users.get("rt-cashier@example.com")).toBe(site.pos_profile);
		expect(users.get("rt-both@example.com")).toBe(site.pos_profile);
		expect(users.has("rt-other@example.com")).toBe(false);
	});

	it("gives a cashier who works in both shops the profile of the till's shop", async () => {
		const users = await posUsersFor(site.tills[site.pos_profile_2]);

		expect(users.get("rt-other@example.com")).toBe(site.pos_profile_2);
		expect(users.get("rt-both@example.com")).toBe(site.pos_profile_2);
		expect(users.has("rt-cashier@example.com")).toBe(false);
	});

	it("still gives an API user on no profile every cashier", async () => {
		const users = await posUsersFor(site.unassigned);

		for (const cashier of ["rt-cashier@example.com", "rt-other@example.com", "rt-both@example.com"]) {
			expect(users.has(cashier), cashier).toBe(true);
		}
	});
});

describe.skipIf(!configPath)("a user on two POS Profiles", () => {
	const BOTH = "rt-both@example.com"; // Cashier in the first shop, Manager with 25% in the second

	it("comes with their role, limit and rights on each profile, for a till that asks", async () => {
		const both = (await pull(site.unassigned, ["*", "approve_exceptions", "profile_access"])).find(
			(u) => u.name === BOTH,
		)!;
		const access = JSON.parse(both.profile_access!) as Record<string, Record<string, unknown>>;

		expect(access[site.pos_profile]).toMatchObject({ role: "Cashier", approve_exceptions: 0 });
		expect(access[site.pos_profile_2]).toMatchObject({
			role: "Manager",
			discount_limit: 25,
			approve_exceptions: 1,
		});
	});

	it("comes with only the till's own profiles", async () => {
		const both = (await pull(site.tills[site.pos_profile], ["*", "profile_access"])).find(
			(u) => u.name === BOTH,
		)!;
		expect(Object.keys(JSON.parse(both.profile_access!))).toEqual([site.pos_profile]);
	});

	it("comes without it to a till that does not ask", async () => {
		const both = (await pull(site.unassigned)).find((u) => u.name === BOTH)!;
		expect(both.profile_access).toBeUndefined();
	});
});
