/**
 * @vitest-environment jsdom
 *
 * The till signs in to ERPNext as its own API user, so every request says which cashier
 * is at the till and its POS Profile: ERPNext checks the cashier's rights, not the till's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/composables/useToast", () => ({ showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() }));
vi.mock("@/utils", () => ({ isOnline: () => true, isNetworkError: () => false }));
vi.mock("@/services/electronBridge", () => ({
	isElectron: () => true,
	getApiBaseUrlSync: () => "https://erp.example.com",
	getApiCredentialsSync: () => ({ apiKey: "key", apiSecret: "secret" }),
}));
vi.mock("@/services/errorLog", () => ({ captureError: vi.fn() }));
vi.mock("@/services/idbService", () => ({ getMeta: vi.fn() }));
vi.mock("@/composables/useCurrency", () => ({ formatWithSymbol: vi.fn() }));

import { call } from "@/services/api";
import { setTillIdentity } from "@/services/tillIdentity";

let fetchMock: ReturnType<typeof vi.fn>;

function sentHeaders(): Record<string, string> {
	return fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>;
}

beforeEach(() => {
	fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "ok" }), { status: 200 }));
	vi.stubGlobal("fetch", fetchMock);
	setTillIdentity({ cashier: undefined, posProfile: undefined });
});

afterEach(() => vi.unstubAllGlobals());

describe("the till says who is at it", () => {
	it("sends the cashier and POS Profile with the till's own key", async () => {
		setTillIdentity({ cashier: "cashier@example.com" });
		setTillIdentity({ posProfile: "Café Floor" });

		await call("xpos.api.items.get_pos_items");

		expect(sentHeaders()).toMatchObject({
			Authorization: "token key:secret",
			"X-XPOS-Cashier": "cashier%40example.com",
			"X-XPOS-POS-Profile": "Caf%C3%A9%20Floor",
		});
	});

	it("sends neither before anyone has signed in", async () => {
		await call("frappe.ping");
		expect(sentHeaders()).not.toHaveProperty("X-XPOS-Cashier");
		expect(sentHeaders()).not.toHaveProperty("X-XPOS-POS-Profile");
	});

	it("stops naming a cashier who has signed out", async () => {
		setTillIdentity({ cashier: "cashier@example.com", posProfile: "Shop" });
		setTillIdentity({ cashier: undefined });
		await call("frappe.ping");
		expect(sentHeaders()).not.toHaveProperty("X-XPOS-Cashier");
	});
});
