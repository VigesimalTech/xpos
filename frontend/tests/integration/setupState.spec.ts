/**
 * A till that starts before its local database (a power cut, or opening at
 * login while MariaDB is still starting) must wait for it, not offer setup
 * again: a cashier could fill the wizard in with the wrong server or key.
 */
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app, invoke } from "./support/electronShim";
import { closeTestDb, createTestDb, testDbConfig } from "./support/localDb";
import { closeDatabase, execute, initDatabase, setMeta } from "../../electron/database/dbService";
import {
	SETUP_MARKER_FILE,
	connectWhenReady,
	registerSetupStateHandlers,
} from "../../electron/startup/setupState";

const marker = path.join(app.getPath("userData"), SETUP_MARKER_FILE);

async function databaseUp(): Promise<void> {
	await closeDatabase();
	await initDatabase(testDbConfig);
}

beforeAll(async () => {
	await createTestDb();
	registerSetupStateHandlers();
});

afterAll(async () => {
	fs.rmSync(marker, { force: true });
	await closeTestDb();
});

beforeEach(async () => {
	fs.rmSync(marker, { force: true });
	await databaseUp();
	await execute("DELETE FROM `sync_meta` WHERE `key` = 'node_role'");
});

describe("H6: a till that starts before its database", () => {
	it("goes to sign-in when the database answers and the till is set up", async () => {
		await setMeta("node_role", "hub");

		expect(await invoke("app:setup-state")).toBe("ready");
		expect(await invoke("app:is-first-run")).toBe(false);
	});

	it("waits for the database, rather than offering setup, once the till is set up", async () => {
		await setMeta("node_role", "hub");
		expect(await invoke("app:setup-state")).toBe("ready");

		await closeDatabase();

		expect(await invoke("app:setup-state")).toBe("waiting-for-database");
		expect(await invoke("app:is-first-run")).toBe(false);
	});

	it("remembers a till set up before this version, the first time its database answers", async () => {
		await setMeta("node_role", "till");
		expect(fs.existsSync(marker)).toBe(false);

		expect(await invoke("app:setup-state")).toBe("ready");

		expect(fs.existsSync(marker)).toBe(true);
	});

	it("still offers setup on a new till whose database is not reachable yet", async () => {
		await closeDatabase();

		expect(await invoke("app:setup-state")).toBe("setup");
		expect(await invoke("app:is-first-run")).toBe(true);
	});

	it("offers setup when the database answers with no role, whatever was set up before", async () => {
		fs.writeFileSync(marker, "{}");

		expect(await invoke("app:setup-state")).toBe("setup");
	});

	it("goes on to sign-in once the database comes up", async () => {
		await setMeta("node_role", "hub");
		expect(await invoke("app:setup-state")).toBe("ready");
		await closeDatabase();
		expect(await invoke("app:setup-state")).toBe("waiting-for-database");

		await databaseUp();

		expect(await invoke("app:setup-state")).toBe("ready");
	});
});

describe("H6: connecting to the database at start", () => {
	it("keeps trying until the database answers", async () => {
		let attempts = 0;
		await connectWhenReady(
			async () => {
				attempts += 1;
				if (attempts < 3) throw new Error("connect ECONNREFUSED 127.0.0.1:3307");
			},
			{ retryMs: 1 },
		);

		expect(attempts).toBe(3);
	});

	it("stops trying when the app quits", async () => {
		const quit = new AbortController();
		let attempts = 0;
		const waiting = connectWhenReady(
			async () => {
				attempts += 1;
				throw new Error("connect ECONNREFUSED 127.0.0.1:3307");
			},
			{ retryMs: 5, signal: quit.signal },
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		quit.abort();

		await expect(waiting).rejects.toThrow(/stopped/);
		const after = attempts;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(attempts).toBe(after);
	});
});
