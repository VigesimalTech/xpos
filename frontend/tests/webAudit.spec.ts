/**
 * K38: on the web POS the page sends what the cashier took out of a sale to ERPNext
 * itself. While ERPNext cannot be reached the events wait in the browser; none is lost and
 * none is sent twice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ call }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => false }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ userName: "cashier@x" }) }));
vi.mock("@/stores/posStore", () => ({
	usePosStore: () => ({ posProfile: { name: "Shop 1" }, posOpeningShift: { name: "POS-OS-1" } }),
}));

import { flushWebAudit, recordAudit } from "@/services/auditLog";

const METHOD = "xpos.api.audit.record_web_audit_events";
const queued = () => JSON.parse(localStorage.getItem("xpos_web_audit_queue") || "[]");

beforeEach(() => {
	localStorage.clear();
	call.mockReset();
});

describe("the web POS's audit log", () => {
	it("sends an event with the shop and shift, and no cashier or approver of its own", async () => {
		call.mockImplementation(async (_m: string, { events }: { events: { local_id: string }[] }) => ({
			accepted: events.map((e) => e.local_id),
		}));

		recordAudit({
			event_type: "line_removed",
			item_code: "A",
			qty: 2,
			amount: 10,
			approved_by: "boss@x",
		});
		await flushWebAudit();

		const [method, { events }] = call.mock.calls[0];
		expect(method).toBe(METHOD);
		expect(events[0]).toMatchObject({
			event_type: "line_removed",
			pos_profile: "Shop 1",
			pos_opening_shift: "POS-OS-1",
			item_code: "A",
		});
		expect(events[0]).not.toHaveProperty("cashier");
		expect(events[0]).not.toHaveProperty("approved_by");
		expect(queued()).toEqual([]);
	});

	it("keeps an event while ERPNext is out of reach and sends it once it answers", async () => {
		call.mockRejectedValueOnce(new Error("__offline__"));
		recordAudit({ event_type: "sale_cleared", qty: 3, amount: 30, approved_by: null });
		await flushWebAudit();
		expect(queued()).toHaveLength(1);

		call.mockImplementation(async (_m: string, { events }: { events: { local_id: string }[] }) => ({
			accepted: events.map((e) => e.local_id),
		}));
		await flushWebAudit();

		expect(call).toHaveBeenCalledTimes(2);
		expect(queued()).toEqual([]);
	});

	it("leaves an event ERPNext did not accept for the next try", async () => {
		call.mockResolvedValue({ accepted: [] });
		recordAudit({ event_type: "qty_lowered", item_code: "B", qty: 1, amount: 5, approved_by: null });
		await flushWebAudit();

		expect(queued()).toHaveLength(1);
	});
});
