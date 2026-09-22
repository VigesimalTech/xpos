/**
 * The screens a cashier may open (K27). A screen that needs a POS Role permission the
 * cashier's role lacks is hidden, or, when the POS Profile's Screens the Role Lacks says
 * Show, Ask a Manager, it stays and opens with a manager's PIN on the till. The web POS
 * has no PIN to check, so there it is hidden either way. Purchasing also needs the POS
 * Profile's Allow Purchasing (D7), whatever the role allows.
 *
 * Menus, the sidebar, shortcuts and search ask `canOpenScreen` whether to offer a screen;
 * the router asks `openScreen`, so typing an address is no way round it.
 */
import { isElectron } from "@/services/electronBridge";
import { canDoOrAsk, hasPermission, type PosPermissions } from "@/services/userRights";
import { ensureAllowed } from "@/services/ensureAllowed";
import { usePosStore } from "@/stores/posStore";
import __ from "@/lib/translate";

export type Screen =
	| "reports"
	| "barcode_printer"
	| "price_checker"
	| "purchasing"
	| "expenses"
	| "bank_drops";

interface ScreenRule {
	label: string;
	/** The POS Role permission that opens it. */
	permission?: keyof PosPermissions;
	/** Whether the POS Profile offers the screen at all. */
	offered?: () => boolean;
}

const RULES: Record<Screen, ScreenRule> = {
	reports: { label: "Reports", permission: "view_reports" },
	barcode_printer: { label: "Barcode Printer", permission: "barcode_printer" },
	price_checker: { label: "Price Checker", permission: "price_checker" },
	purchasing: {
		label: "Purchasing",
		permission: "purchasing",
		offered: () => usePosStore().allowPurchasing,
	},
	// Screens for an action (D8): shown to anyone who can do it or ask a manager, and the
	// action itself asks when it is saved.
	expenses: {
		label: "Expenses",
		offered: () => usePosStore().allowPosExpense && canDoOrAsk("expense"),
	},
	bank_drops: {
		label: "Bank Drops",
		offered: () => usePosStore().allowCashDeposit && canDoOrAsk("bank_drop"),
	},
};

const ROUTE_SCREENS: Record<string, Screen> = {
	reports: "reports",
	"report-viewer": "reports",
	"barcode-print": "barcode_printer",
	"price-checker": "price_checker",
	"purchase-order": "purchasing",
	"purchase-orders": "purchasing",
	"purchase-invoice": "purchasing",
	"purchase-invoices": "purchasing",
	"stock-receiving": "purchasing",
	expenses: "expenses",
	"bank-drops": "bank_drops",
};

export function screenOfRoute(name: unknown): Screen | undefined {
	return typeof name === "string" ? ROUTE_SCREENS[name] : undefined;
}

/** A manager may approve it here: on the till, when the POS Profile shows such screens. */
export function managerMayApprove(): boolean {
	return isElectron() && usePosStore().askForScreens;
}

/** Whether to offer the screen: in the menus, the sidebar, shortcuts and search. */
export function canOpenScreen(screen: Screen): boolean {
	const rule = RULES[screen];
	if (rule.offered && !rule.offered()) return false;
	if (!rule.permission) return true;
	return hasPermission(rule.permission) || managerMayApprove();
}

/** Whether the cashier may go in now; asks a manager's PIN when the role lacks it. */
export async function openScreen(screen: Screen): Promise<boolean> {
	const rule = RULES[screen];
	if (rule.offered && !rule.offered()) return false;
	if (!rule.permission || hasPermission(rule.permission)) return true;
	if (!managerMayApprove()) return false;
	const { ok } = await ensureAllowed(rule.permission, __("Open {0}", [__(rule.label)]));
	return ok;
}
