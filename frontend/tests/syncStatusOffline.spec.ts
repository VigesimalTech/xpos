/**
 * @vitest-environment jsdom
 *
 * ERPNext not answering is the till being offline: the pill says "Offline – N sales
 * waiting", not "Sync error", and the error log is not filled with one entry per failed
 * push (the user's wording, 21 Sep 2026; bug hunt).
 */
import { describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";

const captureError = vi.hoisted(() => vi.fn());
vi.mock("@/services/errorLog", () => ({ captureError }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));

import { useSyncStatus } from "@/composables/useSyncStatus";

function tillWithSync() {
	const handlers: Record<string, (x: never) => void> = {};
	const on = (name: string) => (cb: (x: never) => void) => ((handlers[name] = cb), () => undefined);
	window.electronAPI = {
		getSyncState: async () => ({ lastSyncTime: null }),
		onSyncStatus: on("status"),
		onSyncError: on("error"),
		onSyncComplete: on("complete"),
		onSyncDeadLetter: on("dead"),
		onSyncReachability: on("reach"),
	} as never;
	let status!: ReturnType<typeof useSyncStatus>;
	mount(defineComponent({ setup: () => ((status = useSyncStatus()), () => null) }));
	return { handlers, status: () => status };
}

describe("the till offline", () => {
	it("a push ERPNext did not answer marks the till offline, not a sync error", async () => {
		const { handlers, status } = tillWithSync();
		await new Promise((r) => setTimeout(r));
		handlers.error({
			message: "net::ERR_CONNECTION_REFUSED",
			table: "Sales Invoices",
			unreachable: true,
		} as never);
		await nextTick();
		expect(status().unreachable.value).toBe(true);
		expect(status().lastError.value).toBeNull();
		expect(captureError).not.toHaveBeenCalled();
	});

	it("back in touch clears it", async () => {
		const { handlers, status } = tillWithSync();
		await new Promise((r) => setTimeout(r));
		handlers.reach({ reachable: false } as never);
		expect(status().unreachable.value).toBe(true);
		handlers.reach({ reachable: true } as never);
		expect(status().unreachable.value).toBe(false);
	});

	it("an error ERPNext answered with is still a sync error", async () => {
		const { handlers, status } = tillWithSync();
		await new Promise((r) => setTimeout(r));
		handlers.error({ message: "HTTP 417: Item is disabled", table: "Sales Invoices" } as never);
		expect(status().lastError.value).toContain("417");
		expect(captureError).toHaveBeenCalled();
	});
});
