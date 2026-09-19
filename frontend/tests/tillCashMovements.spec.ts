/**
 * @vitest-environment jsdom
 *
 * The Cash Movement dialog on the desktop till records expenses and deposits with the
 * till's shift and lists them from the till, as the Expenses and Bank Drops screens do,
 * and keeps working offline with the settings it last saw.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const meta = new Map<string, unknown>();
const createExpense = vi.fn(async (_r: Record<string, unknown>) => ({ id: 1 }));
const createBankDrop = vi.fn(async (_r: Record<string, unknown>) => ({ id: 2 }));

vi.mock("@/services/api", () => ({ call: vi.fn() }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));
vi.mock("@/services/dbBridge", () => ({
	createExpense: (r: Record<string, unknown>) => createExpense(r),
	createBankDrop: (r: Record<string, unknown>) => createBankDrop(r),
	getExpenses: vi.fn(async () => [
		{ id: 7, amount: "25.000000", remarks: "Taxi", posting_date: "2026-09-19", erp_id: null },
	]),
	getBankDrops: vi.fn(async () => []),
	cacheCashMovementContext: vi.fn(async (profile: string, ctx: unknown) => void meta.set(profile, ctx)),
	getCachedCashMovementContext: vi.fn(async (profile: string) => meta.get(profile) ?? null),
}));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ userEmail: "cashier@example.com" }) }));

import { call } from "@/services/api";
import { usePaymentStore } from "@/stores/paymentStore";

describe("cash movements on the desktop till", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.mocked(call).mockReset();
		createExpense.mockClear();
		createBankDrop.mockClear();
		meta.clear();
	});

	it("keeps an expense with the till's shift instead of posting it to ERPNext", async () => {
		await usePaymentStore().createPosExpense({
			expense_account: "Travel - S",
			amount: 25,
			reason: "Taxi",
			company: "S",
			pos_opening_shift: "3",
		});

		expect(call).not.toHaveBeenCalled();
		expect(createExpense).toHaveBeenCalledWith(
			expect.objectContaining({
				to_account: "Travel - S",
				amount: 25,
				remarks: "Taxi",
				user: "cashier@example.com",
				pos_opening_entry_id: 3,
			}),
		);
	});

	it("keeps a deposit as a bank drop", async () => {
		await usePaymentStore().createCashDeposit({
			target_account: "Safe - S",
			amount: 500,
			reason: "",
			pos_opening_shift: "3",
		});
		expect(call).not.toHaveBeenCalled();
		expect(createBankDrop).toHaveBeenCalledWith(
			expect.objectContaining({ to_account: "Safe - S", amount: 500 }),
		);
	});

	it("lists the shift's movements from the till", async () => {
		const { data } = await usePaymentStore().fetchShiftCashMovements("3", "expense");
		expect(call).not.toHaveBeenCalled();
		expect(data).toEqual([
			expect.objectContaining({ movement_type: "Expense", amount: 25, remarks: "Taxi" }),
		]);
	});

	it("offline, uses the cash movement settings it last saw", async () => {
		const ctx = { expense_accounts: [{ account: "Travel - S" }] };
		vi.mocked(call).mockResolvedValueOnce(ctx);
		const store = usePaymentStore();
		await store.fetchCashMovementContext("Shop", "3");

		vi.mocked(call).mockRejectedValueOnce(new Error("__offline__"));
		setActivePinia(createPinia());
		const offline = await usePaymentStore().fetchCashMovementContext("Shop", "3");
		expect(offline).toEqual(ctx);
	});
});
