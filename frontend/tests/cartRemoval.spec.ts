/**
 * @vitest-environment jsdom
 *
 * K19: taking something out of the customer's sale needs Remove Items From the Cart, or a
 * manager's PIN on the till: deleting a line (or lowering it to 0), clearing the sale.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
const perms = vi.hoisted(() => ({ value: {} as Record<string, boolean> }));
vi.mock("@/services/userRights", () => ({
	hasPermission: (k: string) => perms.value[k] ?? false,
	getDiscountLimit: () => 0,
}));
vi.mock("@/stores/posStore", () => ({
	usePosStore: vi.fn(() => ({
		taxes: [],
		taxInclusiveMode: false,
		profile: { name: "Shop POS", warehouse: "Stores", currency: "USD" },
		posProfile: { name: "Shop POS", max_discount_percentage_allowed: 100 },
		currency: "USD",
		tenderModeFor: vi.fn(() => undefined),
	})),
}));
const approval = vi.hoisted(() => ({ requestApproval: vi.fn() }));
vi.mock("@/stores/approvalStore", () => ({ useApprovalStore: () => approval }));

import { useCartStore } from "@/stores/cartStore";
import type { CartItem } from "@/types/pos.types";

const line = (code: string, qty = 2): CartItem =>
	({
		item_code: code,
		item_name: code,
		qty,
		rate: 10,
		uom: "Nos",
		discount_percentage: 0,
		discount_amount: 0,
	}) as CartItem;

function cartWith(...codes: string[]) {
	const cart = useCartStore();
	for (const c of codes) cart.items.push(line(c));
	return cart;
}

beforeEach(() => {
	setActivePinia(createPinia());
	perms.value = {};
	approval.requestApproval.mockReset();
	approval.requestApproval.mockResolvedValue(null);
	window.electronAPI = { approval: {} } as never;
});

describe("K19: removing items from the sale", () => {
	it("a cashier with the permission removes a line without asking", async () => {
		perms.value.remove_cart_items = true;
		const cart = cartWith("A", "B");

		await cart.requestRemoveItem(0);

		expect(approval.requestApproval).not.toHaveBeenCalled();
		expect(cart.items.map((i) => i.item_code)).toEqual(["B"]);
	});

	it("otherwise a line is removed only once a manager approves", async () => {
		const cart = cartWith("A", "B");

		await cart.requestRemoveItem(0);
		expect(approval.requestApproval).toHaveBeenCalledWith(
			{ permission: "remove_cart_items" },
			expect.stringContaining("A"),
		);
		expect(cart.items).toHaveLength(2);

		approval.requestApproval.mockResolvedValue("manager@example.com");
		await cart.requestRemoveItem(0);
		expect(cart.items.map((i) => i.item_code)).toEqual(["B"]);
	});

	it("lowering a quantity that keeps the line needs no one", async () => {
		const cart = cartWith("A");

		await cart.requestItemQty(0, 1);

		expect(approval.requestApproval).not.toHaveBeenCalled();
		expect(cart.items[0].qty).toBe(1);
	});

	it("lowering a quantity to 0 removes the line, so it needs a manager", async () => {
		const cart = cartWith("A");

		await cart.requestItemQty(0, 0);
		expect(approval.requestApproval).toHaveBeenCalledTimes(1);
		expect(cart.items).toHaveLength(1);

		approval.requestApproval.mockResolvedValue("manager@example.com");
		await cart.requestItemQty(0, 0);
		expect(cart.items).toHaveLength(0);
	});

	it("raising a quantity needs no one", async () => {
		const cart = cartWith("A");

		await cart.requestItemQty(0, 3);

		expect(approval.requestApproval).not.toHaveBeenCalled();
		expect(cart.items[0].qty).toBe(3);
	});

	it("clearing the sale needs the permission or a manager", async () => {
		const cart = cartWith("A", "B");

		expect(await cart.requestClearCart()).toBe(false);
		expect(cart.items).toHaveLength(2);

		approval.requestApproval.mockResolvedValue("manager@example.com");
		expect(await cart.requestClearCart()).toBe(true);
		expect(cart.items).toHaveLength(0);
	});

	it("an empty sale clears without asking", async () => {
		expect(await useCartStore().requestClearCart()).toBe(true);
		expect(approval.requestApproval).not.toHaveBeenCalled();
	});

	it("a return is not a sale: taking lines out of it needs no one", async () => {
		const cart = cartWith("A", "B");
		cart.isReturnMode = true;

		await cart.requestRemoveItem(0);

		expect(approval.requestApproval).not.toHaveBeenCalled();
		expect(cart.items).toHaveLength(1);
	});

	it("the web POS is left as it was: no PIN can be checked there", async () => {
		window.electronAPI = undefined as never;
		const cart = cartWith("A", "B");

		await cart.requestRemoveItem(0);

		expect(approval.requestApproval).not.toHaveBeenCalled();
		expect(cart.items).toHaveLength(1);
	});
});
