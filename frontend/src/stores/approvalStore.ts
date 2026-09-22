/**
 * A manager's approval on the till (K19). Anything the cashier may not do alone asks
 * `requestApproval` and waits: it resolves to the approver's name once a manager has
 * entered their PIN, or null if the cashier cancels. The approver then travels with
 * the record, and the server checks the approval again when it syncs.
 *
 * Desktop only: the web POS has no PIN to check, so nothing is approved there.
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { isElectron } from "@/services/electronBridge";
import { useAuthStore } from "@/stores/authStore";
import { usePosStore } from "@/stores/posStore";

export interface ApprovalNeed {
	/** The POS Role permission the action needs, when it needs one. */
	permission?: string;
	/** Several, when one approval covers a whole sale. */
	permissions?: string[];
	/** The discount, in percent of the list price, when it is a discount. */
	discountPct?: number;
}

export interface Approver {
	name: string;
	full_name: string;
}

export const useApprovalStore = defineStore("approval", () => {
	const open = ref(false);
	const reason = ref("");
	const need = ref<ApprovalNeed>({});
	const approvers = ref<Approver[]>([]);
	const loading = ref(false);
	let settle: ((approver: string | null) => void) | null = null;

	/** What goes to the main process: plain data, as Electron's IPC can only copy that. */
	function ask() {
		const pos = usePosStore();
		const shift = pos.posOpeningShift?.name;
		const { permissions, ...rest } = need.value;
		return {
			...rest,
			// A reactive list of permissions could not be sent ("An object could not be
			// cloned"): no approvers were found (release sweep, 22 Sep 2026).
			...(permissions ? { permissions: [...permissions] } : {}),
			cashier: useAuthStore().userName,
			posProfile: pos.posProfile?.name ?? "",
			// K20: the audit log records what was approved, and in which shift.
			reason: reason.value,
			...(shift ? { shift } : {}),
		};
	}

	async function requestApproval(what: ApprovalNeed, why: string): Promise<string | null> {
		if (!isElectron() || !window.electronAPI?.approval) return null;
		finish(null); // a request still open is cancelled by a new one
		need.value = { ...what };
		reason.value = why;
		approvers.value = [];
		open.value = true;
		loading.value = true;
		const answer = new Promise<string | null>((resolve) => (settle = resolve));
		try {
			approvers.value = await window.electronAPI.approval.approvers(ask());
		} finally {
			loading.value = false;
		}
		return answer;
	}

	async function verify(approver: string, pin: string) {
		return window.electronAPI!.approval.verify(approver, pin, ask());
	}

	function finish(approver: string | null) {
		const done = settle;
		settle = null;
		open.value = false;
		done?.(approver);
	}

	return { open, reason, need, approvers, loading, requestApproval, verify, finish };
});
