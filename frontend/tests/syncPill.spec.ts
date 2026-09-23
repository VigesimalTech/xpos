/**
 * K37: what the sync status says at each level of the POS Profile's Sync Status Detail.
 * One rule for the till's pill and the web POS's indicator.
 */
import { describe, expect, it } from "vitest";
import { REPEATED_ERROR_CYCLES, syncPillView, type SyncPillState } from "@/services/syncPill";

const calm: SyncPillState = {
	needAttention: 0,
	offline: false,
	waiting: 0,
	syncing: false,
	syncTable: null,
	lastError: null,
	errorCycles: 0,
	lastSyncTime: "10:32:05",
};
const at = (patch: Partial<SyncPillState>) => ({ ...calm, ...patch });

describe("Minimal, the default", () => {
	it("says Online, and nothing while a sync runs", () => {
		expect(syncPillView(calm).label).toBe("Online");
		const syncing = syncPillView(at({ syncing: true, syncTable: "Item Price" }));
		expect(syncing).toMatchObject({ label: "Online", busy: false });
	});

	it("says Offline without counting, when ERPNext does not answer", () => {
		expect(syncPillView(at({ offline: true, waiting: 4 }))).toMatchObject({
			label: "Offline",
			tone: "offline",
		});
	});

	it("leaves a one-off sync error quiet", () => {
		expect(
			syncPillView(at({ lastError: "HTTP 417", errorCycles: REPEATED_ERROR_CYCLES - 1 })).label,
		).toBe("Online");
	});

	it("shows a sync problem that keeps coming back, with its reason", () => {
		const view = syncPillView(
			at({ lastError: "Item Price: HTTP 417", errorCycles: REPEATED_ERROR_CYCLES }),
		);
		expect(view).toMatchObject({ label: "Sync problem", tone: "attention" });
		expect(view.tooltip).toContain("Item Price: HTTP 417");
	});

	it("treats a profile that has not chosen as Minimal", () => {
		expect(syncPillView(at({ syncing: true }))).toEqual(syncPillView(at({ syncing: true }), "Minimal"));
	});
});

describe("Standard", () => {
	it("shows syncing, but not what", () => {
		expect(syncPillView(at({ syncing: true, syncTable: "Item Price" }), "Standard")).toMatchObject({
			label: "Syncing...",
			busy: true,
		});
	});

	it("counts the sales waiting while offline", () => {
		expect(syncPillView(at({ offline: true, waiting: 1 }), "Standard").label).toBe(
			"Offline – 1 sale waiting",
		);
		expect(syncPillView(at({ offline: true, waiting: 3 }), "Standard").label).toBe(
			"Offline – 3 sales waiting",
		);
	});

	it("shows a one-off sync error, and the last sync time", () => {
		expect(syncPillView(at({ lastError: "HTTP 417" }), "Standard").label).toBe("Sync error");
		expect(syncPillView(calm, "Standard").label).toBe("Synced 10:32:05");
	});

	it("says how many sales wait for the next sync while online", () => {
		expect(syncPillView(at({ waiting: 2 }), "Standard").label).toBe("2 waiting to sync");
	});
});

describe("Detailed", () => {
	it("also shows what is syncing", () => {
		expect(syncPillView(at({ syncing: true, syncTable: "Item Price" }), "Detailed").label).toBe(
			"Syncing: Item Price",
		);
	});
});

describe("at every level", () => {
	it.each(["Minimal", "Standard", "Detailed"] as const)(
		"%s shows sales needing attention first",
		(detail) => {
			const view = syncPillView(
				at({ needAttention: 2, offline: true, syncing: true, errorCycles: 9 }),
				detail,
			);
			expect(view).toMatchObject({ label: "2 need attention", tone: "attention" });
		},
	);
});
