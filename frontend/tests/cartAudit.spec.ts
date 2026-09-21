/**
 * @vitest-environment jsdom
 *
 * K20: taking something out of the customer's sale goes in the till's audit log, with
 * the manager who approved it: a deleted line, a lowered quantity, a cleared sale. A
 * lowered quantity that keeps the line needs no approval, so it is logged without one.
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
const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock("@/services/auditLog", () => audit);

import { useCartStore } from "@/stores/cartStore";
import type { CartItem } from "@/types/pos.types";

const MANAGER = "manager@example.com";

const line = (code: string, qty = 2, extra: Partial<CartItem> = {}): CartItem =>
	({
		item_code: code,
		item_name: `Item ${code}`,
		qty,
		rate: 10,
		uom: "Nos",
		discount_percentage: 0,
		discount_amount: 0,
		...extra,
	}) as CartItem;

function cartWith(...lines: CartItem[]) {
	const cart = useCartStore();
	for (const l of lines) cart.items.push(l);
	return cart;
}

beforeEach(() => {
	setActivePinia(createPinia());
	perms.value = {};
	approval.requestApproval.mockReset();
	approval.requestApproval.mockResolvedValue(null);
	audit.recordAudit.mockReset();
	window.electronAPI = { approval: {}, audit: {} } as never;
});

describe("K20: removals from a sale go in the audit log", () => {
	it("a deleted line, with what it was worth", async () => {
		perms.value.remove_cart_items = true;
		const cart = cartWith(line("A", 3));

		await cart.requestRemoveItem(0);

		expect(audit.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				event_type: "line_removed",
				item_code: "A",
				item_name: "Item A",
				qty: 3,
				amount: 30,
				approved_by: null,
			}),
		);
	});

	it("names the manager who approved it", async () => {
		approval.requestApproval.mockResolvedValue(MANAGER);
		const cart = cartWith(line("A"));

		await cart.requestRemoveItem(0);

		expect(audit.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({ event_type: "line_removed", approved_by: MANAGER }),
		);
	});

	it("nothing is logged when the removal is not approved", async () => {
		const cart = cartWith(line("A"));

		await cart.requestRemoveItem(0);

		expect(cart.items).toHaveLength(1);
		expect(audit.recordAudit).not.toHaveBeenCalled();
	});

	it("a lowered quantity logs what was taken off, with no approver", async () => {
		const cart = cartWith(line("A", 5));

		await cart.requestItemQty(0, 2);

		expect(approval.requestApproval).not.toHaveBeenCalled();
		expect(audit.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				event_type: "qty_lowered",
				item_code: "A",
				qty: 3,
				amount: 30,
				approved_by: null,
			}),
		);
	});

	it("a quantity lowered to nothing is a deleted line", async () => {
		perms.value.remove_cart_items = true;
		const cart = cartWith(line("A", 1));

		const result = await cart.requestItemQty(0, 0);

		expect(result.success).toBe(true);
		expect(cart.items).toHaveLength(0);
		expect(audit.recordAudit).toHaveBeenCalledTimes(1);
		expect(audit.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({ event_type: "line_removed", item_code: "A", qty: 1, amount: 10 }),
		);
	});

	it("a raised quantity is not logged", async () => {
		const cart = cartWith(line("A", 1));

		await cart.requestItemQty(0, 4);

		expect(audit.recordAudit).not.toHaveBeenCalled();
	});

	it("a cleared sale logs every line and the total", async () => {
		perms.value.remove_cart_items = true;
		const cart = cartWith(line("A", 1), line("B", 2));

		await cart.requestClearCart();

		expect(audit.recordAudit).toHaveBeenCalledTimes(1);
		const event = audit.recordAudit.mock.calls[0][0];
		expect(event).toMatchObject({ event_type: "sale_cleared", qty: 3, amount: 30 });
		expect(event.details.lines).toEqual([
			{ item_code: "A", qty: 1, rate: 10 },
			{ item_code: "B", qty: 2, rate: 10 },
		]);
	});

	it("clearing an empty sale is not logged", async () => {
		const cart = useCartStore();

		await cart.requestClearCart();

		expect(audit.recordAudit).not.toHaveBeenCalled();
	});

	it("a free item the offer added is not logged", async () => {
		const cart = cartWith(line("FREE", 1, { pos_is_free_item: true } as Partial<CartItem>));

		await cart.requestRemoveItem(0);

		expect(audit.recordAudit).not.toHaveBeenCalled();
	});

	it("removals in a return are not logged: they only lower a refund", async () => {
		const cart = cartWith(line("A", -1));
		cart.isReturnMode = true;

		await cart.requestRemoveItem(0);

		expect(cart.items).toHaveLength(0);
		expect(audit.recordAudit).not.toHaveBeenCalled();
	});
});
