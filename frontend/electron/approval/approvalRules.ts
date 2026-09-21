/**
 * Who may approve, on the till, what a cashier may not do alone (K19).
 *
 * A manager approves with their PIN on the same till, offline if need be. They must
 * hold Approve Exceptions, and an approval is held to their own rights: they may not
 * approve what their role does not allow, nor a discount beyond their own limit. The
 * cashier may not approve their own exception unless the POS Profile allows it.
 * The server checks the same again when the record syncs (xpos/api/approval.py).
 *
 * Pure: no database, no Electron.
 */

export interface ApproverRow {
	name: string;
	enabled: number | boolean | null;
	approve_exceptions?: number | boolean | null;
	discount_limit?: number | string | null;
	[permission: string]: unknown;
}

export interface ApprovalRequest {
	/** Who is asking: the cashier signed in on the till. */
	cashier: string;
	/** The POS Role permission the action needs, when it needs one. */
	permission?: string;
	/** Several, when one approval covers a whole sale (a price change and a discount). */
	permissions?: string[];
	/** The discount, in percent of the list price, when the action is a discount. */
	discountPct?: number;
	profileMaxDiscount?: number | string | null;
	allowSelfApproval: boolean;
}

export type ApprovalRefusal =
	| "disabled"
	| "not_an_approver"
	| "self_approval"
	| "lacks_permission"
	| "over_limit";

const TOLERANCE = 0.005;

function pct(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0;
}

/** The discount a user may give alone: 0 means none, 100 means no cap, the lower wins. */
export function effectiveDiscountLimit(userLimit: unknown, profileMax: unknown): number {
	return Math.min(pct(userLimit), pct(profileMax));
}

/** Why `approver` may not approve this request, or null when they may. */
export function approvalRefusal(approver: ApproverRow, request: ApprovalRequest): ApprovalRefusal | null {
	if (!Number(approver.enabled)) return "disabled";
	if (!Number(approver.approve_exceptions)) return "not_an_approver";
	if (approver.name === request.cashier && !request.allowSelfApproval) return "self_approval";
	const needed = [...(request.permission ? [request.permission] : []), ...(request.permissions ?? [])];
	if (needed.some((key) => !Number(approver[key]))) return "lacks_permission";
	if (
		request.discountPct !== undefined &&
		request.discountPct >
			effectiveDiscountLimit(approver.discount_limit, request.profileMaxDiscount) + TOLERANCE
	) {
		return "over_limit";
	}
	return null;
}
