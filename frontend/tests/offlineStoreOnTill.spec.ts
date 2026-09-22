/**
 * @vitest-environment jsdom
 *
 * On the till the main process's sync engine sends sales and keeps each one's record for
 * Order History and the shift's close. The web POS's offline store sending them too raced
 * it: it re-sent sales already synced, then deleted the till's records of them (bug hunt:
 * a Requeue in the panel emptied the till's sales table). On the till it asks the engine.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { bridge, call } = vi.hoisted(() => ({
	bridge: {
		getAllPendingInvoices: vi.fn(),
		updatePendingInvoice: vi.fn(),
		deletePendingInvoice: vi.fn(),
		countPendingInvoices: vi.fn(async () => 1),
		countDeadLetters: vi.fn(async () => 0),
		retryDeadLetter: vi.fn(async () => true),
	},
	call: vi.fn(),
}));

vi.mock("@/services/dbBridge", () => bridge);
vi.mock("@/services/api", () => ({ call, showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));
vi.mock("@/utils", () => ({ isOnline: () => true, isNetworkError: () => false }));

import { useOfflineStore } from "@/stores/offlineStore";

const sales = [
	{ id: 1, local_id: "inv_a", status: "synced", data: { items: [] } },
	{ id: 2, local_id: "inv_b", status: "pending", data: { items: [] } },
	{ id: 3, local_id: "inv_c", status: "dead_letter", data: { items: [] } },
];
const triggerSync = vi.fn(async () => true);

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	bridge.getAllPendingInvoices.mockResolvedValue(sales.map((s) => ({ ...s })));
	window.electronAPI = { triggerSync } as never;
});

describe("the offline store on the desktop till", () => {
	it("syncing asks the sync engine, and never sends or deletes a sale itself", async () => {
		await useOfflineStore().syncPendingInvoices();
		expect(triggerSync).toHaveBeenCalled();
		expect(call).not.toHaveBeenCalled();
		expect(bridge.deletePendingInvoice).not.toHaveBeenCalled();
	});

	it("Requeue puts the sale back in the engine's queue and asks it to run", async () => {
		await useOfflineStore().retryDeadLetterInvoice(3);
		expect(bridge.retryDeadLetter).toHaveBeenCalledWith("pending_invoices", 3);
		expect(triggerSync).toHaveBeenCalled();
		expect(call).not.toHaveBeenCalled();
		expect(bridge.deletePendingInvoice).not.toHaveBeenCalled();
	});

	it("Retry on a failed sale does the same", async () => {
		await expect(useOfflineStore().retrySingle(2)).resolves.toBe(true);
		expect(bridge.updatePendingInvoice).toHaveBeenCalledWith(2, {
			status: "pending",
			retry_count: 0,
			error: null,
		});
		expect(triggerSync).toHaveBeenCalled();
		expect(call).not.toHaveBeenCalled();
		expect(bridge.deletePendingInvoice).not.toHaveBeenCalled();
	});
});
