/**
 * Where each "?" in the app opens the user guide: a page of docs/features and one of its
 * sections, as the docs link to it (`<page>#<section>`).
 *
 * The docs' headings are these links' targets. tests/helpGuide.spec.ts fails when a page or
 * section named here no longer exists, so renaming a heading cannot quietly break a "?".
 *
 * Kept apart from the guide itself so the screens that show a "?" do not load the pages.
 */

import type { RouteLocationRaw } from "vue-router";
import { hasPermission } from "@/services/userRights";
import { useAuthStore } from "@/stores/authStore";

/** Who the guide is written for, lowest first. Kept here so screens need not load the guide. */
export type HelpAudience = "cashier" | "supervisor" | "administrator";

/**
 * How much of the guide the signed-in user sees (K39): everything with Manage Role
 * Permissions, the supervisor sections too with Approve Exceptions, else the cashier's.
 * The rights are those of the open shift's POS Profile.
 */
export function helpAudience(signedIn = true): HelpAudience {
	if (!signedIn) return "cashier";
	// The web page's boot says so on the web POS; on the till it comes with the cashier.
	if (hasPermission("manage_role_permissions") || useAuthStore().canManagePermissions)
		return "administrator";
	if (hasPermission("approve_exceptions")) return "supervisor";
	return "cashier";
}

/** The audience each "?" is pressed by: its section must be one they can read (tests/helpGuide.spec.ts). */
export const TOPIC_AUDIENCE: Record<keyof typeof HELP_TOPICS, HelpAudience> = {
	signIn: "cashier",
	managerApproval: "cashier",
	closeShift: "cashier",
	cashMovement: "cashier",
	syncStatus: "cashier",
	changeFromCash: "cashier",
};

export const HELP_TOPICS = {
	signIn: "29-desktop-till#signing-in-with-a-pin",
	managerApproval: "30-cashier-rights-approval#manager-approval-on-the-till",
	closeShift: "02-shift-management#closing-a-shift-on-the-desktop-till",
	cashMovement: "14-cash-movements#limits",
	syncStatus: "29-desktop-till#the-sync-engine",
	changeFromCash: "06-payment-processing#change-comes-only-from-cash",
} as const;

export type HelpTopic = keyof typeof HELP_TOPICS;

/** The only sections shown before sign-in: a cashier who forgot their PIN can read these. */
export const PUBLIC_SECTIONS: readonly string[] = [
	"29-desktop-till#signing-in-with-a-pin",
	"01-authentication#desktop-till-sign-in",
];

export function splitTarget(target: string): { page: string; section?: string } {
	const [page, section] = target.split("#");
	return { page, section: section || undefined };
}

export function isPublic(page: string, section?: string): boolean {
	return PUBLIC_SECTIONS.includes(section ? `${page}#${section}` : page);
}

/** The Help screen's route for a page and section. */
export function helpRoute(page?: string, section?: string): RouteLocationRaw {
	return {
		name: "help",
		params: page ? { page } : {},
		query: section ? { section } : {},
	};
}

export function topicRoute(topic: HelpTopic, signedIn = true): RouteLocationRaw {
	const { page, section } = splitTarget(HELP_TOPICS[topic]);
	if (!signedIn) return { name: "help-sign-in" };
	return helpRoute(page, section);
}
