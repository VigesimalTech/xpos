/**
 * Who is signed in on the till, and what their role lets them do: always in the menu bar,
 * with the POS Role and POS Profile, and a card to sign out from.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive, ref } from "vue";

const level = vi.hoisted(() => ({ value: "supervisor" }));
const auth = vi.hoisted(() => ({
	isAuthenticated: true,
	userFullName: "Ann Cashier",
	userName: "ann@example.com",
	userEmail: "ann@example.com",
	canManagePermissions: false,
	logout: vi.fn(),
}));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => auth }));
vi.mock("@/stores/posStore", () => ({ usePosStore: () => reactive({ profileName: "Shop 1" }) }));
vi.mock("@/stores/cartStore", () => ({ useCartStore: () => ({}) }));
vi.mock("@/stores/paymentStore", () => ({ usePaymentStore: () => ({}) }));
vi.mock("@/stores/customerStore", () => ({ useCustomerStore: () => ({}) }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));
vi.mock("@/services/userRights", () => ({
	canDoOrAsk: () => true,
	getCurrentRole: () => "Supervisor",
}));
vi.mock("@/services/screenAccess", () => ({ canOpenScreen: () => true }));
vi.mock("@/services/roleLevel", () => ({
	roleLevel: () => level.value,
	reachesLevel: () => true,
}));
vi.mock("@/composables/usePrintInvoice", () => ({ usePrintInvoice: () => ({ reprint: vi.fn() }) }));
vi.mock("@/components/dialogs/AboutDialog.vue", () => ({ default: { template: "<span />" } }));
vi.mock("@/components/dialogs/KeyboardShortcutsDialog.vue", () => ({ default: { template: "<span />" } }));

import MenuBar from "@/components/MenuBar.vue";

const mountBar = () =>
	mount(MenuBar, { global: { provide: { theme: ref("light"), toggleDarkMode: vi.fn() } } });

beforeEach(() => {
	auth.isAuthenticated = true;
	auth.logout.mockClear();
	level.value = "supervisor";
});

describe("who is signed in on the till", () => {
	it("shows the name, the POS Role and the POS Profile in the menu bar", () => {
		const wrapper = mountBar();
		const badge = wrapper.find('[data-testid="signed-in-user"]');
		expect(badge.text()).toContain("Ann Cashier");
		expect(wrapper.find('[data-testid="signed-in-role"]').text()).toBe("Supervisor");
		expect(badge.text()).toContain("Shop 1");
	});

	it("opens a card with the email, what the role can use, and Sign Out", async () => {
		const wrapper = mountBar();
		await wrapper.find('[data-testid="signed-in-user"]').trigger("click");
		const card = wrapper.find('[data-testid="signed-in-card"]');
		expect(card.text()).toContain("ann@example.com");
		expect(card.text()).toContain("Supervisor screens and approvals");
		await card
			.findAll("button")
			.find((b) => b.text().includes("Sign Out"))!
			.trigger("click");
		expect(auth.logout).toHaveBeenCalled();
	});

	it("shows nothing before anyone signs in", () => {
		auth.isAuthenticated = false;
		expect(mountBar().find('[data-testid="signed-in-user"]').exists()).toBe(false);
	});
});
