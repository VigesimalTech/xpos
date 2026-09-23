/**
 * An action the cashier's POS Role does not allow (K19). On the desktop till it is not
 * refused: a manager approves it with their PIN, and the approver goes with any record
 * it makes. On the web POS it is refused, as before: no PIN is checked there.
 */
import { isElectron } from "@/services/electronBridge";
import { hasPermission, type PosPermissions } from "@/services/userRights";
import { useApprovalStore } from "@/stores/approvalStore";
import __ from "@/lib/translate";

/** What the web POS says when it refuses a removal (K38): no manager's PIN can be asked there. */
export const REMOVAL_REFUSED_ON_WEB = () =>
	__("Taking items out of a sale needs the Remove Items From the Cart permission. Ask a manager.");

export async function ensureAllowed(
	permission: keyof PosPermissions,
	reason: string,
): Promise<{ ok: boolean; approvedBy?: string }> {
	if (hasPermission(permission)) return { ok: true };
	if (!isElectron()) return { ok: false };
	const approver = await useApprovalStore().requestApproval({ permission }, reason);
	return approver ? { ok: true, approvedBy: approver } : { ok: false };
}
