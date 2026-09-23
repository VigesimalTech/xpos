/**
 * K44: a till left alone locks itself; the same cashier's PIN or password opens it again,
 * with the sale in progress kept. The screens never see password or PIN hashes (K43).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";

import { withoutSecrets } from "../electron/database/profileAccess";

const electron = vi.hoisted(() => ({ value: true }));
const auth = vi.hoisted(() => ({
	isAuthenticated: true,
	locked: false,
	lockUsesPin: true,
	error: "",
	userFullName: "Ann Cashier",
	userName: "ann@example.com",
	lock: vi.fn(),
	unlockWithPin: vi.fn(),
	unlockWithPassword: vi.fn(),
	logout: vi.fn(),
}));
const pos = vi.hoisted(() => ({ idleLockMinutes: 5 }));

vi.mock("@/services/electronBridge", () => ({ isElectron: () => electron.value }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => authState }));
vi.mock("@/stores/posStore", () => ({ usePosStore: () => posState }));

const authState = reactive(auth);
const posState = reactive(pos);

import { useIdleLock } from "@/composables/useIdleLock";
import LockScreen from "@/components/auth/LockScreen.vue";

const Host = defineComponent({
	setup() {
		useIdleLock();
		return () => h("div");
	},
});

beforeEach(() => {
	vi.useFakeTimers();
	electron.value = true;
	Object.assign(authState, { isAuthenticated: true, locked: false, lockUsesPin: true, error: "" });
	posState.idleLockMinutes = 5;
	vi.clearAllMocks();
	authState.lock.mockImplementation(async () => {
		authState.locked = true;
	});
});
afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("locking a till left alone", () => {
	it("locks after the POS Profile's minutes with no activity", () => {
		const host = mount(Host);
		vi.advanceTimersByTime(5 * 60_000 - 1);
		expect(authState.lock).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(authState.lock).toHaveBeenCalledTimes(1);
		host.unmount();
	});

	it("counts afresh on every touch, click or key", () => {
		const host = mount(Host);
		vi.advanceTimersByTime(4 * 60_000);
		window.dispatchEvent(new Event("pointerdown"));
		vi.advanceTimersByTime(4 * 60_000);
		expect(authState.lock).not.toHaveBeenCalled();
		vi.advanceTimersByTime(60_000);
		expect(authState.lock).toHaveBeenCalledTimes(1);
		host.unmount();
	});

	it("never locks when the profile sets 0", () => {
		posState.idleLockMinutes = 0;
		const host = mount(Host);
		vi.advanceTimersByTime(60 * 60_000);
		expect(authState.lock).not.toHaveBeenCalled();
		host.unmount();
	});

	it("does not lock the web POS, which has no PINs", () => {
		electron.value = false;
		const host = mount(Host);
		vi.advanceTimersByTime(60 * 60_000);
		expect(authState.lock).not.toHaveBeenCalled();
		host.unmount();
	});
});

describe("the lock screen", () => {
	it("opens with the cashier's PIN", async () => {
		authState.unlockWithPin.mockResolvedValue(true);
		const screen = mount(LockScreen, { attachTo: document.body });
		for (const key of "1357") window.dispatchEvent(new KeyboardEvent("keydown", { key }));
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		await flushPromises();
		expect(authState.unlockWithPin).toHaveBeenCalledWith("1357");
		screen.unmount();
	});

	it("asks for the password of a cashier with no PIN", async () => {
		authState.lockUsesPin = false;
		authState.unlockWithPassword.mockResolvedValue(false);
		authState.error = "Invalid password";
		const screen = mount(LockScreen, { attachTo: document.body });
		await screen.find('[data-testid="lock-password"]').setValue("wrong");
		await screen.find("form").trigger("submit");
		await flushPromises();
		expect(authState.unlockWithPassword).toHaveBeenCalledWith("wrong");
		expect(screen.find('[data-testid="lock-error"]').text()).toBe("Invalid password");
		screen.unmount();
	});

	it("lets the till be handed over by signing out", async () => {
		const screen = mount(LockScreen, { attachTo: document.body });
		await screen
			.findAll("button")
			.find((b) => b.text().includes("Sign out"))!
			.trigger("click");
		expect(authState.logout).toHaveBeenCalled();
		screen.unmount();
	});
});

describe("what the screens see of a user (K43)", () => {
	it("whether they have a password and a PIN, never a hash", () => {
		const row = withoutSecrets({
			name: "ann@example.com",
			password_hash: "p",
			password_salt: "ps",
			pin_hash: "",
			pin_salt: "",
			profile_access: JSON.stringify({ "Shop 1": { pin_hash: "h", pin_salt: "s" } }),
		});
		expect(row).toMatchObject({ name: "ann@example.com", has_password: true, has_pin: true });
		for (const secret of ["password_hash", "password_salt", "pin_hash", "pin_salt", "profile_access"]) {
			expect(row).not.toHaveProperty(secret);
		}
	});
});
