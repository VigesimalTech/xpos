/**
 * Cash out of the drawer (K19): an expense or a bank drop by a cashier whose POS Role
 * does not allow it needs a manager's PIN on the till. The approver goes with the
 * record, and the server checks the approval again when it syncs.
 */
import { __ } from "@/lib/translate";
import { hasPermission } from "@/services/userRights";
import { useApprovalStore } from "@/stores/approvalStore";

export type CashMovementKind = "expense" | "bank_drop";

export async function approveCashMovement(
	kind: CashMovementKind,
	amount: number,
): Promise<{ ok: boolean; approvedBy?: string }> {
	if (hasPermission(kind)) return { ok: true };
	const what =
		kind === "expense"
			? __("An expense of {0}", [String(amount)])
			: __("A bank drop of {0}", [String(amount)]);
	const approver = await useApprovalStore().requestApproval({ permission: kind }, what);
	return approver ? { ok: true, approvedBy: approver } : { ok: false };
}
