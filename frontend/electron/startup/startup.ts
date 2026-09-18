/**
 * Starting the desktop till.
 *
 * A till should be selling again after a power cut or a restart without anyone
 * finding the app: it opens at login, on by default (`open_at_login`), and a
 * manager can turn that off in Settings. Only one copy may run: two would each
 * start a sync engine and push the same sales, and each try to bind the hub
 * port. A second launch (a double-click on the icon) brings the running copy
 * to the front instead.
 */
import { app, ipcMain } from "electron";
import { execute, queryOne } from "../database/dbService";
import { createLogger } from "../logger";

const log = createLogger("Startup");

export const OPEN_AT_LOGIN_SETTING = "open_at_login";

async function openAtLoginSetting(): Promise<boolean> {
	const row = await queryOne<{ value: string }>("SELECT `value` FROM `app_settings` WHERE `key` = ?", [
		OPEN_AT_LOGIN_SETTING,
	]);
	return row?.value !== "false";
}

/** Register (or unregister) the app to open at login, from the saved setting. */
export async function applyOpenAtLogin(): Promise<boolean> {
	const enabled = await openAtLoginSetting();
	// A development build would register the bare Electron binary; only an
	// installed app should start at login.
	if (app.isPackaged) {
		app.setLoginItemSettings({ openAtLogin: enabled });
		log.info(`Open at login: ${enabled ? "on" : "off"}`);
	}
	return enabled;
}

/**
 * Take the single-instance lock. False means another copy already runs and
 * this one should quit; `onSecondLaunch` runs in the first copy when someone
 * starts the app again.
 */
export function claimSingleInstance(onSecondLaunch: () => void): boolean {
	if (!app.requestSingleInstanceLock()) return false;
	app.on("second-instance", () => onSecondLaunch());
	return true;
}

export function registerStartupHandlers(): void {
	ipcMain.handle("startup:get-open-at-login", () => openAtLoginSetting());
	ipcMain.handle("startup:set-open-at-login", async (_e, enabled: boolean) => {
		await execute(
			`INSERT INTO \`app_settings\` (\`key\`, \`value\`, \`category\`) VALUES (?, ?, 'startup')
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
			[OPEN_AT_LOGIN_SETTING, enabled ? "true" : "false"],
		);
		return applyOpenAtLogin();
	});
}
