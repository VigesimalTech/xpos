/**
 * @vitest-environment jsdom
 *
 * The till's sign-in screen with PINs: pick your name, tap your PIN.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/services/userRights", () => ({ loadPermissions: vi.fn(), resetPermissions: vi.fn() }));
vi.mock("@/composables/useBranding", () => ({
	useBranding: () => ({ logoLight: "light.svg", logoDark: "dark.svg" }),
}));
const push = vi.fn();
vi.mock("vue-router", () => ({
	useRouter: () => ({ push, currentRoute: { value: { query: {} } } }),
	RouterLink: { template: "<a><slot /></a>" },
}));

import LoginView from "@/views/LoginView.vue";

const CASHIERS = [
	{ name: "ada@example.com", username: "ada", full_name: "Ada Obi" },
	{ name: "tunde@example.com", username: "tunde", full_name: "Tunde Bello" },
];

let db: Record<string, ReturnType<typeof vi.fn>>;
let syncComplete: (() => void) | undefined;

function mountView() {
	return mount(LoginView, { global: { provide: { isDark: false } } });
}

async function tapPin(wrapper: ReturnType<typeof mountView>, pin: string) {
	for (const digit of pin) await wrapper.get(`[data-pin-key="${digit}"]`).trigger("click");
}

beforeEach(() => {
	setActivePinia(createPinia());
	push.mockReset();
	db = {
		getPinUsers: vi.fn(async () => CASHIERS),
		getPosUsers: vi.fn(async () => CASHIERS),
		verifyPin: vi.fn(async (_u: string, pin: string) =>
			pin === "4821" ? { ok: true } : { ok: false, reason: "wrong_pin", attemptsLeft: 4 },
		),
		getPosUser: vi.fn(async (u: string) => CASHIERS.find((c) => c.username === u || c.name === u)),
		setSetting: vi.fn(async () => undefined),
	};
	syncComplete = undefined;
	window.electronAPI = {
		db,
		startSyncEngine: vi.fn(async () => ({ success: true })),
		onSyncComplete: vi.fn((cb: () => void) => {
			syncComplete = cb;
			return () => undefined;
		}),
	} as never;
});

describe("K6: signing in on the till with a PIN", () => {
	it("opens on the cashiers who have a PIN", async () => {
		const wrapper = mountView();
		await flushPromises();

		expect(wrapper.findAll("[data-pin-user]").map((b) => b.text())).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Ada Obi"),
				expect.stringContaining("Tunde Bello"),
			]),
		);
		expect(wrapper.find("#password").exists()).toBe(false);
	});

	it("signs a cashier in with their PIN and opens the POS", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper.get('[data-pin-user="ada@example.com"]').trigger("click");
		await tapPin(wrapper, "4821");
		await wrapper.get("[data-pin-submit]").trigger("click");
		await flushPromises();

		expect(db.verifyPin).toHaveBeenCalledWith("ada@example.com", "4821");
		expect(push).toHaveBeenCalledWith("/pos");
	});

	it("says a PIN was wrong and how many tries are left", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper.get('[data-pin-user="ada@example.com"]').trigger("click");
		await tapPin(wrapper, "1111");
		await wrapper.get("[data-pin-submit]").trigger("click");
		await flushPromises();

		expect(wrapper.text()).toContain("Wrong PIN. 4 tries left.");
		expect(push).not.toHaveBeenCalled();
	});

	it("does not submit fewer than 4 digits", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper.get('[data-pin-user="ada@example.com"]').trigger("click");
		await tapPin(wrapper, "482");

		expect(wrapper.get("[data-pin-submit]").attributes("disabled")).toBeDefined();
	});

	it("lets a cashier use their password instead", async () => {
		const wrapper = mountView();
		await flushPromises();
		await wrapper.get("[data-use-password]").trigger("click");

		expect(wrapper.find("#password").exists()).toBe(true);
	});

	it("shows the password form when no cashier has a PIN", async () => {
		db.getPinUsers.mockResolvedValue([]);
		const wrapper = mountView();
		await flushPromises();

		expect(wrapper.find("#password").exists()).toBe(true);
		expect(wrapper.find("[data-pin-user]").exists()).toBe(false);
	});
});

describe("K23: a new till signs in only cashiers from ERPNext", () => {
	it("says so while the till has no cashiers yet", async () => {
		db.getPinUsers.mockResolvedValue([]);
		db.getPosUsers.mockResolvedValue([]);
		const wrapper = mountView();
		await flushPromises();

		expect(wrapper.find("[data-no-till-users]").exists()).toBe(true);
	});

	it("shows the cashiers once the first sync brings them", async () => {
		db.getPinUsers.mockResolvedValueOnce([]);
		db.getPosUsers.mockResolvedValueOnce([]);
		const wrapper = mountView();
		await flushPromises();
		expect(wrapper.findAll("[data-pin-user]")).toHaveLength(0);

		syncComplete!();
		await flushPromises();

		expect(wrapper.find("[data-no-till-users]").exists()).toBe(false);
		expect(wrapper.findAll("[data-pin-user]")).toHaveLength(2);
	});
});
