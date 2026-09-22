/**
 * Cash out of the drawer (K19): an expense or a bank drop by a cashier whose POS Role
 * does not allow it needs a manager's PIN on the till. The approver goes with the
 * record, and the server checks the approval again when it syncs.
 */
import { __ } from "@/lib/translate";
import { ensureAllowed } from "@/services/ensureAllowed";
import { cashOutProblem } from "@/services/cashOutGuard";

export type CashMovementKind = "expense" | "bank_drop";

export async function approveCashMovement(
	kind: CashMovementKind,
	amount: number,
): Promise<{ ok: boolean; approvedBy?: string; problem?: string }> {
	// Limits first: no one, manager or not, hands out more than the profile or the drawer
	// allows. `problem` says why, for the caller to show.
	const problem = await cashOutProblem(amount);
	if (problem) return { ok: false, problem };
	const what =
		kind === "expense"
			? __("An expense of {0}", [String(amount)])
			: __("A bank drop of {0}", [String(amount)]);
	return ensureAllowed(kind, what);
}
