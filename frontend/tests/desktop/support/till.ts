/**
 * A till for the desktop tests: the built Electron app on a profile of its own, with a
 * fresh test_ database, set up through its own setup wizard against the seeded ERPNext.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

interface Keys {
	api_key: string;
	api_secret: string;
}

/** What xpos/tests/round_trip.py seeded, plus where the site is. */
export interface Site {
	url: string;
	company: string;
	item: string;
	rate: number;
	customer: string;
	pos_profile: string;
	api_key: string;
	api_secret: string;
	tills: Record<string, Keys>;
	cashiers: Record<string, string[]>;
	supervisor: string;
	cashier_password: string;
	expense_account: string;
	deposit_account: string;
}

const configPath = process.env.XPOS_RT_CONFIG;

/** The seeded site, or null when there is none to test against. */
export const site: Site | null = configPath
	? {
			url: process.env.XPOS_RT_URL || "http://test_site:8000",
			...JSON.parse(readFileSync(configPath, "utf8")),
		}
	: null;

export const CASHIER = "rt-cashier@example.com";

const db = {
	host: process.env.XPOS_TEST_DB_HOST || "127.0.0.1",
	port: Number(process.env.XPOS_TEST_DB_PORT || 3307),
	user: process.env.XPOS_TEST_DB_USER || "xpos",
	password: process.env.XPOS_TEST_DB_PASSWORD || "xpos",
	database: process.env.XPOS_TEST_DB_NAME || "test_xpos_desktop",
};
if (!db.database.startsWith("test_")) throw new Error(`Refusing to use ${db.database}: not a test_ database`);

/** Query the till's own database. */
export async function tillDb<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
	const conn = await mysql.createConnection(db);
	try {
		const [rows] = await conn.query(sql, params);
		return rows as T[];
	} finally {
		await conn.end();
	}
}

async function freshDatabase(): Promise<void> {
	const { database, ...server } = db;
	const conn = await mysql.createConnection(server);
	try {
		await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
		await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
	} finally {
		await conn.end();
	}
}

function freePort(): Promise<number> {
	return new Promise((done, fail) => {
		const server = createServer();
		server.once("error", fail);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number };
			server.close(() => done(port));
		});
	});
}

export interface Till {
	app: ElectronApplication;
	page: Page;
	/** Receipts the till sent to the printer, as HTML. */
	printed: () => Promise<string[]>;
	close: () => Promise<void>;
}

/**
 * Start the app on a profile of its own. With `fresh`, a new database and profile, so
 * the setup wizard shows; without, the till reopens where the last one left off.
 */
export async function launchTill(profile: string, { fresh = true } = {}): Promise<Till> {
	if (fresh) {
		rmSync(profile, { recursive: true, force: true });
		await freshDatabase();
	}
	// Point the app at the test database from the start: without this it opens the
	// default xpos_local before the wizard has asked.
	mkdirSync(profile, { recursive: true });
	writeFileSync(join(profile, "db-config.json"), JSON.stringify(db));
	// Playwright runs from frontend/ (yarn test:desktop).
	const frontend = resolve(process.cwd());
	const app = await electron.launch({
		args: [join(frontend, "dist-electron/main.js")],
		cwd: frontend,
		env: { ...process.env, XPOS_USER_DATA_DIR: profile, NODE_ENV: "test" } as Record<string, string>,
	});
	const page = await app.firstWindow();
	await page.waitForLoadState("domcontentloaded");

	// No printer in a test: keep what the till would have printed. The app registers its
	// handler before it opens the window, so it is there to replace by now.
	await app.evaluate(({ ipcMain }) => {
		const printed: string[] = [];
		(globalThis as Record<string, unknown>).__xposPrinted = printed;
		ipcMain.removeHandler("print:receipt");
		ipcMain.handle("print:receipt", (_event, html: string) => {
			printed.push(html);
			return { success: true, printer: "test" };
		});
	});
	return {
		app,
		page,
		printed: () => app.evaluate(() => (globalThis as Record<string, unknown>).__xposPrinted as string[]),
		close: () => app.close(),
	};
}

export function newProfile(): string {
	return mkdtempSync(join(tmpdir(), "xpos-desktop-"));
}

/** First run: the setup wizard, as the one till of a shop talking to ERPNext itself. */
export async function setUpTill(page: Page, s: Site, keys: Keys = s.tills[s.pos_profile]): Promise<void> {
	await expect(page.getByText("Select Installation Type")).toBeVisible();
	await page.getByText("Hub (Server)").click();
	await page.getByRole("button", { name: "Next", exact: true }).click();

	await page.getByPlaceholder("127.0.0.1").fill(db.host);
	await page.getByPlaceholder("3306").fill(String(db.port));
	await page.getByPlaceholder("xpos", { exact: true }).fill(db.user);
	await page.getByPlaceholder("••••••").fill(db.password);
	await page.getByPlaceholder("xpos_local").fill(db.database);
	await page.getByRole("button", { name: "Test Connection" }).click();
	await expect(page.getByText("Connected!")).toBeVisible();
	await page.getByRole("button", { name: "Next", exact: true }).click();

	await page.getByPlaceholder("https://erp.example.com").fill(s.url);
	await page.getByPlaceholder("API Key").fill(keys.api_key);
	await page.getByPlaceholder("API Secret").fill(keys.api_secret);
	await page.getByPlaceholder("6789").fill(String(await freePort()));
	await page.getByRole("button", { name: "Test ERPNext Connection" }).click();
	await expect(page.getByText("Connected!")).toBeVisible();
	await page.getByRole("button", { name: "Next", exact: true }).click();

	await page.getByRole("button", { name: "Complete Setup" }).click();
}

/**
 * Sign a cashier in with their password, the first time on this till. A new till knows its
 * cashiers only once its first sync has pulled them from ERPNext, so wait for that first.
 */
export async function signIn(page: Page, user: string, password: string): Promise<void> {
	await expect
		.poll(async () => (await tillDb("SELECT `name` FROM `pos_users` WHERE `name` = ?", [user])).length, {
			message: `${user} pulled to the till`,
			timeout: 90_000,
		})
		.toBe(1);
	await page.getByPlaceholder("Enter your email or username").fill(user);
	await page.getByPlaceholder("Enter your password").fill(password);
	await page.getByRole("button", { name: /sign in|log in|login/i }).click();
}

/** Read from ERPNext as Administrator, to check what the till sent. */
export async function erpList<T = Record<string, unknown>>(
	s: Site,
	doctype: string,
	filters: unknown[],
	fields: string[] = ["name"],
): Promise<T[]> {
	const params = new URLSearchParams({
		filters: JSON.stringify(filters),
		fields: JSON.stringify(fields),
		limit_page_length: "100",
	});
	const response = await fetch(`${s.url}/api/resource/${encodeURIComponent(doctype)}?${params}`, {
		headers: { Authorization: `token ${s.api_key}:${s.api_secret}` },
	});
	if (!response.ok) throw new Error(`${doctype}: ${response.status} ${await response.text()}`);
	return ((await response.json()) as { data: T[] }).data;
}

/** Pick an entry from the till's own menu bar, e.g. menu(page, "Shift", "Close Shift"). */
export async function menu(page: Page, top: string, item: string): Promise<void> {
	await page.getByText(top, { exact: true }).first().click();
	await page.getByText(item, { exact: true }).first().click();
}

/** Push to ERPNext now rather than at the next five-minute sync. */
export async function syncNow(page: Page): Promise<void> {
	await menu(page, "Shift", "Sync Now");
}

/** Wait until `check` returns something truthy, syncing on the way; returns it. */
export async function eventually<T>(
	page: Page,
	check: () => Promise<T | null | undefined | false>,
	{ timeout = 90_000, message = "condition" } = {},
): Promise<T> {
	const until = Date.now() + timeout;
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() > until) throw new Error(`Timed out waiting for ${message}`);
		await syncNow(page).catch(() => undefined);
		await page.waitForTimeout(3000);
	}
}
