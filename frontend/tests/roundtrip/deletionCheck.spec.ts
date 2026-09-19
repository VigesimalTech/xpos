/**
 * The deletion check runs as the till's own API user, not an admin. Each table's
 * list request must answer for it: Frappe refuses frappe.client.get_list on a
 * child table to anyone but a System Manager, so child tables go through the
 * endpoint the table is pulled with.
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { SYNC_TABLES, deletionListRequest } from "../../electron/sync/syncConfig";

interface Keys {
	api_key: string;
	api_secret: string;
}
interface Site {
	url: string;
	pos_profile: string;
	tills: Record<string, Keys>;
}

const configPath = process.env.XPOS_RT_CONFIG;
const site: Site = configPath
	? {
			url: process.env.XPOS_RT_URL || "http://test_site:8000",
			...JSON.parse(readFileSync(configPath, "utf8")),
		}
	: (null as never);

const checked = SYNC_TABLES.filter((t) => t.direction !== "push" && t.deletionCheck !== false);

describe.skipIf(!configPath)("the deletion check, as a till's API user", () => {
	it.each(checked.map((t) => [t.label, t] as const))("lists %s", async (_label, table) => {
		const keys = site.tills[site.pos_profile];
		const { method, args } = deletionListRequest(table);
		// A GET with JSON-encoded arguments, as the sync engine's apiCall sends it.
		const query = new URLSearchParams(
			Object.entries(args).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]),
		);
		const res = await fetch(`${site.url}/api/method/${method}?${query}`, {
			headers: {
				Authorization: `token ${keys.api_key}:${keys.api_secret}`,
				Accept: "application/json",
			},
		});
		const body = (await res.json()) as { message?: unknown };

		expect(res.status, JSON.stringify(body).slice(0, 300)).toBe(200);
		expect(Array.isArray(body.message)).toBe(true);
	});
});
