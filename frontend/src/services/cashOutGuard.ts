/**
 * What stops cash going out of the drawer (an expense or a bank drop), checked when the
 * cashier enters it, before any cash is handed over:
 *
 *   - the POS Profile's Cash Movement Max Amount, which ERPNext also enforces when the
 *     movement syncs: the till did not check it, so above the limit the cash went out and
 *     ERPNext refused the record afterwards;
 *   - with the POS Profile's Cash Out Within the Drawer (on unless switched off), the cash
 *     the till expects in the drawer: a 2,000,000,000 expense against 235,000 of cash was
 *     taken without a word (bug hunt, 22 Sep 2026).
 *
 * Returns why it cannot go, or null.
 */
import { isElectron } from "@/services/electronBridge";
import { getShiftClosingSummary } from "@/services/dbBridge";
import { usePosStore } from "@/stores/posStore";
import { formatWithSymbol } from "@/composables/useCurrency";
import __ from "@/lib/translate";

interface ProfileLimits {
	cash_movement_max_amount?: number | string | null;
	xpos_cash_out_within_drawer?: number | string | boolean | null;
	cash_mode_of_payment?: string | null;
	currency?: string | null;
}

export function cashOutLimit(
	amount: number,
	profile: ProfileLimits | null | undefined,
	drawerCash: number | null,
): string | null {
	const currency = profile?.currency || "";
	const money = (v: number) => formatWithSymbol(currency, v);
	const max = Number(profile?.cash_movement_max_amount) || 0;
	if (max > 0 && amount > max) {
		return __("{0} is over this POS Profile's limit of {1} for one cash movement.", [
			money(amount),
			money(max),
		]);
	}
	const withinDrawer = profile?.xpos_cash_out_within_drawer;
	const checkDrawer = withinDrawer === undefined || withinDrawer === null || Boolean(Number(withinDrawer));
	if (checkDrawer && drawerCash !== null && amount > drawerCash + 0.005) {
		return __("{0} is more than the {1} the drawer should hold.", [
			money(amount),
			money(Math.max(0, drawerCash)),
		]);
	}
	return null;
}

/** The cash the till expects in the drawer for its open shift, or null where it cannot tell. */
async function drawerCash(): Promise<number | null> {
	const pos = usePosStore();
	const shift = pos.posOpeningShift?.name;
	if (!isElectron() || !shift) return null;
	try {
		const summary = (await getShiftClosingSummary(String(shift))) as {
			expected_amounts?: Record<string, { amount?: number }>;
		} | null;
		const expected = summary?.expected_amounts?.[pos.cashModeOfPayment];
		return expected ? Number(expected.amount) || 0 : null;
	} catch {
		return null;
	}
}

export async function cashOutProblem(amount: number): Promise<string | null> {
	const pos = usePosStore();
	return cashOutLimit(amount, pos.posProfile as ProfileLimits, await drawerCash());
}
