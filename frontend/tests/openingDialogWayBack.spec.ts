/**
 * @vitest-environment jsdom
 *
 * K55: the open-shift screen takes the whole window, without the menu bar and its Sign
 * Out, and the desktop till has no application menu. A cashier who could not open a shift
 * (no POS Profile came back, the server refused the till's user) could not go back to
 * sign-in: only quitting the app got them out. The screen now offers Sign Out on the
 * till, even while it is still loading, and says why the profiles did not load.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive, ref } from "vue";

const pos = reactive({
	openingData: null as Record<string, unknown> | null,
	fetchOpeningData: vi.fn(),
	openShift: vi.fn(),
});
const auth = reactive({ userName: "ann@example.com", userFullName: "Ann", logout: vi.fn() });
const electron = vi.hoisted(() => ({ value: true }));

vi.mock("@/stores/posStore", () => ({ usePosStore: () => pos }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => auth }));
vi.mock("@/services/api", () => ({ showError: vi.fn() }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => electron.value }));
vi.mock("@/composables/useMoney", () => ({ useMoney: () => ({ moneyPrecision: ref(2) }) }));
vi.mock("@/composables/useSyncStatus", () => ({
	useSyncStatus: () => ({ isSyncing: ref(false), syncCompleteCount: ref(0) }),
}));
vi.mock("@/composables/useBranding", () => ({ useBranding: () => ({ logoLight: "" }) }));

import OpeningDialog from "@/components/dialogs/OpeningDialog.vue";

const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function open() {
	const wrapper = mount(OpeningDialog, { attachTo: document.body });
	await flushPromises();
	return wrapper;
}

beforeEach(() => {
	document.body.innerHTML = "";
	electron.value = true;
	globalThis.__ = ((text: string) => text) as never;
	pos.fetchOpeningData.mockReset();
	auth.logout.mockReset();
});

describe("K55: the open-shift screen on the till", () => {
	it("K55: a cashier with no POS Profile can sign out and go back to sign-in", async () => {
		pos.fetchOpeningData.mockResolvedValue({ pos_profiles: [], payment_methods: [] });
		const wrapper = await open();
		const signOut = byTestId("opening-sign-out");
		expect(signOut).not.toBeNull();
		signOut!.click();
		expect(auth.logout).toHaveBeenCalledOnce();
		wrapper.unmount();
	});

	it("K55: sign out is there while the profiles are still loading", async () => {
		pos.fetchOpeningData.mockReturnValue(new Promise(() => {}));
		const wrapper = await open();
		expect(byTestId("opening-sign-out")).not.toBeNull();
		wrapper.unmount();
	});

	it("K55: says who is signed in, so the cashier knows whose shift it would be", async () => {
		pos.fetchOpeningData.mockResolvedValue({ pos_profiles: [], payment_methods: [] });
		const wrapper = await open();
		expect(byTestId("opening-signed-in-as")?.textContent).toContain("Ann");
		wrapper.unmount();
	});

	it("K55: when the profiles fail to load, the screen says why, not only a passing toast", async () => {
		pos.fetchOpeningData.mockRejectedValue(new Error("Insufficient Permission for POS Profile"));
		const wrapper = await open();
		expect(byTestId("opening-error")?.textContent).toContain("Insufficient Permission for POS Profile");
		expect(byTestId("opening-sign-out")).not.toBeNull();
		wrapper.unmount();
	});

	it("K55: the web POS keeps its way back to Desk, and gets no till sign-out", async () => {
		electron.value = false;
		pos.fetchOpeningData.mockResolvedValue({ pos_profiles: [], payment_methods: [] });
		const wrapper = await open();
		expect(document.body.querySelector('a[href="/desk"]')).not.toBeNull();
		expect(byTestId("opening-sign-out")).toBeNull();
		wrapper.unmount();
	});
});
