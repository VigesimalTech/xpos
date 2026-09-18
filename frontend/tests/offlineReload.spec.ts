/**
 * @vitest-environment jsdom
 *
 * Reloading the web POS (or reopening the installed PWA) while offline. The
 * page itself comes from the service worker's cache; these cover what the app
 * does next: who is signed in, what was in the cart, and whether the browser
 * may throw the offline queue away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";

const callMock = vi.fn();
vi.mock("@/services/api", () => ({
	call: (...args: unknown[]) => callMock(...args),
	default: { call: (...args: unknown[]) => callMock(...args) },
}));

vi.mock("@/stores/posStore", () => ({
	usePosStore: vi.fn(() => ({
		taxes: [],
		taxInclusiveMode: false,
		profile: { name: "POS-PROFILE-1", warehouse: "Store - TC", currency: "USD" },
		currency: "USD",
		defaultCustomer: "Walk-in Customer",
		tenderModeFor: vi.fn(() => undefined),
	})),
}));

import { useAuthStore } from "@/stores/authStore";
import { useCartStore } from "@/stores/cartStore";
import { enableCartDraft } from "@/services/cartDraft";
import { requestPersistentStorage } from "@/services/storagePersistence";

const CASHIER = "cashier@example.com";

function setNavigatorOnline(value: boolean): void {
	Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

/** A fresh page load: new stores, nothing in memory, localStorage kept. */
function reloadPage(): void {
	setActivePinia(createPinia());
}

beforeEach(() => {
	localStorage.clear();
	callMock.mockReset();
	setNavigatorOnline(true);
	reloadPage();
	window.xpos = {
		boot: { user_info: { [CASHIER]: { user_email: CASHIER, user_fullname: "Test Cashier" } } },
	} as never;
});

afterEach(() => {
	vi.useRealTimers();
});

async function signInOnline(): Promise<void> {
	callMock.mockImplementation(async (method: string) => {
		if (method === "frappe.auth.get_logged_user") return CASHIER;
		return {};
	});
	expect(await useAuthStore().checkAuth()).toBe(true);
}

function goOffline(): void {
	setNavigatorOnline(false);
	callMock.mockImplementation(async () => {
		throw new Error("Failed to fetch");
	});
}

describe("O1: staying signed in through an offline reload", () => {
	it("restores the cashier who was signed in", async () => {
		await signInOnline();
		goOffline();
		reloadPage();

		const auth = useAuthStore();
		expect(await auth.checkAuth()).toBe(true);
		expect(auth.userName).toBe(CASHIER);
		expect(auth.userFullName).toBe("Test Cashier");
		expect(auth.isOfflineAuth).toBe(true);
	});

	it("restores the session when the server is unreachable though the network is up", async () => {
		await signInOnline();
		callMock.mockImplementation(async () => {
			throw new Error("Failed to fetch");
		});
		reloadPage();

		expect(await useAuthStore().checkAuth()).toBe(true);
	});

	it("does not sign anyone in offline if nobody signed in online first", async () => {
		goOffline();

		expect(await useAuthStore().checkAuth()).toBe(false);
	});

	it("forgets the cashier on logout", async () => {
		await signInOnline();
		await useAuthStore().logout();
		goOffline();
		reloadPage();

		expect(await useAuthStore().checkAuth()).toBe(false);
	});

	it("forgets the cashier when the server says the session has ended", async () => {
		await signInOnline();
		callMock.mockImplementation(async () => "Guest");
		reloadPage();
		expect(await useAuthStore().checkAuth()).toBe(false);

		goOffline();
		reloadPage();
		expect(await useAuthStore().checkAuth()).toBe(false);
	});
});

describe("O3: the sale being rung up survives a reload", () => {
	const item = { item_code: "ITEM-001", item_name: "Test Item", qty: 2, rate: 5, amount: 10, uom: "Nos" };

	it("brings back the items, customer and discount for the same cashier", async () => {
		const cart = useCartStore();
		enableCartDraft(CASHIER);
		cart.items = [item as never];
		cart.customer = { name: "CUST-1", customer_name: "A Customer" };
		cart.discountPercentage = 10;
		await nextTick();

		reloadPage();
		const restored = useCartStore();
		enableCartDraft(CASHIER);

		expect(restored.items).toMatchObject([{ item_code: "ITEM-001", qty: 2 }]);
		expect(restored.customer).toMatchObject({ name: "CUST-1" });
		expect(restored.discountPercentage).toBe(10);
	});

	it("does not show one cashier's cart to another", async () => {
		enableCartDraft(CASHIER);
		useCartStore().items = [item as never];
		await nextTick();

		reloadPage();
		enableCartDraft("other@example.com");

		expect(useCartStore().items).toEqual([]);
	});

	it("does not bring back a sale that was completed or cleared", async () => {
		const cart = useCartStore();
		enableCartDraft(CASHIER);
		cart.items = [item as never];
		await nextTick();
		cart.clearAll();
		await nextTick();

		reloadPage();
		enableCartDraft(CASHIER);

		expect(useCartStore().items).toEqual([]);
	});

	it("drops a cart left from a previous day", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-18T10:00:00"));
		enableCartDraft(CASHIER);
		useCartStore().items = [item as never];
		await nextTick();

		vi.setSystemTime(new Date("2026-09-19T08:00:00"));
		reloadPage();
		enableCartDraft(CASHIER);

		expect(useCartStore().items).toEqual([]);
	});
});

describe("O3: the offline queue is not evicted by the browser", () => {
	it("asks the browser to keep this site's storage", async () => {
		const persist = vi.fn(async () => true);
		Object.defineProperty(window.navigator, "storage", {
			configurable: true,
			value: { persisted: vi.fn(async () => false), persist },
		});

		expect(await requestPersistentStorage()).toBe(true);
		expect(persist).toHaveBeenCalledOnce();
	});

	it("does not ask again once storage is persistent", async () => {
		const persist = vi.fn(async () => true);
		Object.defineProperty(window.navigator, "storage", {
			configurable: true,
			value: { persisted: vi.fn(async () => true), persist },
		});

		expect(await requestPersistentStorage()).toBe(true);
		expect(persist).not.toHaveBeenCalled();
	});
});
