/**
 * @vitest-environment jsdom
 *
 * K19: before taking payment the desktop till checks the sale against the cashier's
 * rights. Anything beyond them needs a manager's PIN, once for the sale; the approver
 * goes with the invoice, and the server checks the approval again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));

const rights = vi.hoisted(() => ({
	perms: {} as Record<string, boolean>,
	limit: 10,
}));
vi.mock("@/services/userRights", () => ({
	hasPermission: (key: string) => rights.perms[key] ?? false,
	getDiscountLimit: () => rights.limit,
	loadPermissions: vi.fn(),
	resetPermissions: vi.fn(),
}));

vi.mock("@/stores/posStore", () => ({
	usePosStore: vi.fn(() => ({
		taxes: [],
		taxInclusiveMode: false,
		profile: { name: "Shop POS", warehouse: "Stores", currency: "USD" },
		posProfile: { name: "Shop POS", max_discount_percentage_allowed: 100 },
		currency: "USD",
		allowChangePostingDate: false,
		tenderModeFor: vi.fn(() => undefined),
	})),
}));

const approval = vi.hoisted(() => ({ requestApproval: vi.fn() }));
vi.mock("@/stores/approvalStore", () => ({ useApprovalStore: () => approval }));

import { useCartStore } from "@/stores/cartStore";
import type { CartItem } from "@/types/pos.types";

function item(overrides: Partial<CartItem> = {}): CartItem {
	return {
		item_code: "ITEM-A",
		item_name: "Item A",
		qty: 1,
		rate: 100,
		uom: "Nos",
		discount_percentage: 0,
		discount_amount: 0,
		...overrides,
	} as CartItem;
}

beforeEach(() => {
	setActivePinia(createPinia());
	approval.requestApproval.mockReset();
	rights.perms = { show_edit_discount_field: true, apply_additional_discount: true };
	rights.limit = 10;
	window.electronAPI = { approval: {} } as never;
});

describe("K19: a manager approves the sale before payment", () => {
	it("takes payment straight away for a sale within the cashier's rights", async () => {
		const cart = useCartStore();
		cart.items.push(item({ discount_percentage: 10 }));

		await cart.openPaymentDialog();

		expect(approval.requestApproval).not.toHaveBeenCalled();
		expect(cart.showPaymentDialog).toBe(true);
		expect(cart.getInvoiceData("Shop POS", "SHIFT-1").xpos_approved_by).toBeUndefined();
	});

	it("asks a manager for a discount over the cashier's limit, and records who approved", async () => {
		approval.requestApproval.mockResolvedValue("manager@example.com");
		const cart = useCartStore();
		cart.items.push(item({ discount_percentage: 25 }));

		await cart.openPaymentDialog();

		expect(approval.requestApproval).toHaveBeenCalledWith(
			{ permissions: [], discountPct: 25 },
			expect.stringContaining("25% off"),
		);
		expect(cart.showPaymentDialog).toBe(true);
		expect(cart.getInvoiceData("Shop POS", "SHIFT-1").xpos_approved_by).toBe("manager@example.com");
	});

	it("does not take payment when the approval is cancelled", async () => {
		approval.requestApproval.mockResolvedValue(null);
		const cart = useCartStore();
		cart.items.push(item({ discount_percentage: 25 }));

		await cart.openPaymentDialog();

		expect(cart.showPaymentDialog).toBe(false);
		expect(cart.getInvoiceData("Shop POS", "SHIFT-1").xpos_approved_by).toBeUndefined();
	});

	it("asks for the permissions the cashier lacks, such as a price change", async () => {
		approval.requestApproval.mockResolvedValue("manager@example.com");
		const cart = useCartStore();
		cart.items.push(item());
		cart.updateItemRate(0, 90);

		await cart.openPaymentDialog();

		expect(approval.requestApproval).toHaveBeenCalledWith(
			{ permissions: ["allow_change_price"], discountPct: 10 },
			expect.any(String),
		);
	});

	it("counts a price set below the list when the item is added as a discount", async () => {
		approval.requestApproval.mockResolvedValue("manager@example.com");
		rights.perms.allow_change_price = true;
		const cart = useCartStore();
		const posItem = { item_code: "ITEM-A", item_name: "Item A", rate: 100, uom: "Nos", stock_uom: "Nos" };
		cart.addItemWithDetails(posItem as never, 1, 70, "Nos", "", "", 1, 100);

		await cart.openPaymentDialog();

		expect(approval.requestApproval).toHaveBeenCalledWith(
			{ permissions: [], discountPct: 30 },
			expect.stringContaining("30% off"),
		);
	});

	it("does not ask again for what the approval already covers", async () => {
		approval.requestApproval.mockResolvedValue("manager@example.com");
		const cart = useCartStore();
		cart.items.push(item({ discount_percentage: 25 }));
		await cart.openPaymentDialog();
		cart.closePaymentDialog();

		cart.items[0].discount_percentage = 20;
		await cart.openPaymentDialog();

		expect(approval.requestApproval).toHaveBeenCalledTimes(1);
		expect(cart.showPaymentDialog).toBe(true);
	});

	it("asks again when the sale goes beyond what was approved", async () => {
		approval.requestApproval.mockResolvedValue("manager@example.com");
		const cart = useCartStore();
		cart.items.push(item({ discount_percentage: 25 }));
		await cart.openPaymentDialog();
		cart.closePaymentDialog();

		cart.items[0].discount_percentage = 40;
		await cart.openPaymentDialog();

		expect(approval.requestApproval).toHaveBeenCalledTimes(2);
		expect(approval.requestApproval).toHaveBeenLastCalledWith(
			{ permissions: [], discountPct: 40 },
			expect.any(String),
		);
	});

	it("forgets the approval with the sale", async () => {
		approval.requestApproval.mockResolvedValue("manager@example.com");
		const cart = useCartStore();
		cart.items.push(item({ discount_percentage: 25 }));
		await cart.openPaymentDialog();

		cart.clearCart();
		cart.items.push(item());

		expect(cart.getInvoiceData("Shop POS", "SHIFT-1").xpos_approved_by).toBeUndefined();
	});

	it("leaves the web POS to the server: no PIN can be checked there", async () => {
		window.electronAPI = undefined as never;
		const cart = useCartStore();
		cart.items.push(item({ discount_percentage: 25 }));

		await cart.openPaymentDialog();

		expect(approval.requestApproval).not.toHaveBeenCalled();
		expect(cart.showPaymentDialog).toBe(true);
	});
});
