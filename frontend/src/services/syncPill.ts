/**
 * What the sync status says, at the level the POS Profile asks for (K37). One rule for the
 * desktop till's pill and the web POS's indicator, so they never tell a cashier different
 * things.
 *
 * - Minimal (the default): Online, Offline, or what needs attention. Nothing flickers
 *   while a sync runs. A sync problem that keeps coming back is shown as needing attention,
 *   so prices or stock never go stale unseen.
 * - Standard: also syncing, the last sync time, sales waiting and a one-off sync error.
 * - Detailed: also what is syncing.
 *
 * At every level what needs attention shows first, and clicking opens the full panel.
 */

export type SyncStatusDetail = "Minimal" | "Standard" | "Detailed";

/** Sync cycles in a row that must end in an error before Minimal shows it. */
export const REPEATED_ERROR_CYCLES = 3;

export interface SyncPillState {
	/** Sales ERPNext refused, waiting for someone to look at them. */
	needAttention: number;
	/** ERPNext is not answering: the POS sells offline and sends later. */
	offline: boolean;
	/** Sales kept to send once ERPNext answers. */
	waiting: number;
	syncing: boolean;
	/** What is syncing right now, if known. */
	syncTable?: string | null;
	lastError?: string | null;
	/** Sync cycles in a row that ended in an error. */
	errorCycles: number;
	/** When the last sync finished, as shown to the cashier. */
	lastSyncTime?: string | null;
}

export type SyncTone = "quiet" | "syncing" | "offline" | "attention";

export interface SyncPillView {
	label: string;
	tone: SyncTone;
	/** Animate while a sync runs (not at Minimal). */
	busy: boolean;
	tooltip: string;
}

const WAITING_TIP = "ERPNext is not answering. Sales are saved and sent when it is back.";

function offlineLabel(waiting: number): string {
	if (waiting === 1) return "Offline – 1 sale waiting";
	if (waiting > 1) return `Offline – ${waiting} sales waiting`;
	return "Offline";
}

export function syncPillView(state: SyncPillState, detail: SyncStatusDetail = "Minimal"): SyncPillView {
	if (state.needAttention > 0) {
		return {
			label: `${state.needAttention} need attention`,
			tone: "attention",
			busy: false,
			tooltip: `${state.needAttention} sale(s) failed to sync. Click to review.`,
		};
	}

	if (detail === "Minimal") {
		if (state.errorCycles >= REPEATED_ERROR_CYCLES) {
			return {
				label: "Sync problem",
				tone: "attention",
				busy: false,
				tooltip: `${state.lastError || "Syncing keeps failing."} Click for details.`,
			};
		}
		if (state.offline) return { label: "Offline", tone: "offline", busy: false, tooltip: WAITING_TIP };
		return { label: "Online", tone: "quiet", busy: false, tooltip: "Connected to ERPNext." };
	}

	if (state.offline) {
		return { label: offlineLabel(state.waiting), tone: "offline", busy: false, tooltip: WAITING_TIP };
	}
	if (state.syncing) {
		const what = detail === "Detailed" && state.syncTable ? `: ${state.syncTable}` : "...";
		return { label: `Syncing${what}`, tone: "syncing", busy: true, tooltip: "Syncing with ERPNext." };
	}
	if (state.lastError)
		return { label: "Sync error", tone: "attention", busy: false, tooltip: state.lastError };
	if (state.waiting > 0) {
		return {
			label: `${state.waiting} waiting to sync`,
			tone: "quiet",
			busy: false,
			tooltip: "Sales saved here, to be sent with the next sync.",
		};
	}
	if (state.lastSyncTime) {
		return {
			label: `Synced ${state.lastSyncTime}`,
			tone: "quiet",
			busy: false,
			tooltip: `Last sync: ${state.lastSyncTime}`,
		};
	}
	return { label: "Sync pending", tone: "quiet", busy: false, tooltip: "Not synced yet." };
}
