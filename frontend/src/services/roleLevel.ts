/**
 * How far the signed-in user's POS Role reaches, for what the app shows rather than what it
 * allows (K39, K40): everything with Manage Role Permissions, the supervisor's share with
 * Approve Exceptions, else the cashier's. The rights are those of the open shift's POS
 * Profile. The server's checks stay the controls; this decides what is offered.
 */
import { hasPermission } from "@/services/userRights";
import { useAuthStore } from "@/stores/authStore";

export type RoleLevel = "cashier" | "supervisor" | "administrator";

const RANK: Record<RoleLevel, number> = { cashier: 0, supervisor: 1, administrator: 2 };

export function roleLevel(signedIn = true): RoleLevel {
	if (!signedIn) return "cashier";
	// The web page's boot says so on the web POS; on the till it comes with the cashier.
	if (hasPermission("manage_role_permissions") || useAuthStore().canManagePermissions)
		return "administrator";
	if (hasPermission("approve_exceptions")) return "supervisor";
	return "cashier";
}

/** Whether the signed-in user reaches at least `level`. */
export function reachesLevel(level: RoleLevel): boolean {
	return RANK[roleLevel()] >= RANK[level];
}
