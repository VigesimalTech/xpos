/**
 * The desktop till starts by itself when the PC starts (after a power cut, a
 * restart or an update), and only one copy of the app ever runs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app, invoke, startup } from "./support/electronShim";
import { closeTestDb, createTestDb } from "./support/localDb";
import { execute } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import {
	applyOpenAtLogin,
	claimSingleInstance,
	registerStartupHandlers,
} from "../../electron/startup/startup";

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
	registerStartupHandlers();
});

afterAll(async () => {
	await closeTestDb();
});

beforeEach(async () => {
	await execute("DELETE FROM `app_settings` WHERE `key` = 'open_at_login'");
	startup.loginItem = null;
	startup.lockAvailable = true;
	startup.listeners = {};
	app.isPackaged = true;
});

describe("H6: the till opens X POS when the PC starts", () => {
	it("is on by default for an installed app", async () => {
		expect(await applyOpenAtLogin()).toBe(true);
		expect(startup.loginItem).toEqual({ openAtLogin: true });
	});

	it("can be turned off in settings", async () => {
		await invoke("startup:set-open-at-login", false);

		expect(startup.loginItem).toEqual({ openAtLogin: false });
		expect(await invoke("startup:get-open-at-login")).toBe(false);
		// and it stays off on the next start
		startup.loginItem = null;
		expect(await applyOpenAtLogin()).toBe(false);
		expect(startup.loginItem).toEqual({ openAtLogin: false });
	});

	it("does not register a development build to start at login", async () => {
		app.isPackaged = false;

		await applyOpenAtLogin();

		expect(startup.loginItem).toBeNull();
	});
});

describe("H6: only one copy of the app runs", () => {
	it("a second launch does not start another copy", () => {
		startup.lockAvailable = false;

		expect(claimSingleInstance(vi.fn())).toBe(false);
	});

	it("a second launch brings the running copy to the front", () => {
		const focusExisting = vi.fn();

		expect(claimSingleInstance(focusExisting)).toBe(true);
		startup.listeners["second-instance"]?.();

		expect(focusExisting).toHaveBeenCalledOnce();
	});
});
