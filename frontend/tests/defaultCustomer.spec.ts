/**
 * @vitest-environment jsdom
 *
 * The POS Profile's default customer goes on the cart from the till's own records, so a
 * desktop till (whose server calls are not the web's) and an offline one can sell at once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const onTill = { electron: true };
const cached = new Map<string, Record<string, unknown>>();

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => onTill.electron }));
vi.mock("@/services/dbBridge", () => ({
	getCachedItemByCode: vi.fn(async () => null),
	getCachedStockForItem: vi.fn(async () => null),
	getPendingInvoices: vi.fn(async () => []),
	deletePendingInvoice: vi.fn(),
	getCustomer: vi.fn(async (name: string) => cached.get(name) ?? null),
}));
vi.mock("@/stores/posStore", () => ({
	usePosStore: vi.fn(() => ({
		taxes: [],
		posOpeningShift: { name: "3" },
		profileName: "POS-PROFILE-1",
		defaultCustomer: "Shop Customer",
		currency: "USD",
		disableRoundedTotal: true,
		allowChangePostingDate: false,
		stockSettings: { allow_negative_stock: true },
	})),
}));
vi.mock("@/services/pricingService", () => ({
	resolveCartPricing: vi.fn(async () => ({ updates: [], free_lines: [], invoice_updates: {} })),
	refreshPricingRuleSnapshot: vi.fn(async () => []),
}));

import { call } from "@/services/api";
import { useCartStore } from "@/stores/cartStore";

describe("the default customer", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		cached.clear();
		onTill.electron = true;
		vi.mocked(call).mockReset();
	});

	it("comes from the till's own records, without asking the server", async () => {
		cached.set("Shop Customer", { name: "Shop Customer", customer_name: "The Shop's Customer" });
		const cart = useCartStore();
		await cart.applyDefaultCustomer();
		expect(cart.customer?.customer_name).toBe("The Shop's Customer");
		expect(call).not.toHaveBeenCalled();
	});

	it("is sold to by name on a till that has not synced it yet", async () => {
		const cart = useCartStore();
		await cart.applyDefaultCustomer();
		expect(cart.customer).toEqual({ name: "Shop Customer", customer_name: "Shop Customer" });
		expect(call).not.toHaveBeenCalled();
	});

	it("is fetched from the server on the web when it is not cached", async () => {
		onTill.electron = false;
		vi.mocked(call).mockResolvedValue({ name: "Shop Customer", customer_name: "From Server" });
		const cart = useCartStore();
		await cart.applyDefaultCustomer();
		expect(cart.customer?.customer_name).toBe("From Server");
	});

	it("falls back to the name on the web when the server cannot be reached", async () => {
		onTill.electron = false;
		vi.mocked(call).mockRejectedValue(new Error("__offline__"));
		const cart = useCartStore();
		await cart.applyDefaultCustomer();
		expect(cart.customer?.name).toBe("Shop Customer");
	});

	it("leaves a customer the cashier chose", async () => {
		const cart = useCartStore();
		cart.setCustomer({ name: "Chosen", customer_name: "Chosen" });
		await cart.applyDefaultCustomer();
		expect(cart.customer?.name).toBe("Chosen");
	});
});
