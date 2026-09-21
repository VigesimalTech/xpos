/**
 * @vitest-environment jsdom
 *
 * Where the desktop till goes at start: setup, sign-in, or a wait for its
 * local database. A set-up till whose database is slow to start must never be
 * sent to setup.
 */
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { setupRedirect } from "@/router/setupGuard";

const replace = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ replace }) }));

import WaitingForDatabaseView from "@/views/WaitingForDatabaseView.vue";

const pos = { name: "pos", meta: {} };
const setup = { name: "setup", meta: { isSetupPage: true } };
const starting = { name: "starting", meta: { isStartingPage: true } };

describe("H6: where the till goes at start", () => {
	it("waits for the database instead of offering setup", () => {
		expect(setupRedirect("waiting-for-database", pos)).toBe("starting");
		expect(setupRedirect("waiting-for-database", setup)).toBe("starting");
		expect(setupRedirect("waiting-for-database", starting)).toBe("");
	});

	it("offers setup only when the till has not been set up", () => {
		expect(setupRedirect("setup", pos)).toBe("setup");
		expect(setupRedirect("setup", starting)).toBe("setup");
		expect(setupRedirect("setup", setup)).toBe("");
	});

	it("leaves setup and the wait behind once the till is ready", () => {
		expect(setupRedirect("ready", setup)).toBe("login");
		expect(setupRedirect("ready", starting)).toBe("login");
		expect(setupRedirect("ready", pos)).toBeNull();
	});
});

describe("H6: the waiting screen", () => {
	it("goes on to sign-in when the database answers", async () => {
		vi.useFakeTimers();
		const states = ["waiting-for-database", "waiting-for-database", "ready"];
		const getSetupState = vi.fn(async () => states.shift() ?? "ready");
		(window as unknown as { electronAPI: unknown }).electronAPI = { getSetupState };

		const view = mount(WaitingForDatabaseView);
		await flushPromises();
		expect(view.text()).toContain("Waiting for the local database");
		expect(replace).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(2000);
		expect(replace).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2000);

		expect(replace).toHaveBeenCalledWith({ name: "login" });
		expect(view.text()).not.toContain("Set up");
		view.unmount();
		vi.useRealTimers();
	});
});
