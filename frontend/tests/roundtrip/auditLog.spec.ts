/**
 * K20: the till's audit log reaches ERPNext as POS Audit Events, synced by a shop's
 * till with its own (non-admin) API key. What does not check out against ERPNext is
 * kept and noted, never refused.
 */
import { readFileSync } from "fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoke, setOnline } from "../integration/support/electronShim";
import { closeTestDb, createTestDb } from "../integration/support/localDb";
import { execute, query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { registerAuditHandlers } from "../../electron/audit/auditLog";
import { initSyncEngine, runSyncCyclePublic, stopSyncEngine } from "../../electron/sync/syncEngine";

interface Keys {
	api_key: string;
	api_secret: string;
}
interface Site extends Keys {
	url: string;
	company: string;
	item: string;
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

const CASHIER = "rt-cashier@example.com"; // on the first shop
const OTHER_SHOP_CASHIER = "rt-other@example.com"; // on the second shop only
const SUPERVISOR = "rt-supervisor@example.com"; // Manager on the first shop: may approve
const BOTH_SHOPS_CASHIER = "rt-both@example.com"; // Cashier in the first shop (a Manager in the second): may not approve here

type AuditEvent = {
	name: string;
	event_type: string;
	cashier: string | null;
	approved_by: string | null;
	pos_profile: string | null;
	pos_opening_shift: string | null;
	item_code: string | null;
	qty: number;
	amount: number;
	checks: string | null;
	till_user: string | null;
};

async function eventsFor(reference: string): Promise<AuditEvent[]> {
	const filters = encodeURIComponent(JSON.stringify([["reference", "=", reference]]));
	const fields = encodeURIComponent(JSON.stringify(["*"]));
	const res = await fetch(
		`${site.url}/api/resource/POS Audit Event?filters=${filters}&fields=${fields}&limit_page_length=0`,
		{
			headers: {
				Authorization: `token ${site.api_key}:${site.api_secret}`,
				Accept: "application/json",
			},
		},
	);
	const body = (await res.json()) as { data: AuditEvent[] };
	if (!res.ok) throw new Error(`POS Audit Event: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
	return body.data;
}

function syncAsTill(profile: string): Promise<void> {
	stopSyncEngine();
	const keys = site.tills[profile];
	initSyncEngine({
		serverUrl: site.url,
		csrfToken: "",
		sessionCookies: "",
		apiKey: keys.api_key,
		apiSecret: keys.api_secret,
	});
	return runSyncCyclePublic();
}

async function unsent(): Promise<{ n: number; error: string | null }> {
	const [row] = await query<{ n: number; error: string | null }>(
		"SELECT COUNT(*) AS n, MAX(`error`) AS error FROM `audit_events` WHERE `sync_status` <> 'synced'",
	);
	return { n: Number(row.n), error: row.error };
}

describe.skipIf(!configPath)("K20: the till's audit log in ERPNext", () => {
	const run = Date.now();
	let shift = 0;

	beforeAll(async () => {
		await createTestDb();
		registerDbHandlers();
		registerAuditHandlers();
		setOnline(true);
		const opened = await invoke<{ id: number }>("db:create-pos-opening-shift", {
			pos_profile: site.pos_profile,
			user: CASHIER,
			company: site.company,
			opening_amounts: [{ mode_of_payment: "Cash", opening_amount: 0 }],
		});
		shift = opened.id;
	});

	afterAll(async () => {
		stopSyncEngine();
		await closeTestDb();
	});

	it("a deleted line approved by a manager is stored as the till logged it, in its shift", async () => {
		const reference = `rt-line-${run}`;
		await invoke("audit:record", {
			event_type: "line_removed",
			cashier: CASHIER,
			pos_profile: site.pos_profile,
			shift,
			item_code: site.item,
			item_name: site.item,
			qty: 2,
			amount: 20,
			approved_by: SUPERVISOR,
			reference,
		});

		await syncAsTill(site.pos_profile);

		const left = await unsent();
		expect(left.n, `sync error: ${left.error}`).toBe(0);
		const [event] = await eventsFor(reference);
		expect(event).toMatchObject({
			event_type: "Line Removed",
			cashier: CASHIER,
			approved_by: SUPERVISOR,
			pos_profile: site.pos_profile,
			item_code: site.item,
			qty: 2,
			amount: 20,
			till_user: "rt-till@example.com",
		});
		expect(event.pos_opening_shift).toBeTruthy();
		expect(event.checks || "").toBe("");
	});

	it("an event that does not check out is kept, with why", async () => {
		const reference = `rt-odd-${run}`;
		await invoke("audit:record", {
			event_type: "reprint",
			cashier: OTHER_SHOP_CASHIER,
			pos_profile: site.pos_profile,
			approved_by: BOTH_SHOPS_CASHIER,
			reference,
		});

		await syncAsTill(site.pos_profile);

		const [event] = await eventsFor(reference);
		expect(event.event_type).toBe("Reprint");
		expect(event.checks).toContain(OTHER_SHOP_CASHIER);
		expect(event.checks).toContain("Approve Exceptions");
	});

	it("each event is stored once, however often it is sent", async () => {
		const reference = `rt-once-${run}`;
		await invoke("audit:record", {
			event_type: "sale_cleared",
			cashier: CASHIER,
			pos_profile: site.pos_profile,
			reference,
		});
		await syncAsTill(site.pos_profile);
		// As if the reply had been lost: the till sends it again.
		await execute("UPDATE `audit_events` SET `sync_status` = 'pending'");
		await syncAsTill(site.pos_profile);

		expect(await eventsFor(reference)).toHaveLength(1);
		expect((await unsent()).n).toBe(0);
	});
});
