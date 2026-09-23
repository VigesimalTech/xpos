import { ref, onMounted, onUnmounted } from "vue";
import { isElectron } from "@/services/electronBridge";
import { captureError } from "@/services/errorLog";

export interface SyncErrorEntry {
	message: string;
	table?: string;
	at: string;
}

export interface DeadLetterEntry {
	table: string;
	localId: string;
	retryCount: number;
	error: string;
	at: string;
}

const MAX_ERROR_LOG = 20;

export function useSyncStatus() {
	const isSyncing = ref(false);
	const syncPhase = ref<string>("idle");
	const syncTable = ref<string | null>(null);
	const lastSyncTime = ref<string | null>(null);
	const lastError = ref<string | null>(null);
	const syncCompleteCount = ref(0);

	const errorLog = ref<SyncErrorEntry[]>([]);
	const deadLetters = ref<DeadLetterEntry[]>([]);
	const cycleHadError = ref(false);
	/** Sync cycles in a row that ended in an error (K37: Minimal shows it after a few). */
	const errorCycles = ref(0);
	/** ERPNext is not answering: the till sells offline and sends later. */
	const unreachable = ref(false);

	const cleanups: Array<() => void> = [];

	onMounted(async () => {
		if (!isElectron() || !window.electronAPI) return;

		try {
			const state = await window.electronAPI.getSyncState();
			if (state?.lastSyncTime) {
				lastSyncTime.value = new Date(state.lastSyncTime).toLocaleTimeString();
			}
		} catch {}

		const offStatus = window.electronAPI.onSyncStatus((status) => {
			syncPhase.value = status.phase;
			syncTable.value = status.table ?? null;
			isSyncing.value = status.phase !== "idle";
			if (status.phase === "starting") cycleHadError.value = false;
		});

		const offError = window.electronAPI.onSyncError((error) => {
			// ERPNext not answering is being offline, which the pill shows; it is not an error
			// for the error log (it counted every failed push while offline).
			if (error.unreachable) {
				unreachable.value = true;
				return;
			}
			lastError.value = error.message;
			cycleHadError.value = true;
			errorLog.value.unshift({
				message: error.message,
				table: error.table,
				at: new Date().toISOString(),
			});
			if (errorLog.value.length > MAX_ERROR_LOG) errorLog.value.length = MAX_ERROR_LOG;
			console.warn("[Sync]", error.table ? `${error.table}: ` : "", error.message);
			captureError({
				source: "sync",
				title: `Sync error${error.table ? `: ${error.table}` : ""}`,
				message: error.message,
				meta: { table: error.table },
			});
		});

		const offComplete = window.electronAPI.onSyncComplete(() => {
			isSyncing.value = false;
			syncPhase.value = "idle";
			syncTable.value = null;
			if (!cycleHadError.value) lastError.value = null;
			errorCycles.value = cycleHadError.value ? errorCycles.value + 1 : 0;
			lastSyncTime.value = new Date().toLocaleTimeString();
			syncCompleteCount.value++;
		});

		const offDeadLetter = window.electronAPI.onSyncDeadLetter((info) => {
			deadLetters.value.unshift({
				table: info.table,
				localId: info.localId,
				retryCount: info.retryCount,
				error: info.error,
				at: new Date().toISOString(),
			});
			lastError.value = `${info.table} #${info.localId} failed permanently: ${info.error}`;
			cycleHadError.value = true;
			captureError({
				source: "dead-letter",
				title: `Dead-letter: ${info.table} #${info.localId}`,
				message: info.error,
				meta: { table: info.table, localId: info.localId, retryCount: info.retryCount },
			});
		});

		const offReachability = window.electronAPI.onSyncReachability?.(({ reachable }) => {
			unreachable.value = !reachable;
			// Back in touch: the error was the network's, not a sale's.
			if (reachable && !deadLetters.value.length) lastError.value = null;
		});

		cleanups.push(
			offStatus,
			offError,
			offComplete,
			offDeadLetter,
			...(offReachability ? [offReachability] : []),
		);
	});

	onUnmounted(() => {
		cleanups.forEach((fn) => fn());
		cleanups.length = 0;
	});

	function clearErrorLog() {
		errorLog.value = [];
		lastError.value = null;
		errorCycles.value = 0;
	}

	function clearDeadLetters() {
		deadLetters.value = [];
	}

	return {
		isSyncing,
		syncPhase,
		syncTable,
		lastSyncTime,
		lastError,
		errorCycles,
		unreachable,
		syncCompleteCount,
		errorLog,
		deadLetters,
		clearErrorLog,
		clearDeadLetters,
	};
}
