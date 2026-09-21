/**
 * Cash out of the drawer (K19): an expense or a bank drop by a cashier whose POS Role
 * does not allow it needs a manager's PIN on the till. The approver goes with the
 * record, and the server checks the approval again when it syncs.
 */
import { __ } from "@/lib/translate";
import { ensureAllowed } from "@/services/ensureAllowed";

export type CashMovementKind = "expense" | "bank_drop";

export function approveCashMovement(kind: CashMovementKind, amount: number) {
	const what =
		kind === "expense"
			? __("An expense of {0}", [String(amount)])
			: __("A bank drop of {0}", [String(amount)]);
	return ensureAllowed(kind, what);
}
