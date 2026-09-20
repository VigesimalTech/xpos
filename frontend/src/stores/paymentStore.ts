import { defineStore } from "pinia";
import { ref } from "vue";
import { call } from "@/services/api";
import { isElectron } from "@/services/electronBridge";
import {
	cacheCashMovementContext,
	createBankDrop,
	createExpense,
	getBankDrops,
	getCachedCashMovementContext,
	getExpenses,
} from "@/services/dbBridge";
import { nowDate } from "@/utils/datetime";
import { useAuthStore } from "./authStore";
import type {
	OutstandingInvoice,
	UnallocatedPayment,
	CustomerCredit,
	CashMovementContext,
	POSCashMovement,
} from "@/types/pos.types";

export const usePaymentStore = defineStore("payment", () => {
	const availableCredit = ref<CustomerCredit | null>(null);
	const isLoadingCredit = ref(false);

	const showCashMovementDialog = ref(false);
	const cashMovementType = ref<"expense" | "deposit">("expense");
	const cashMovementContext = ref<CashMovementContext | null>(null);
	const shiftCashMovements = ref<POSCashMovement[]>([]);
	const isLoadingCashMovement = ref(false);

	async function fetchAvailableCredit(customer: string, company?: string): Promise<CustomerCredit | null> {
		isLoadingCredit.value = true;
		try {
			const result = await call<CustomerCredit>("xpos.api.customers.get_customer_credit", {
				customer,
				company: company || "",
			});
			availableCredit.value = result;
			return result;
		} catch (error) {
			console.error("Error fetching credit:", error);
			return null;
		} finally {
			isLoadingCredit.value = false;
		}
	}

	async function fetchOutstandingInvoices(
		customer: string,
		company?: string,
	): Promise<OutstandingInvoice[]> {
		try {
			const result = await call<OutstandingInvoice[]>("xpos.api.payments.get_outstanding_invoices", {
				customer,
				company: company || "",
			});
			return result || [];
		} catch (error) {
			console.error("Error fetching outstanding invoices:", error);
			return [];
		}
	}

	async function fetchUnallocatedPayments(
		customer: string,
		company?: string,
	): Promise<UnallocatedPayment[]> {
		try {
			const result = await call<UnallocatedPayment[]>("xpos.api.payments.get_unallocated_payments", {
				customer,
				company: company || "",
			});
			return result || [];
		} catch (error) {
			console.error("Error fetching unallocated payments:", error);
			return [];
		}
	}

	async function createPaymentRequest(data: Record<string, unknown>): Promise<unknown> {
		try {
			const result = await call("xpos.api.payments.create_payment_request", data);
			return result;
		} catch (error) {
			console.error("Error creating payment request:", error);
			throw error;
		}
	}

	async function fetchCashMovementContext(
		posProfile: string,
		posOpeningShift: string,
	): Promise<CashMovementContext | null> {
		try {
			const result = await call<CashMovementContext>(
				"xpos.api.cash_movements.get_cash_movement_context",
				{ pos_profile: posProfile },
			);
			cashMovementContext.value = result;
			await cacheCashMovementContext(posProfile, result).catch(() => {});
			return result;
		} catch (error) {
			// Offline, the till uses the settings it last saw.
			const cached = await getCachedCashMovementContext<CashMovementContext>(posProfile).catch(
				() => null,
			);
			if (cached) {
				cashMovementContext.value = cached;
				return cached;
			}
			console.error("Error fetching cash movement context:", error);
			return null;
		}
	}

	/**
	 * On the till, an expense or deposit is kept with the shift and synced to ERPNext
	 * (sync_cash_movement), as on the Expenses and Bank Drops screens: the shift is the
	 * till's own until it syncs, and the till may be offline.
	 */
	async function recordOnTill(
		kind: "expense" | "deposit",
		data: Record<string, unknown>,
	): Promise<unknown> {
		const record = {
			to_account: kind === "expense" ? data.expense_account : data.target_account,
			amount: data.amount,
			remarks: data.reason,
			posting_date: nowDate(),
			company: data.company,
			user: useAuthStore().userName,
			pos_opening_entry_id: data.pos_opening_shift ? Number(data.pos_opening_shift) : null,
		};
		return kind === "expense" ? createExpense(record) : createBankDrop(record);
	}

	async function createPosExpense(data: Record<string, unknown>): Promise<unknown> {
		if (isElectron()) return recordOnTill("expense", data);
		isLoadingCashMovement.value = true;
		try {
			const result = await call("xpos.api.cash_movements.create_pos_expense", {
				payload: data,
			});
			return result;
		} catch (error) {
			console.error("Error creating POS expense:", error);
			throw error;
		} finally {
			isLoadingCashMovement.value = false;
		}
	}

	async function createCashDeposit(data: Record<string, unknown>): Promise<unknown> {
		if (isElectron()) return recordOnTill("deposit", data);
		isLoadingCashMovement.value = true;
		try {
			const result = await call("xpos.api.cash_movements.create_cash_deposit", {
				payload: data,
			});
			return result;
		} catch (error) {
			console.error("Error creating cash deposit:", error);
			throw error;
		} finally {
			isLoadingCashMovement.value = false;
		}
	}

	async function fetchShiftCashMovements(
		openingShift: string,
		movement_type: string,
		from_date?: string,
		to_date?: string,
		limit_start?: number,
		limit_page_length?: number,
	): Promise<{ data: POSCashMovement[]; total: number }> {
		if (isElectron()) {
			const rows = (await (movement_type === "deposit" ? getBankDrops : getExpenses)({
				shiftLocalId: openingShift,
			})) as Record<string, unknown>[];
			shiftCashMovements.value = rows.map(
				(row) =>
					({
						name: String(row.erp_id || row.id),
						movement_type: movement_type === "deposit" ? "Deposit" : "Expense",
						amount: Number(row.amount || 0),
						remarks: String(row.remarks || ""),
						posting_date: String(row.posting_date || ""),
					}) as unknown as POSCashMovement,
			);
			return { data: shiftCashMovements.value, total: rows.length };
		}
		try {
			const params: Record<string, string | number> = {
				pos_opening_shift: openingShift,
				movement_type: movement_type,
			};
			if (from_date) params.from_date = from_date;
			if (to_date) params.to_date = to_date;
			if (limit_start !== undefined) params.limit_start = limit_start;
			if (limit_page_length !== undefined) params.limit_page_length = limit_page_length;
			const result = await call<{ data: POSCashMovement[]; total: number }>(
				"xpos.api.cash_movements.get_shift_cash_movements",
				params,
			);
			shiftCashMovements.value = result?.data || [];
			return { data: shiftCashMovements.value, total: result?.total || 0 };
		} catch (error) {
			console.error("Error fetching shift cash movements:", error);
			return { data: [], total: 0 };
		}
	}

	function openCashMovement(type: "expense" | "deposit"): void {
		cashMovementType.value = type;
		showCashMovementDialog.value = true;
	}

	function closeCashMovement(): void {
		showCashMovementDialog.value = false;
	}

	function clearCredit(): void {
		availableCredit.value = null;
	}

	return {
		// Credit
		availableCredit,
		isLoadingCredit,
		fetchAvailableCredit,
		fetchOutstandingInvoices,
		fetchUnallocatedPayments,
		createPaymentRequest,
		clearCredit,
		// Cash Movements
		showCashMovementDialog,
		cashMovementType,
		cashMovementContext,
		shiftCashMovements,
		isLoadingCashMovement,
		fetchCashMovementContext,
		createPosExpense,
		createCashDeposit,
		fetchShiftCashMovements,
		openCashMovement,
		closeCashMovement,
	};
});
