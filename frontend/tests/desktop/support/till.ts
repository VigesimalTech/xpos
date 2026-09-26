/**
 * A till for the desktop tests: the built Electron app on a profile of its own, with a
 * fresh test_ database, set up through its own setup wizard against the seeded ERPNext.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { connect, createServer, type Server, type Socket } from "net";
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

export function freePort(): Promise<number> {
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
 * Start the app on a profile of its own. With `fresh`, a new database and profile, so the
 * setup wizard shows; without, the till reopens where the last one left off.
 * `dbPort` points the till at another port for its database (see `databaseRelay`).
 * `slowMo` delays every input action (ms) — for demos where each click should be watchable.
 */
export async function launchTill(
	profile: string,
	{ fresh = true, dbPort, slowMo }: { fresh?: boolean; dbPort?: number; slowMo?: number } = {},
): Promise<Till> {
	if (fresh) {
		rmSync(profile, { recursive: true, force: true });
		await freshDatabase();
	}
	// Point the app at the test database from the start: without this it opens the
	// default xpos_local before the wizard has asked.
	mkdirSync(profile, { recursive: true });
	writeFileSync(join(profile, "db-config.json"), JSON.stringify({ ...db, port: dbPort ?? db.port }));
	// Playwright runs from frontend/ (yarn test:desktop).
	const frontend = resolve(process.cwd());
	const app = await electron.launch({
		args: [join(frontend, "dist-electron/main.js")],
		cwd: frontend,
		env: { ...process.env, XPOS_USER_DATA_DIR: profile, NODE_ENV: "test" } as Record<string, string>,
		...(slowMo ? { slowMo } : {}),
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

/**
 * How a person works the form when the run is being watched: keystroke delay while
 * typing, and a beat after each step. Omit it and everything fills instantly (CI).
 */
export interface HumanPace {
	/** ms between keystrokes in a text field. */
	typeMs?: number;
	/** ms to hold after each click / screen change. */
	stepMs?: number;
}

const NO_PACE: Required<HumanPace> = { typeMs: 0, stepMs: 0 };

/** Click a field, type into it the way a person does, then hold so it can be read. */
async function humanFill(
	page: Page,
	field: ReturnType<Page["getByPlaceholder"]>,
	text: string,
	pace: Required<HumanPace>,
): Promise<void> {
	await field.click();
	if (pace.typeMs > 0) {
		// Defaults/placeholder text would otherwise stay under the keystrokes.
		await page.keyboard.press("ControlOrMeta+a");
		await page.keyboard.press("Delete");
		await field.pressSequentially(text, { delay: pace.typeMs });
	} else {
		await field.fill(text);
	}
	if (pace.stepMs > 0) await page.waitForTimeout(pace.stepMs);
}

async function humanClick(page: Page, target: ReturnType<Page["getByRole"]>, pace: Required<HumanPace>): Promise<void> {
	// Dwell on the control first, the way someone lines up a click.
	await target.hover();
	if (pace.stepMs > 0) await page.waitForTimeout(Math.min(pace.stepMs, 800));
	await target.click();
	if (pace.stepMs > 0) await page.waitForTimeout(pace.stepMs);
}

/** First run: the setup wizard, as the one till of a shop talking to ERPNext itself. */
export async function setUpTill(
	page: Page,
	s: Site,
	keys: Keys = s.tills[s.pos_profile],
	pace: HumanPace = {},
): Promise<void> {
	const p = { ...NO_PACE, ...pace };
	await expect(page.getByText("Select Installation Type")).toBeVisible();
	if (p.stepMs > 0) await page.waitForTimeout(p.stepMs);
	await humanClick(page, page.getByText("Hub (Server)"), p);
	await humanClick(page, page.getByRole("button", { name: "Next", exact: true }), p);

	await humanFill(page, page.getByPlaceholder("127.0.0.1"), db.host, p);
	await humanFill(page, page.getByPlaceholder("3306"), String(db.port), p);
	await humanFill(page, page.getByPlaceholder("xpos", { exact: true }), db.user, p);
	await humanFill(page, page.getByPlaceholder("••••••"), db.password, p);
	await humanFill(page, page.getByPlaceholder("xpos_local"), db.database, p);
	await humanClick(page, page.getByRole("button", { name: "Test Connection" }), p);
	await expect(page.getByText("Connected!")).toBeVisible();
	await humanClick(page, page.getByRole("button", { name: "Next", exact: true }), p);

	await humanFill(page, page.getByPlaceholder("https://erp.example.com"), s.url, p);
	await humanFill(page, page.getByPlaceholder("API Key"), keys.api_key, p);
	await humanFill(page, page.getByPlaceholder("API Secret"), keys.api_secret, p);
	await humanFill(page, page.getByPlaceholder("6789"), String(await freePort()), p);
	await humanClick(page, page.getByRole("button", { name: "Test ERPNext Connection" }), p);
	await expect(page.getByText("Connected!")).toBeVisible();
	await humanClick(page, page.getByRole("button", { name: "Next", exact: true }), p);

	await humanClick(page, page.getByRole("button", { name: "Complete Setup" }), p);
}

/**
 * Sign a cashier in with their password, the first time on this till. A new till knows its
 * cashiers only once its first sync has pulled them from ERPNext, so wait for that first.
 */
export async function signIn(page: Page, user: string, password: string, pace: HumanPace = {}): Promise<void> {
	const p = { ...NO_PACE, ...pace };
	await expect
		.poll(async () => (await tillDb("SELECT `name` FROM `pos_users` WHERE `name` = ?", [user])).length, {
			message: `${user} pulled to the till`,
			timeout: 90_000,
		})
		.toBe(1);
	// With cashiers who have PINs, the till opens on "Who is signing in?": the password
	// form is one tap away.
	const email = page.getByPlaceholder("Enter your email or username");
	const usePassword = page.getByText("Use password instead");
	await expect(email.or(usePassword).first()).toBeVisible({ timeout: 30_000 });
	if (!(await email.isVisible())) await humanClick(page, usePassword, p);
	await humanFill(page, email, user, p);
	await humanFill(page, page.getByPlaceholder("Enter your password"), password, p);
	// Not "Sign in with a PIN", which sits under the form.
	await humanClick(page, page.getByRole("button", { name: /^(sign in|log in|login)$/i }), p);
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

export interface DatabaseRelay {
	port: number;
	/** The database answers on `port`. */
	start: () => Promise<void>;
	/** Nothing answers on `port`, as before MariaDB has started. */
	stop: () => Promise<void>;
}

/**
 * A port that forwards to the test MariaDB while started and refuses connections while
 * stopped: a till's database that is not up yet, then is.
 */
export async function databaseRelay(): Promise<DatabaseRelay> {
	const port = await freePort();
	let server: Server | null = null;
	const open = new Set<Socket>();
	return {
		port,
		start: () =>
			new Promise((done) => {
				server = createServer((client) => {
					const upstream = connect(db.port, db.host);
					for (const s of [client, upstream]) {
						open.add(s);
						s.on("error", () => undefined);
						s.on("close", () => open.delete(s));
					}
					client.pipe(upstream).pipe(client);
				});
				server.listen(port, "127.0.0.1", () => done());
			}),
		stop: () =>
			new Promise((done) => {
				for (const s of open) s.destroy();
				if (!server) return done();
				server.close(() => done());
				server = null;
			}),
	};
}

/** Set one field on a record in ERPNext as Administrator, e.g. a POS Profile setting for a test. */
export async function erpSetValue(
	s: Site,
	doctype: string,
	name: string,
	fieldname: string,
	value: unknown,
): Promise<void> {
	const response = await fetch(`${s.url}/api/method/frappe.client.set_value`, {
		method: "POST",
		headers: {
			Authorization: `token ${s.api_key}:${s.api_secret}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ doctype, name, fieldname, value }),
	});
	if (!response.ok) throw new Error(`${doctype} ${name}: ${response.status} ${await response.text()}`);
}

/** Give a user a till PIN on a POS Profile, as a manager does on their row in ERPNext. */
export async function erpSetTillPin(s: Site, posProfile: string, user: string, pin: string): Promise<void> {
	const headers = {
		Authorization: `token ${s.api_key}:${s.api_secret}`,
		"Content-Type": "application/json",
	};
	const url = `${s.url}/api/resource/POS Profile/${encodeURIComponent(posProfile)}`;
	const got = await fetch(url, { headers });
	if (!got.ok) throw new Error(`POS Profile ${posProfile}: ${got.status} ${await got.text()}`);
	const { data } = (await got.json()) as { data: { applicable_for_users: Record<string, unknown>[] } };
	const rows = data.applicable_for_users.map((row) =>
		row.user === user ? { ...row, xpos_pin: pin } : row,
	);
	if (!rows.some((row) => row.user === user)) throw new Error(`${user} is not on ${posProfile}`);
	const put = await fetch(url, {
		method: "PUT",
		headers,
		body: JSON.stringify({ applicable_for_users: rows }),
	});
	if (!put.ok) throw new Error(`POS Profile ${posProfile}: ${put.status} ${await put.text()}`);
}
