/**
 * K40: the till's Settings by role. Supervisors see the receipt printer; the system
 * settings are for administrators; clearing the till's data is refused while anything is
 * unsent; system changes go in the audit log.
 *
 * K41: a till newer than its server leaves out the fields the server does not know.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

import { countUnsent, describeUnsent } from "../electron/database/unsentRecords";
import { unpermittedField } from "../electron/sync/unpermittedField";

const level = vi.hoisted(() => ({ value: "supervisor" as "cashier" | "supervisor" | "administrator" }));
const recordAudit = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/services/roleLevel", () => ({
	roleLevel: () => level.value,
	reachesLevel: (l: string) =>
		({ cashier: 0, supervisor: 1, administrator: 2 })[level.value] >=
		({ cashier: 0, supervisor: 1, administrator: 2 } as Record<string, number>)[l],
}));
vi.mock("@/services/auditLog", () => ({ recordAudit }));
vi.mock("vue-sonner", () => ({ toast }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true, setServerUrl: vi.fn() }));
vi.mock("@/services/dbBridge", () => ({
	getSetting: vi.fn(async () => null),
	setSetting: vi.fn(async () => undefined),
	countItems: vi.fn(async () => 12),
	clearAllData: vi.fn(),
}));
vi.mock("@/stores/posStore", () => ({
	usePosStore: () => ({ posProfile: "Shop 1", companyName: "Test", warehouse: "Stores" }),
}));

import SettingsView from "@/views/SettingsView.vue";

const unsent = { value: { total: 0 } as Record<string, number> & { total: number } };
const db = {
	getConfig: vi.fn(async () => ({ host: "127.0.0.1", port: 3307, user: "xpos", database: "xpos_local" })),
	countUnsent: vi.fn(async () => unsent.value),
	clearPendingData: vi.fn(async () => ({
		cleared: unsent.value.total === 0,
		unsent: unsent.value,
		waiting: "2 sales",
	})),
	clearAllData: vi.fn(async () => true),
	testConnection: vi.fn(),
	reinit: vi.fn(),
};

beforeEach(() => {
	vi.clearAllMocks();
	unsent.value = { total: 0 };
	(window as unknown as { electronAPI: unknown }).electronAPI = {
		getServerUrl: vi.fn(async () => "https://erp.example.com"),
		getSyncState: vi.fn(async () => ({})),
		print: { listPrinters: vi.fn(async () => []), printReceipt: vi.fn() },
		startup: { getOpenAtLogin: vi.fn(async () => true), setOpenAtLogin: vi.fn(async (v: boolean) => v) },
		db,
	};
});

async function open() {
	const wrapper = mount(SettingsView);
	await flushPromises();
	return wrapper;
}

const headings = (wrapper: Awaited<ReturnType<typeof open>>) => wrapper.findAll("h2").map((h) => h.text());

describe("who sees what in Settings", () => {
	it("a supervisor sees the receipt printer, and none of the system settings", async () => {
		level.value = "supervisor";
		const wrapper = await open();
		expect(headings(wrapper)).toContain("Receipt Printer");
		for (const system of [
			"Server Connection",
			"Local Database",
			"Synchronization",
			"Data Management",
			"Startup",
		]) {
			expect(headings(wrapper)).not.toContain(system);
		}
	});

	it("an administrator sees everything", async () => {
		level.value = "administrator";
		const wrapper = await open();
		expect(headings(wrapper)).toEqual(
			expect.arrayContaining([
				"Server Connection",
				"Local Database",
				"Synchronization",
				"Receipt Printer",
				"Data Management",
				"Startup",
			]),
		);
	});
});

describe("clearing the till's data", () => {
	const clearAll = async () => {
		level.value = "administrator";
		const wrapper = await open();
		const button = wrapper.findAll("button").find((b) => b.text() === "Clear All Local Data")!;
		await button.trigger("click");
		await flushPromises();
	};

	it("is refused while anything is unsent, and says what is waiting", async () => {
		unsent.value = { total: 2, sales: 2 };
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
		await clearAll();
		expect(db.clearAllData).not.toHaveBeenCalled();
		expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("2 sales not yet in ERPNext"));
		expect(confirm).not.toHaveBeenCalled();
		expect(recordAudit).not.toHaveBeenCalled();
	});

	it("goes ahead when everything has reached ERPNext, and is recorded", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
		await clearAll();
		expect(db.clearAllData).toHaveBeenCalled();
		expect(recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({ event_type: "local_data_cleared" }),
		);
	});
});

describe("system changes go in the audit log", () => {
	it("a new ERPNext server is recorded as from and to", async () => {
		level.value = "administrator";
		const wrapper = await open();
		await wrapper
			.find('input[placeholder="https://erp.example.com"]')
			.setValue("https://other.example.com");
		const save = wrapper.findAll("button").find((b) => b.text() === "Save")!;
		await save.trigger("click");
		await flushPromises();
		expect(recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				event_type: "settings_changed",
				description: "ERPNext server changed",
				details: { from: "https://erp.example.com", to: "https://other.example.com" },
			}),
		);
	});
});

describe("what is unsent (the till's main process)", () => {
	const fakeQuery = (rows: Record<string, unknown>) =>
		(async (sql: string) => {
			if (sql.includes("pending_invoices")) return rows.invoices;
			const table = /FROM `(\w+)`/.exec(sql)![1];
			return [{ n: rows[table] ?? 0 }];
		}) as <T>(sql: string) => Promise<T[]>;

	it("counts sales apart from held orders, and every kind of record", async () => {
		const query = fakeQuery({
			invoices: [{ data: "sale" }, { data: "sale" }, { data: "held" }],
			pending_purchases: 1,
			pos_closing_entries: 1,
			expenses: 2,
			bank_drops: 1,
			audit_events: 4,
		});
		const counts = await countUnsent(query, (data) => data === "held");
		expect(counts).toMatchObject({
			sales: 2,
			held_orders: 1,
			purchases: 1,
			closes: 1,
			cash_movements: 3,
			audit_events: 4,
			total: 12,
		});
		expect(describeUnsent(counts)).toBe(
			"2 sales, 1 held order, 1 purchase, 1 shift close, 3 cash movements, 4 audit events",
		);
	});

	it("is nothing when everything has reached ERPNext", async () => {
		const counts = await countUnsent(fakeQuery({ invoices: [] }), () => false);
		expect(counts.total).toBe(0);
		expect(describeUnsent(counts)).toBe("");
	});
});

describe("a till newer than its server (K41)", () => {
	const fields = ["name", "xpos_screen_access", "xpos_sync_status_detail"];

	it("finds the field the server does not know", () => {
		expect(
			unpermittedField(
				"Pull failed for POS Profiles: HTTP 417: Field not permitted in query: xpos_sync_status_detail",
				fields,
			),
		).toBe("xpos_sync_status_detail");
		expect(
			unpermittedField("Field not permitted in query: `tabPOS Profile`.`xpos_screen_access`", fields),
		).toBe("xpos_screen_access");
	});

	it("leaves any other error, and a field it did not ask for, alone", () => {
		expect(unpermittedField("HTTP 403: Not permitted", fields)).toBeNull();
		expect(unpermittedField("Field not permitted in query: something_else", fields)).toBeNull();
	});
});
