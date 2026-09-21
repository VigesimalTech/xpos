/**
 * Whether the till is set up, and waiting for its local database at start.
 *
 * The till opens at login and after a power cut, often before its MariaDB is
 * up. A database that does not answer used to read as "never set up", so the
 * setup wizard appeared on a till whose role, keys and cashiers were all
 * intact, and a cashier could fill it in with the wrong server or key.
 *
 * The database stays the record of setup (`node_role` in `sync_meta`). A small
 * marker file beside the app's data, written whenever the database confirms a
 * role, is what lets the app tell a set-up till waiting for its database from
 * a new till whose database settings are still to be entered in the wizard.
 */
import fs from "fs";
import path from "path";
import { app, ipcMain } from "electron";
import { getMeta } from "../database/dbService";
import { createLogger } from "../logger";

const log = createLogger("Startup");

export const SETUP_MARKER_FILE = "setup-complete.json";

export type SetupState = "ready" | "setup" | "waiting-for-database";

function markerPath(): string {
	return path.join(app.getPath("userData"), SETUP_MARKER_FILE);
}

/** Record that this till has been set up, so a later start can wait for its database. */
export function recordSetupComplete(role: string): void {
	try {
		fs.mkdirSync(path.dirname(markerPath()), { recursive: true });
		fs.writeFileSync(markerPath(), JSON.stringify({ role, at: new Date().toISOString() }), "utf-8");
	} catch (err) {
		log.warn("Could not record that setup is complete", err);
	}
}

function wasSetUp(): boolean {
	return fs.existsSync(markerPath());
}

export async function readSetupState(): Promise<SetupState> {
	let role: string | null;
	try {
		role = await getMeta("node_role");
	} catch (err) {
		if (wasSetUp()) {
			log.info(`Local database not answering yet: ${err instanceof Error ? err.message : String(err)}`);
			return "waiting-for-database";
		}
		return "setup";
	}
	if (!role) return "setup";
	// Tills set up before the marker existed get it the first time their database answers.
	if (!wasSetUp()) recordSetupComplete(role);
	return "ready";
}

export function registerSetupStateHandlers(): void {
	ipcMain.handle("app:setup-state", () => readSetupState());
	// Kept for callers that only ask "show setup?"; waiting is not setup.
	ipcMain.handle("app:is-first-run", async () => (await readSetupState()) === "setup");
}

/**
 * Run `connect` until it succeeds, waiting `retryMs` between tries. Rejects
 * only when `signal` aborts (the app is quitting).
 */
export async function connectWhenReady(
	connect: () => Promise<void>,
	opts: { retryMs: number; signal?: AbortSignal },
): Promise<void> {
	for (let attempt = 1; ; attempt++) {
		if (opts.signal?.aborted) throw new Error("Waiting for the local database stopped");
		try {
			await connect();
			if (attempt > 1) log.info(`Local database answered after ${attempt} tries`);
			return;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (attempt === 1)
				log.error(`MariaDB init failed: ${message}; retrying every ${opts.retryMs} ms`);
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, opts.retryMs);
			opts.signal?.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
		});
	}
}
