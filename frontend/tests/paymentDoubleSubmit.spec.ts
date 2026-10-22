/**
 * @vitest-environment jsdom
 *
 * K56: a double click on Save & Print made two sales. `submitPayment` checked that no save
 * was under way, then waited for the stock check (Block Sale Beyond Available Qty asks for
 * each line's stock) before saying one was: a second click in that wait passed the check
 * too, and each saved the cart, with its own number. One payment saves one sale, however
 * often, and however, it is asked for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";

const addPendingInvoice = vi.hoisted(() => vi.fn());
const printInvoiceLocal = vi.hoisted(() => vi.fn());
const call = vi.hoisted(() => vi.fn());

const item = {
	item_code: "ITEM-1",
	item_name: "Item 1",
	qty: 1,
	rate: 100,
	amount: 100,
	is_stock_item: 1,
	uom: "Nos",
	stock_uom: "Nos",
	conversion_factor: 1,
	discount_percentage: 0,
	discount_amount: 0,
};

/** The stock check waits on one gate, opened by the test: every save asked meanwhile waits on it. */
let releaseStock: () => void = () => {};
let stockGate = Promise.resolve();
function closeStockGate() {
	stockGate = new Promise<void>((resolve) => {
		releaseStock = resolve;
	});
}

const cart = reactive({
	items: [item],
	isEmpty: false,
	isReturnMode: false,
	grandTotal: 100,
	roundedTotal: 100,
	netTotal: 100,
	totalTaxes: 0,
	customer: { name: "Walk-in" },
	customerName: "Walk-in",
	postingDate: "",
	showPaymentDialog: true,
	redeemLoyaltyPoints: false,
	revalidateStock: vi.fn(async () => {
		await stockGate;
		return { valid: true, messages: [] as string[] };
	}),
	appliedCoupon: null,
	calculatedTaxes: [],
	subtotal: 100,
	writeOffAmount: 0,
	loyaltyAmount: 0,
	loyaltyPoints: 0,
	offerGrandTotalDiscountPct: 0,
	offerItemDiscountTotal: 0,
	returnAgainst: "",
	getReceiptSnapshot: vi.fn(() => ({})),
	getInvoiceData: vi.fn(() => ({ items: [item], payments: [] })),
	clearLoyalty: vi.fn(),
	setLoyalty: vi.fn(),
	setPayments: vi.fn(),
	setChangeAmount: vi.fn(),
	setChangeLegs: vi.fn(),
	closePaymentDialog: vi.fn(),
	openDraftDialog: vi.fn(),
	clearAll: vi.fn(() => {
		cart.items = [];
		cart.isEmpty = true;
	}),
});

const pos = reactive({
	posOpeningShift: { name: "1" },
	paymentMethods: [{ mode_of_payment: "Cash", type: "Cash", default: 1 }],
	invoiceCurrency: "USD",
	currency: "USD",
	profileName: "Shop 1",
	company: "Test Co",
	allowCreditSale: false,
	allowPartialPayment: false,
	allowChangePostingDate: false,
	blockSaleBeyondAvailableQty: true,
	stockSettings: {},
	lastInvoiceName: "",
	companyName: "Test Co",
	allowMixedCurrencyTender: false,
	allowWriteOffChange: false,
	cashModeOfPayment: "Cash",
	cashTenderModes: ["Cash"],
	tenderCurrencyFor: () => "USD",
	tenderModeFor: () => "Cash",
	tenderRateFor: () => 1,
});

vi.mock("@/stores/cartStore", () => ({ useCartStore: () => cart }));
vi.mock("@/stores/posStore", () => ({ usePosStore: () => pos }));
vi.mock("@/stores/authStore", () => ({
	useAuthStore: () => ({ userName: "ann@example.com", userFullName: "Ann" }),
}));
vi.mock("@/stores/paymentStore", () => ({
	usePaymentStore: () => ({ fetchAvailableCredit: vi.fn(async () => 0) }),
}));
vi.mock("@/services/api", () => ({
	call,
	showSuccess: vi.fn(),
	showError: vi.fn(),
	showInfo: vi.fn(),
	isNetworkError: () => false,
}));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));
vi.mock("@/services/dbBridge", () => ({ addPendingInvoice }));
vi.mock("@/composables/usePrintInvoice", () => ({
	usePrintInvoice: () => ({ printInvoice: vi.fn(), printInvoiceLocal }),
}));
vi.mock("@/composables/useOfflineSale", () => ({ useOfflineSale: () => ({ completeOfflineSale: vi.fn() }) }));
vi.mock("@/components/help/HelpLink.vue", () => ({ default: { template: "<span />" } }));

import PaymentDialog from "@/components/dialogs/PaymentDialog.vue";

async function open() {
	const wrapper = mount(PaymentDialog, { attachTo: document.body });
	await flushPromises();
	return wrapper;
}

const buttonNamed = (name: string) =>
	[...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!;

beforeEach(() => {
	document.body.innerHTML = "";
	globalThis.__ = ((text: string) => text) as never;
	window.electronAPI = { db: {}, print: {} } as never;
	addPendingInvoice.mockReset();
	addPendingInvoice.mockResolvedValue({ id: 7, local_id: "inv_7" });
	printInvoiceLocal.mockReset();
	call.mockReset();
	call.mockResolvedValue(undefined);
	cart.items = [item];
	cart.isEmpty = false;
	cart.revalidateStock.mockClear();
	closeStockGate();
});

describe("K56: one payment saves one sale", () => {
	it("K56: a double click on Save & Print saves the sale once", async () => {
		const wrapper = await open();
		const save = buttonNamed("Save & Print");
		save.click();
		save.click();
		releaseStock();
		await flushPromises();
		expect(addPendingInvoice).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("K56: Save Only then Save & Print, before the first is saved, saves it once", async () => {
		const wrapper = await open();
		buttonNamed("Save Only").click();
		buttonNamed("Save & Print").click();
		releaseStock();
		await flushPromises();
		expect(addPendingInvoice).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("K56: Enter pressed twice saves the sale once", async () => {
		const wrapper = await open();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		releaseStock();
		await flushPromises();
		expect(addPendingInvoice).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("K56: a dialog closed before the customer's details came back leaves no Enter behind", async () => {
		// Its Enter listener was added after that lookup: closed first, the listener was never
		// removed, and on the next sale it saved the cart a second time.
		let answer: (v: unknown) => void = () => {};
		call.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
		const first = await open();
		first.unmount();
		answer({});
		await flushPromises();
		document.body.innerHTML = "";

		const second = await open();
		releaseStock();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await flushPromises();
		expect(addPendingInvoice).toHaveBeenCalledTimes(1);
		second.unmount();
	});

	it("K56: a sale the stock check refuses can be saved again once fixed", async () => {
		cart.revalidateStock.mockResolvedValueOnce({ valid: false, messages: ["Not enough stock"] });
		const wrapper = await open();
		buttonNamed("Save & Print").click();
		await flushPromises();
		expect(addPendingInvoice).not.toHaveBeenCalled();
		buttonNamed("Save & Print").click();
		releaseStock();
		await flushPromises();
		expect(addPendingInvoice).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});
});
