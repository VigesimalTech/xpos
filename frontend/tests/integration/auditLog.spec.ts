/**
 * K20: the till's audit log. What happens at the till that leaves no sale behind is
 * written to the local database, online or not, and reaches ERPNext when the till
 * syncs: each event once, none given up on.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invoke, setOnline } from "./support/electronShim";
import { FakeFrappe, FrappeError } from "./support/fakeFrappe";
import { clearSyncTables, closeTestDb, createTestDb } from "./support/localDb";
import { execute, query } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { hashPassword } from "../../electron/database/passwordHash";
import { registerApprovalHandlers } from "../../electron/approval/approvalHandlers";
import { registerAuditHandlers } from "../../electron/audit/auditLog";
import {
	initSyncEngine,
	pushAuditEvents,
	runSyncCyclePublic,
	stopSyncEngine,
} from "../../electron/sync/syncEngine";

const SYNC_AUDIT_EVENTS = "xpos.api.audit.sync_audit_events";
const PROFILE = "Shop POS";
const CASHIER = "cashier@example.com";
const MANAGER = "manager@example.com";

type Row = Record<string, unknown>;
const frappe = new FakeFrappe();
let serverUrl = "";

async function pullUser(name: string, pin: string, extra: Row = {}) {
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
			...extra,
		},
	]);
}

const events = () => query<Row>("SELECT * FROM `audit_events` ORDER BY `id`");

function sentEvents(): Row[] {
	return frappe.callsTo(SYNC_AUDIT_EVENTS).flatMap((c) => {
		const e = c.args.events;
		return (typeof e === "string" ? JSON.parse(e) : e) as Row[];
	});
}

/** The server as it answers: every event with an id is accepted. */
function acceptAll() {
	frappe.on(SYNC_AUDIT_EVENTS, (args) => ({
		accepted: (args.events as Row[]).map((e) => e.local_id),
	}));
}

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
	registerApprovalHandlers();
	registerAuditHandlers();
	serverUrl = await frappe.start();
});

afterAll(async () => {
	stopSyncEngine();
	await frappe.stop();
	await closeTestDb();
});

beforeEach(async () => {
	stopSyncEngine();
	await clearSyncTables();
	await execute("DELETE FROM `pos_users`");
	await execute("DELETE FROM `pos_profiles`");
	await invoke("db:upsert-pos-profiles", [
		{ name: PROFILE, company: "Co", max_discount_percentage_allowed: 100, xpos_allow_self_approval: 0 },
	]);
	await pullUser(CASHIER, "1111");
	await pullUser(MANAGER, "2222", { approve_exceptions: 1, remove_cart_items: 1 });
	frappe.reset();
	setOnline(true);
	initSyncEngine({ serverUrl, csrfToken: "", sessionCookies: "", apiKey: "k", apiSecret: "s" });
});

describe("K20: the till logs what leaves no sale", () => {
	it("a wrong PIN at sign-in, with whose PIN it was", async () => {
		await invoke("db:verify-pin", "cashier", "9999");

		const [event] = await events();
		expect(event).toMatchObject({
			event_type: "pin_failed",
			pin_user: CASHIER,
			pos_profile: PROFILE,
			sync_status: "pending",
		});
		expect(JSON.parse(String(event.details))).toMatchObject({ for: "sign_in", reason: "wrong_pin" });
	});

	it("a right PIN at sign-in is not logged", async () => {
		await invoke("db:verify-pin", "cashier", "1111");
		expect(await events()).toEqual([]);
	});

	it("a PIN for someone the till does not know is not logged", async () => {
		await invoke("db:verify-pin", "nobody", "9999");
		expect(await events()).toEqual([]);
	});

	it("the lockout, and every try while locked", async () => {
		for (let i = 0; i < 6; i++) await invoke("db:verify-pin", "cashier", "9999");

		const reasons = (await events()).map((e) => JSON.parse(String(e.details)).reason);
		expect(reasons).toEqual(["wrong_pin", "wrong_pin", "wrong_pin", "wrong_pin", "locked", "locked"]);
	});

	it("an approval: who approved what, for whom, in which shift", async () => {
		await invoke("approval:verify", MANAGER, "2222", {
			cashier: CASHIER,
			posProfile: PROFILE,
			permission: "remove_cart_items",
			reason: "Remove Item A from the sale",
			shift: 7,
		});

		const [event] = await events();
		expect(event).toMatchObject({
			event_type: "approval",
			cashier: CASHIER,
			approved_by: MANAGER,
			pos_profile: PROFILE,
			pos_opening_entry_id: 7,
			description: "Remove Item A from the sale",
		});
		expect(JSON.parse(String(event.details))).toEqual({ permissions: ["remove_cart_items"] });
	});

	it("a manager's wrong PIN for an approval, and the cashier who asked", async () => {
		await invoke("approval:verify", MANAGER, "9999", {
			cashier: CASHIER,
			posProfile: PROFILE,
			permission: "remove_cart_items",
		});

		const [event] = await events();
		expect(event).toMatchObject({ event_type: "pin_failed", pin_user: MANAGER, cashier: CASHIER });
		expect(JSON.parse(String(event.details))).toMatchObject({ for: "approval" });
	});

	it("what a screen records", async () => {
		const id = await invoke<string>("audit:record", {
			event_type: "line_removed",
			cashier: CASHIER,
			pos_profile: PROFILE,
			shift: 3,
			item_code: "ITEM-A",
			item_name: "Item A",
			qty: 2,
			amount: 19.5,
			approved_by: MANAGER,
		});

		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect((await events())[0]).toMatchObject({
			local_id: id,
			event_type: "line_removed",
			item_code: "ITEM-A",
			approved_by: MANAGER,
		});
	});

	it("a screen may not record an approval or a wrong PIN: only the PIN check does", async () => {
		for (const event_type of ["approval", "pin_failed", "anything"]) {
			expect(await invoke("audit:record", { event_type, approved_by: MANAGER })).toBeNull();
		}
		expect(await events()).toEqual([]);
	});
});

describe("K20: the audit log reaches ERPNext", () => {
	async function record(n: number) {
		for (let i = 0; i < n; i++) {
			await invoke("audit:record", {
				event_type: "reprint",
				cashier: CASHIER,
				pos_profile: PROFILE,
				reference: `LOCAL-${i + 1}`,
			});
		}
	}

	it("sends the events, oldest first, and marks them synced", async () => {
		acceptAll();
		await record(2);

		expect(await pushAuditEvents()).toBe(2);

		const sent = sentEvents();
		expect(sent.map((e) => e.reference)).toEqual(["LOCAL-1", "LOCAL-2"]);
		expect(sent[0]).toMatchObject({ event_type: "reprint", cashier: CASHIER, pos_profile: PROFILE });
		expect(String(sent[0].event_time)).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
		expect((await events()).map((e) => e.sync_status)).toEqual(["synced", "synced"]);
		expect(await pushAuditEvents()).toBe(0);
	});

	it("the shift goes by its name on the server", async () => {
		acceptAll();
		await execute(
			"INSERT INTO `sync_id_map` (`local_id`, `server_name`, `doctype`) VALUES ('3', 'POS-OPEN-0003', 'POS Opening Shift')",
		);
		await invoke("audit:record", { event_type: "sale_cleared", shift: 3, details: { lines: [] } });

		await pushAuditEvents();

		expect(sentEvents()[0]).toMatchObject({
			pos_opening_shift: "POS-OPEN-0003",
			details: { lines: [] },
		});
	});

	it("keeps what the server did not accept and sends it again", async () => {
		await record(2);
		const [first] = await events();
		frappe.on(SYNC_AUDIT_EVENTS, () => ({ accepted: [first.local_id] }));

		expect(await pushAuditEvents()).toBe(1);
		expect((await events()).map((e) => e.sync_status)).toEqual(["synced", "failed"]);

		acceptAll();
		expect(await pushAuditEvents()).toBe(1);
		expect(sentEvents().map((e) => e.reference)).toEqual(["LOCAL-1", "LOCAL-2", "LOCAL-2"]);
	});

	it("an error from the server leaves every event for next time, however many times", async () => {
		await record(1);
		frappe.on(SYNC_AUDIT_EVENTS, () => {
			throw new FrappeError(500, "Server down");
		});

		for (let i = 0; i < 12; i++) expect(await pushAuditEvents()).toBe(0);
		expect((await events())[0]).toMatchObject({ sync_status: "failed", retry_count: 12 });

		acceptAll();
		expect(await pushAuditEvents()).toBe(1);
	});

	it("a resend after a lost reply sends the same id, so the server keeps it once", async () => {
		await record(1);
		frappe.on(SYNC_AUDIT_EVENTS, () => {
			throw new FrappeError(504, "Gateway timeout");
		});
		await pushAuditEvents();
		acceptAll();
		await pushAuditEvents();

		const ids = sentEvents().map((e) => e.local_id);
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(ids[1]);
	});

	it("a long offline spell goes in batches", async () => {
		acceptAll();
		const values = Array.from({ length: 205 }, (_, i) => `(UUID(), 'reprint', NOW(), 'LOCAL-${i}')`);
		await execute(
			`INSERT INTO \`audit_events\` (\`local_id\`, \`event_type\`, \`event_time\`, \`reference\`) VALUES ${values.join(",")}`,
		);

		expect(await pushAuditEvents()).toBe(200);
		expect(await pushAuditEvents()).toBe(5);
	});

	it("goes with the sync cycle", async () => {
		acceptAll();
		await record(1);

		await runSyncCyclePublic();

		expect(frappe.callsTo(SYNC_AUDIT_EVENTS)).toHaveLength(1);
		expect((await events())[0].sync_status).toBe("synced");
	});
});
