import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { call } from "@/services/api";
import { setTillIdentity } from "@/services/tillIdentity";
import {
	cachePOSData,
	getCachedPOSData,
	cacheReceiptContext,
	closePosShift,
	createPosClosingEntry,
	getShiftClosingSummary,
} from "@/services/dbBridge";
import { isElectron } from "@/services/electronBridge";
import { useSettingsStore } from "./settingsStore";
import { hasPermission, loadPermissions } from "@/services/userRights";
import {
	type POSOpeningShift,
	type POSProfile,
	type Company,
	type StockSettings,
	type ShiftCheckResult,
	type OpeningData,
	type ShiftSummary,
	type PrintFormat,
	type TaxDetail,
	type PrintSettings,
	type ReceiptContext,
} from "@/types/pos.types";
import { isOnline } from "@/utils";
import { nowDate, nowDatetime } from "@/utils/datetime";
import { symbolFor } from "@/composables/useCurrency";

export const usePosStore = defineStore("pos", () => {
	const isLoading = ref(true);
	const isReady = ref(false);
	const isCashier = ref(true);
	const currentView = ref("pos");
	const posOpeningShift = ref<POSOpeningShift | null>(null);
	const posProfile = ref<POSProfile | null>(null);
	const company = ref<Company | null>(null);
	const stockSettings = ref<StockSettings>({});
	const taxes = ref<TaxDetail[]>([]);
	const taxInclusiveMode = ref(false);
	const disableRoundedTotal = ref(false);
	const printSettings = ref<PrintSettings | null>(null);
	const showOpeningDialog = ref(false);
	const openingData = ref<OpeningData | null>(null);
	const showClosingDialog = ref(false);
	const closingData = ref<ShiftSummary | null>(null);
	const printFormats = ref<PrintFormat[]>([]);
	const lastInvoiceName = ref("");
	const isShiftOpen = computed(() => !!posOpeningShift.value);

	const profileName = computed(() => posProfile.value?.name || "");
	const warehouse = computed(() => posProfile.value?.warehouse || "");
	const currency = computed(() => posProfile.value?.currency);

	if (isElectron()) {
		watch(profileName, (name) => setTillIdentity({ posProfile: name || undefined }), { immediate: true });
	}

	// A user on two POS Profiles may have a different role on each: their rights follow the
	// profile of the shift that is open.
	watch(profileName, async (name, prev) => {
		if (!name || name === prev) return;
		const { useAuthStore } = await import("@/stores/authStore");
		await loadPermissions(useAuthStore().userName, name);
	});

	const currencySymbol = computed(() => symbolFor(currency.value) || currency.value || "$");

	const invoiceCurrency = computed(
		() => posProfile.value?.currency || company.value?.default_currency || "",
	);

	const paymentMethods = computed(() => {
		if (!posProfile.value?.payments) return [];
		return posProfile.value.payments.map((p) => ({
			mode_of_payment: p.mode_of_payment,
			default: p.default,
			pos_tender_currency: p.pos_tender_currency || invoiceCurrency.value,
			type: p.type || "",
			is_foreign_tender: !!p.is_foreign_tender,
			exchange_rate: p.exchange_rate ?? 1,
			rate_date: p.rate_date || "",
		}));
	});

	const foreignTenderModes = computed(() => paymentMethods.value.filter((m) => m.is_foreign_tender));

	// Change comes only out of these. Where a row carries no type (the till's own rows did not),
	// the profile's cash mode is cash: without it the till could give no change (22 Sep 2026).
	const cashTenderModes = computed(() =>
		paymentMethods.value.filter((m) =>
			m.type ? m.type === "Cash" : m.mode_of_payment === cashModeOfPayment.value,
		),
	);

	const allowMixedCurrencyTender = computed(
		() => !!posProfile.value?.pos_mixed_currency_tender && foreignTenderModes.value.length > 0,
	);

	function tenderModeFor(modeOfPayment: string) {
		return paymentMethods.value.find((m) => m.mode_of_payment === modeOfPayment);
	}

	function tenderRateFor(modeOfPayment: string): number {
		return tenderModeFor(modeOfPayment)?.exchange_rate ?? 1;
	}

	function tenderCurrencyFor(modeOfPayment: string): string {
		return tenderModeFor(modeOfPayment)?.pos_tender_currency || invoiceCurrency.value;
	}

	const companyName = computed(() => company.value?.name || "");

	const sellingPriceList = computed(() => posProfile.value?.selling_price_list || "");

	// window.xpos.boot exists only in the web POS, which ERPNext serves; the desktop app reads the
	// type from the ERP settings it fetches. Without it Order History asked ERPNext for no doctype.
	const invoiceType = computed(
		() => xpos.boot?.pos_settings?.invoice_type || useSettingsStore().invoiceType || "Sales Invoice",
	);

	const defaultPrintFormat = computed(
		() => posProfile.value?.default_print_format || "XPOS Thermal Receipt",
	);

	const defaultCustomer = computed(() => posProfile.value?.customer || "");

	const hideImages = computed(() => !!posProfile.value?.hide_images);

	const hideUnavailableItems = computed(() => !!posProfile.value?.hide_unavailable_items);

	const blockSaleBeyondAvailableQty = computed(() => !!posProfile.value?.block_sale_beyond_available_qty);

	const defaultView = computed(() => posProfile.value?.default_view || "Card");

	const defaultPosExpenseAccount = computed(() => posProfile.value?.default_pos_expense_account);

	const requireCashMovementRemarks = computed(() => posProfile.value?.require_cash_movement_remarks);

	const backOfficeCashAccount = computed(() => posProfile.value?.back_office_cash_account);

	const useOfflineMode = computed(() => !!posProfile.value?.use_offline_mode);

	const allowChangePostingDate = computed(() => !!posProfile.value?.allow_change_posting_date);

	const allowPartialPayment = computed(() => !!posProfile.value?.allow_partial_payment);

	const allowCreditSale = computed(() => !!posProfile.value?.allow_credit_sale);

	const allowReturn = computed(() => !!posProfile.value?.allow_return);

	const allowReturnWithoutInvoice = computed(() => !!posProfile.value?.allow_return_without_invoice);

	const allowSalesOrder = computed(() => !!posProfile.value?.allow_sales_order);

	const allowDeleteOfflineInvoice = computed(() => !!posProfile.value?.allow_delete_offline_invoice);

	const displayAdditionalNotes = computed(() => !!posProfile.value?.display_additional_notes);

	const allowedSalesPersons = computed(() =>
		(posProfile.value?.allowed_sales_persons ?? []).map((row) => row.sales_person).filter(Boolean),
	);

	const salesPersonEnabled = computed(() => allowedSalesPersons.value.length > 0);

	const allowWriteOffChange = computed(() => !!posProfile.value?.allow_write_off_change);

	const displayItemCode = computed(() => !!posProfile.value?.display_item_code);

	const allowZeroRatedItems = computed(() => !!posProfile.value?.allow_zero_rated_items);

	// Number(): the desktop till's database hands decimals back as text.
	const maxDiscountAllowed = computed(() => Number(posProfile.value?.max_discount_percentage_allowed) || 0);

	const inputQty = computed(() => !!posProfile.value?.input_qty);

	const taxInclusive = computed(() => !!posProfile.value?.tax_inclusive);

	const hideClosingShift = computed(() => !!posProfile.value?.hide_closing_shift);
	// K21: a blind cash-up; the difference is for the supervisor, in ERPNext.
	const hideExpectedAmount = computed(() => !!posProfile.value?.hide_expected_amount);

	const enableCashMovement = computed(() => !!posProfile.value?.enable_cash_movement);

	const allowPosExpense = computed(() => !!posProfile.value?.allow_pos_expense);

	const allowCashDeposit = computed(() => !!posProfile.value?.allow_cash_deposit);

	// K27: a screen the cashier's role lacks is hidden, or opens with a manager's PIN.
	const askForScreens = computed(() => posProfile.value?.xpos_screen_access === "Show, Ask a Manager");

	const allowPurchasing = computed(() => !!posProfile.value?.xpos_allow_purchasing);

	// K37: how much the sync status shows; unset (an older profile) counts as Minimal.
	const syncStatusDetail = computed(() => posProfile.value?.xpos_sync_status_detail || "Minimal");

	// The Loyalty Program button on the cart, where a cashier enrols a customer. Off by
	// default: a shop may run a programme in ERPNext without enrolling at the till.
	const showLoyalty = computed(() => !!posProfile.value?.xpos_show_loyalty);

	// The POS Profile's Allow Rate Change rules price changes: off, no one changes a price.
	const allowRateChange = computed(() => !!Number(posProfile.value?.allow_rate_change));
	// Its Allow Discount Change rules line discounts the same way.
	const allowDiscountChange = computed(() => !!Number(posProfile.value?.allow_discount_change));

	const fetchCoupon = computed(() => !!posProfile.value?.auto_fetch_coupons_gifts);

	const showTemplateItems = computed(() => !!posProfile.value?.show_template_items);

	const hideVariantsItems = computed(() => !!posProfile.value?.hide_variants_items);

	const autoSetBatch = computed(() => !!posProfile.value?.auto_set_batch);

	const enableReturnValidity = computed(() => !!posProfile.value?.enable_return_validity);

	const returnValidityDays = computed(() => Number(posProfile.value?.return_validity_days) || 0);

	const useCustomerCredit = computed(() => !!posProfile.value?.use_customer_credit);

	const applyCustomerDiscount = computed(() => !!posProfile.value?.apply_customer_discount);

	const enableCashierSettlement = computed(() => !!posProfile.value?.enable_cashier_settlement);

	const allowOpenTabRecall = computed(
		() => !!posProfile.value?.allow_open_tab_recall && hasPermission("recall_other_shift_tabs"),
	);

	const allowOutstandingSettlement = computed(
		() => !!posProfile.value?.allow_outstanding_settlement && hasPermission("settle_outstanding_invoice"),
	);

	const printBackupReceipt = computed(() => !!posProfile.value?.print_backup_receipt);

	const cashModeOfPayment = computed(() => posProfile.value?.cash_mode_of_payment || "Cash");

	const purchaseTaxes = computed(() => posProfile.value?.purchase_taxes || []);

	function clearShiftState(): void {
		posOpeningShift.value = null;
		posProfile.value = null;
		company.value = null;
		stockSettings.value = {};
		taxes.value = [];
		taxInclusiveMode.value = false;
		disableRoundedTotal.value = false;
		printSettings.value = null;
		isReady.value = false;
		isCashier.value = true;
		printFormats.value = [];
		lastInvoiceName.value = "";
	}

	function applyShiftState(result: ShiftCheckResult): void {
		posOpeningShift.value = result.pos_opening_shift;
		posProfile.value = result.pos_profile;
		company.value = result.company;
		stockSettings.value = result.stock_settings || {};
		taxes.value = result.taxes || [];
		taxInclusiveMode.value = !!result.tax_inclusive;
		disableRoundedTotal.value = !!result.disable_rounded_total;
		printSettings.value = result.print_settings || null;
		isCashier.value = result.is_cashier ?? true;
		showOpeningDialog.value = false;
		isReady.value = true;
	}

	async function checkExistingShift(): Promise<void> {
		isLoading.value = true;
		showOpeningDialog.value = false;
		try {
			if (isElectron()) {
				const { useAuthStore } = await import("@/stores/authStore");
				const authStore = useAuthStore();
				const currentUser = authStore.userName;
				// At start the till may ask before it has signed its last cashier back in:
				// as "Guest" it found no shift and offered a new one. Decide nothing until
				// the cashier is known; App.vue asks again then (release sweep, 22 Sep 2026).
				if (!currentUser || currentUser === "Guest") return;

				const result = (await window.electronAPI!.db.checkOpenShift(
					currentUser,
				)) as ShiftCheckResult | null;

				if (result) {
					applyShiftState(result);
					refreshReceiptContext(result.pos_profile?.name || "");

					import("@/stores/settingsStore").then(({ useSettingsStore }) => {
						const settingsStore = useSettingsStore();
						settingsStore.fetchSettings().catch((error) => {
							console.warn("[XPOS] Failed to fetch ERP settings:", error);
						});
					});
				} else {
					clearShiftState();
					showOpeningDialog.value = true;
				}
				return;
			}

			if (!isOnline()) {
				const cachedData = (await getCachedPOSData()) as ShiftCheckResult | null;

				if (cachedData) {
					applyShiftState(cachedData);

					import("@/stores/settingsStore").then(({ useSettingsStore }) => {
						const settingsStore = useSettingsStore();
						settingsStore.fetchSettings().catch((error) => {
							console.warn("[XPOS] Failed to load cached ERP settings:", error);
						});
					});
					return;
				} else {
					console.warn("[XPOS Offline] No cached POS data available");
					clearShiftState();
					showOpeningDialog.value = true;
					return;
				}
			}

			const result = await call<ShiftCheckResult | null>("xpos.api.shifts.check_open_shift");

			if (result && result.pos_opening_shift) {
				applyShiftState(result);

				fetchPrintFormats();

				import("@/stores/settingsStore").then(({ useSettingsStore }) => {
					const settingsStore = useSettingsStore();
					settingsStore.fetchSettings().catch((error) => {
						console.warn("[XPOS] Failed to fetch ERP settings:", error);
					});
				});

				if (result.pos_profile?.use_offline_mode) {
					refreshReceiptContext(result.pos_profile.name);
					try {
						await cachePOSData(result);

						import("@/stores/itemStore").then(async ({ useItemStore }) => {
							const itemStore = useItemStore();
							itemStore.cacheAllItems(result.pos_profile.name).catch((error) => {
								console.warn("[XPOS] Failed to initialize offline item cache:", error);
							});
						});

						import("@/stores/customerStore").then(async ({ useCustomerStore }) => {
							const customerStore = useCustomerStore();
							customerStore.cacheAllCustomers(result.pos_profile.name).catch((error) => {
								console.warn("[XPOS] Failed to initialize offline customer cache:", error);
							});
						});
					} catch (error) {
						console.warn("[XPOS] Failed to cache POS data:", error);
					}
				}
			} else {
				clearShiftState();
				showOpeningDialog.value = true;
			}
		} catch (error) {
			console.error("Error checking shift:", error);

			try {
				const cachedData = (await getCachedPOSData()) as ShiftCheckResult | null;
				if (cachedData && cachedData.pos_profile?.use_offline_mode) {
					applyShiftState(cachedData);
					return;
				}
			} catch {
				console.warn("[XPOS Offline] Failed to load cached POS data");
			}

			clearShiftState();
			showOpeningDialog.value = true;
		} finally {
			isLoading.value = false;
		}
	}

	async function fetchOpeningData(): Promise<OpeningData | undefined> {
		try {
			if (isElectron()) {
				const { useAuthStore } = await import("@/stores/authStore");
				// Only the profiles the signed-in user is on, as the web POS asks ERPNext.
				const data = (await window.electronAPI!.db.getOpeningData(
					useAuthStore().userName,
				)) as unknown as OpeningData;
				openingData.value = data;
				return data;
			}

			const data = await call<OpeningData>("xpos.api.shifts.get_opening_data");
			openingData.value = data;
			return data;
		} catch (error) {
			console.error("Error fetching opening data:", error);
			throw error;
		}
	}

	interface OpenShiftResult extends ShiftCheckResult {}

	async function openShift(
		profileName: string,
		companyName: string,
		balanceDetails: Record<string, unknown>[],
	): Promise<OpenShiftResult> {
		try {
			if (isElectron()) {
				const { useAuthStore } = await import("@/stores/authStore");
				const authStore = useAuthStore();
				await window.electronAPI!.db.createPosOpeningShift({
					pos_profile: profileName,
					company: companyName,
					user: authStore.userName,
					// The server's time zone, not UTC: a UTC date is the previous day after midnight east of UTC.
					opening_date: nowDate(),
					period_start_date: nowDatetime(),
					opening_amounts: balanceDetails,
				});
				const result = (await window.electronAPI!.db.checkOpenShift(
					authStore.userName,
				)) as unknown as OpenShiftResult;
				posOpeningShift.value = result.pos_opening_shift;
				posProfile.value = result.pos_profile;
				company.value = result.company;
				stockSettings.value = result.stock_settings || {};
				taxes.value = result.taxes || [];
				taxInclusiveMode.value = !!result.tax_inclusive;
				disableRoundedTotal.value = !!result.disable_rounded_total;
				printSettings.value = result.print_settings || null;
				showOpeningDialog.value = false;
				isReady.value = true;
				// As on the web: without it the shift's receipts wait for the next restart.
				refreshReceiptContext(profileName);
				return result;
			}

			const result = await call<OpenShiftResult>("xpos.api.shifts.open_shift", {
				pos_profile: profileName,
				company: companyName,
				balance_details: JSON.stringify(balanceDetails),
			});
			posOpeningShift.value = result.pos_opening_shift;
			posProfile.value = result.pos_profile;
			company.value = result.company;
			stockSettings.value = result.stock_settings || {};

			taxes.value = result.taxes || [];
			taxInclusiveMode.value = !!result.tax_inclusive;

			disableRoundedTotal.value = !!result.disable_rounded_total;

			printSettings.value = result.print_settings || null;
			showOpeningDialog.value = false;
			isReady.value = true;

			fetchPrintFormats();
			refreshReceiptContext(profileName);

			import("@/stores/settingsStore").then(({ useSettingsStore }) => {
				const settingsStore = useSettingsStore();
				settingsStore.fetchSettings().catch((error) => {
					console.warn("[XPOS] Failed to fetch ERP settings:", error);
				});
			});

			if (result.pos_profile?.use_offline_mode) {
				try {
					await cachePOSData(result);

					import("@/stores/itemStore").then(({ useItemStore }) => {
						const itemStore = useItemStore();
						itemStore.cacheAllItems(profileName).catch((error) => {
							console.warn("[XPOS] Failed to initialize offline item cache:", error);
						});
					});

					import("@/stores/customerStore").then(({ useCustomerStore }) => {
						const customerStore = useCustomerStore();
						customerStore.cacheAllCustomers(profileName).catch((error) => {
							console.warn("[XPOS] Failed to initialize offline customer cache:", error);
						});
					});
				} catch (error) {
					console.warn("[XPOS] Failed to cache POS data:", error);
				}
			}
			return result;
		} catch (error) {
			console.error("Error opening shift:", error);
			throw error;
		}
	}

	async function fetchClosingData(): Promise<ShiftSummary | undefined> {
		if (!posOpeningShift.value?.name) return;
		try {
			// The till's shift is its own until it syncs: it is summed from the till's records.
			const data = isElectron()
				? ((await getShiftClosingSummary(String(posOpeningShift.value.name))) as ShiftSummary)
				: await call<ShiftSummary>("xpos.api.shifts.get_shift_summary", {
						opening_shift: posOpeningShift.value.name,
					});
			closingData.value = data;
			return data;
		} catch (error) {
			console.error("Error fetching closing data:", error);
			throw error;
		}
	}

	/**
	 * Close the shift on the till, online or not: the counted amounts are kept with the
	 * shift, and sync sends the close once ERPNext has the shift's sales and cash movements.
	 */
	async function closeShiftOnTill(
		closingDetails: Record<string, unknown>[],
		approvedBy?: string,
	): Promise<{ name: string }> {
		const shift = posOpeningShift.value!;
		const today = nowDate();
		const { id } = (await createPosClosingEntry({
			// K19: the manager who approved closing it, when the cashier's role does not allow it.
			approved_by: approvedBy,
			pos_opening_entry_id: Number(shift.name),
			pos_profile: shift.pos_profile,
			user: shift.user,
			company: shift.company,
			posting_date: today,
			period_end_date: today,
			payment_details: closingDetails.map((detail) => ({
				mode_of_payment: detail.mode_of_payment,
				opening_amount: detail.opening_amount,
				expected_amount: detail.expected_amount,
				closing_amount: detail.closing_amount,
				difference: detail.difference,
			})),
		})) as { id: number };
		await closePosShift(String(shift.name));
		window.electronAPI?.triggerSync?.().catch(() => {});
		return { name: `LOCAL-CLOSE-${id}` };
	}

	async function closeShift(
		closingDetails: Record<string, unknown>[],
		approvedBy?: string,
	): Promise<unknown> {
		if (!posOpeningShift.value?.name) return;
		try {
			const result = isElectron()
				? await closeShiftOnTill(closingDetails, approvedBy)
				: await call("xpos.api.shifts.close_shift", {
						opening_shift: posOpeningShift.value.name,
						closing_details: JSON.stringify(closingDetails),
					});

			posOpeningShift.value = null;
			posProfile.value = null;
			company.value = null;
			stockSettings.value = {};
			taxes.value = [];
			taxInclusiveMode.value = false;
			disableRoundedTotal.value = false;
			printSettings.value = null;
			isReady.value = false;
			// The closing dialog stays open on its closed step, to print the summary; its Done
			// button closes it. Closing it here skipped that step.
			showOpeningDialog.value = true;
			printFormats.value = [];
			lastInvoiceName.value = "";

			import("@/stores/settingsStore").then(({ useSettingsStore }) => {
				const settingsStore = useSettingsStore();
				settingsStore.reset();
			});

			return result;
		} catch (error) {
			console.error("Error closing shift:", error);
			throw error;
		}
	}

	async function fetchPrintFormats(): Promise<void> {
		try {
			const result = await call<PrintFormat[]>("xpos.api.print_formats.get_print_formats");
			printFormats.value = result || [];
		} catch (error) {
			console.error("Error fetching print formats:", error);
		}
	}

	/** Cache the receipt layout so a sale made offline can still be printed. */
	async function refreshReceiptContext(profileName: string): Promise<void> {
		if (!isOnline() || !profileName) return;
		if (!isElectron() && !useOfflineMode.value) return;
		try {
			const ctx = await call<ReceiptContext>("xpos.api.print_formats.get_receipt_context", {
				pos_profile: profileName,
				print_format: defaultPrintFormat.value,
			});
			await cacheReceiptContext(profileName, ctx);
		} catch (error) {
			console.warn("[XPOS] Failed to cache receipt context:", error);
		}
	}

	return {
		isLoading,
		refreshReceiptContext,
		isReady,
		isCashier,
		currentView,
		posOpeningShift,
		posProfile,
		company,
		stockSettings,
		taxes,
		taxInclusiveMode,
		disableRoundedTotal,
		printSettings,
		showOpeningDialog,
		openingData,
		showClosingDialog,
		closingData,
		printFormats,
		lastInvoiceName,
		invoiceType,
		defaultPrintFormat,
		isShiftOpen,
		profileName,
		warehouse,
		currency,
		currencySymbol,
		invoiceCurrency,
		paymentMethods,
		foreignTenderModes,
		cashTenderModes,
		allowMixedCurrencyTender,
		tenderModeFor,
		tenderRateFor,
		tenderCurrencyFor,
		companyName,
		sellingPriceList,
		defaultCustomer,
		allowChangePostingDate,
		allowPartialPayment,
		allowCreditSale,
		allowReturn,
		allowReturnWithoutInvoice,
		allowSalesOrder,
		allowDeleteOfflineInvoice,
		displayAdditionalNotes,
		allowedSalesPersons,
		salesPersonEnabled,
		allowWriteOffChange,
		displayItemCode,
		allowZeroRatedItems,
		maxDiscountAllowed,
		inputQty,
		taxInclusive,
		hideClosingShift,
		hideExpectedAmount,
		enableCashMovement,
		allowPosExpense,
		allowCashDeposit,
		askForScreens,
		syncStatusDetail,
		allowPurchasing,
		showLoyalty,
		allowRateChange,
		allowDiscountChange,
		fetchCoupon,
		showTemplateItems,
		hideVariantsItems,
		autoSetBatch,
		enableReturnValidity,
		returnValidityDays,
		useCustomerCredit,
		applyCustomerDiscount,
		enableCashierSettlement,
		allowOpenTabRecall,
		allowOutstandingSettlement,
		printBackupReceipt,
		cashModeOfPayment,
		purchaseTaxes,
		hideImages,
		hideUnavailableItems,
		blockSaleBeyondAvailableQty,
		defaultView,
		defaultPosExpenseAccount,
		backOfficeCashAccount,
		useOfflineMode,
		requireCashMovementRemarks,
		checkExistingShift,
		fetchOpeningData,
		openShift,
		fetchClosingData,
		closeShift,
		fetchPrintFormats,
	};
});
