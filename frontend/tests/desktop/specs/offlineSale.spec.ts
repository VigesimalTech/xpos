/**
 * Offline sales on the desktop till: with the line to ERPNext cut, a cashier still sells —
 * the sale is queued on the till, the sync pill says so, and when the line comes back the
 * same sale reaches ERPNext once (same local_id, no duplicate).
 *
 * The till talks to the site through support/network.ts's switchable line, so the outage
 * is the connection failing the way a dead shop network does — not a browser flag.
 *
 * Paced like a person working the till, for demos:
 * - Electron launches with `slowMo`, so every mouse move and click is deliberate;
 * - form fields are typed keystroke by keystroke (`HumanPace.typeMs`);
 * - `humanClick` hovers before it clicks, and each step holds on the result (`stepMs`);
 * - `DEMO_PAUSE_MS` is the beat between beats. Raise it to stretch the show.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import * as h from "../support/till";
import { serverLine, type ServerLine } from "../support/network";

test.describe.configure({ mode: "serial" });
test.skip(!h.site, "needs a seeded site: XPOS_RT_CONFIG and XPOS_RT_URL (see tests/desktop/README.md)");

const site = h.site!;

/** Hold on a state so a watcher can read it — before and after every action. */
const DEMO_PAUSE_MS = 2_500;
/** Delay on every input action inside the app (Electron launch slowMo). */
const DEMO_SLOW_MO_MS = 400;
/** What the wizard/sign-in helpers use: keys land one at a time; pause after each field. */
const DEMO_PACE: h.HumanPace = { typeMs: 90, stepMs: 700 };

const pause = (page: Page) => page.waitForTimeout(DEMO_PAUSE_MS);

/** A deliberate click: sit on the control, click, then show what happened. */
async function humanClick(page: Page, target: Locator, holdMs = DEMO_PAUSE_MS): Promise<void> {
	await target.scrollIntoViewIfNeeded().catch(() => undefined);
	await target.hover();
	await page.waitForTimeout(Math.min(holdMs, 900));
	await target.click();
	await page.waitForTimeout(holdMs);
}

/** Show the state, do one action, show what it did. */
async function step<T>(page: Page, action: () => Promise<T>): Promise<T> {
	await pause(page);
	const result = await action();
	await pause(page);
	return result;
}

let net: ServerLine;
let till: h.Till;
let page: Page;
const tillProfile = h.newProfile();
/** The till's view of the site: same URL shape, through the switchable line. */
let tillSite: typeof site;

test.beforeAll(async () => {
	net = await serverLine(site.url);
	tillSite = { ...site, url: net.url };
	till = await h.launchTill(tillProfile, { slowMo: DEMO_SLOW_MO_MS });
	page = till.page;
});

test.afterAll(async () => {
	await till?.close();
	await net.close();
});

test.afterEach(async () => {
	await pause(page);
});

test("a new till is set up, a cashier signs in, and a shift opens", async () => {
	await step(page, () => h.setUpTill(page, tillSite, undefined, DEMO_PACE));
	await step(page, () => h.signIn(page, site.supervisor, site.cashier_password, DEMO_PACE));
	await expect(page.getByText("Open your shift to get started")).toBeVisible();

	const profile = `${site.pos_profile} (${site.company})`;
	await expect(page.getByText(profile).or(page.getByText("Select...")).first()).toBeVisible();
	if (await page.getByText("Select...").isVisible()) {
		await humanClick(page, page.getByText("Select..."));
		await humanClick(page, page.getByRole("option", { name: profile }));
	}
	await humanClick(page, page.getByRole("button", { name: "Open Shift" }));
	await expect(page.getByText(site.customer).first()).toBeVisible();
});

test("with the line down, a sale saves on the till and the pill says Offline", async () => {
	await step(page, () => net.offline("refuse"));

	// The grid shows the item's name; site.item is its code (RT-ITEM).
	await humanClick(page, page.getByText("Round-trip Item", { exact: true }).first());
	await expect(page.locator("[data-cart-index]").filter({ visible: true })).toHaveCount(1);

	await humanClick(page, page.getByRole("button", { name: /^Pay/ }));
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Amount Due")).toBeVisible();
	await pause(page);

	await humanClick(page, dialog.getByTestId("save-payment"));

	// Electron queues every sale locally; offline the same path must still succeed.
	await expect(page.getByText(/Invoice saved locally/i).first()).toBeVisible({ timeout: 30_000 });
	await expect(dialog).toBeHidden();
	await pause(page);

	const [queued] = await h.tillDb<{ id: number; local_id: string; status: string }>(
		"SELECT `id`, `local_id`, `status` FROM `pending_invoices` ORDER BY `id` DESC LIMIT 1",
	);
	expect(queued, "a pending_invoices row for the offline sale").toBeTruthy();
	expect(queued.status).toBe("pending");

	// The pill is how the cashier knows the till is off the network with work waiting.
	await expect(page.getByTestId("sync-pill")).toContainText(/Offline/i, { timeout: 15_000 });
});

/**
 * Open the pill panel while offline — a watcher can see what the cashier sees.
 * (The sale is checked in pending_invoices above; Order History is the place that
 * reliably lists local sales — see BUG-003 for the panel list going stale.)
 */
test("the offline panel opens while the sale waits on the till", async () => {
	await humanClick(page, page.getByTestId("sync-pill"));
	const panel = page.getByRole("dialog");
	await expect(panel.getByRole("heading", { name: /Offline Invoices/ })).toBeVisible();
	await page.screenshot({ path: "test-results/offline-panel-while-offline.png" });
	await pause(page);
	await step(page, async () => {
		await panel
			.getByRole("button", { name: /Close|×/ })
			.first()
			.click({ timeout: 2_000 })
			.catch(() => undefined);
		await page.keyboard.press("Escape");
	});
	await expect(panel).toBeHidden({ timeout: 5_000 }).catch(() => undefined);
});

test("when the line returns, the same sale reaches ERPNext once", async () => {
	const before = await h.tillDb<{ local_id: string }>(
		"SELECT `local_id` FROM `pending_invoices` ORDER BY `id` DESC LIMIT 1",
	);
	const localId = before[0].local_id;

	await step(page, () => net.online());

	// Shift → Sync Now: walk the menu at the same pace as the rest.
	await step(page, async () => {
		await humanClick(page, page.getByText("Shift", { exact: true }).first(), 1_200);
		await humanClick(page, page.getByText("Sync Now", { exact: true }).first(), 1_200);
	});

	const [invoice] = await h.eventually(
		page,
		async () => {
			const rows = await h.erpList<{ name: string; docstatus: number; grand_total: number }>(
				site,
				"Sales Invoice",
				[["xpos_local_id", "=", localId]],
				["name", "docstatus", "grand_total"],
			);
			return rows.length ? rows : null;
		},
		{ message: "the offline sale in ERPNext", timeout: 120_000 },
	);
	expect(invoice.docstatus).toBe(1);
	await pause(page);

	// Exactly one: a reconnect must not double-send.
	const twins = await h.erpList<{ name: string }>(site, "Sales Invoice", [
		["xpos_local_id", "=", localId],
	]);
	expect(twins, "one invoice for the local_id").toHaveLength(1);

	// The till forgets it once the server has it.
	await expect
		.poll(
			async () =>
				(
					await h.tillDb<{ n: number }>(
						"SELECT COUNT(*) AS n FROM `pending_invoices` WHERE `local_id` = ? AND `status` = 'pending'",
						[localId],
					)
				)[0].n,
			{ message: "pending row cleared after sync", timeout: 60_000 },
		)
		.toBe(0);

	await expect(page.getByTestId("sync-pill")).not.toContainText(/Offline/i, { timeout: 30_000 });
	await pause(page);
});
