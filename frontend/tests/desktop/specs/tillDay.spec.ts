/**
 * A day on a new desktop till, worked through the app as the shop's supervisor would, against
 * a real ERPNext: set up, sign in, open a shift, sell, hold and restore an order, look up the
 * day's orders, take cash out as an expense and a bank drop, close the shift. What the till
 * sends must land in ERPNext, and what it prints must print on the till.
 *
 * The steps share one till and run in order; a step that fails skips the rest.
 */
import { expect, test, type Page } from "@playwright/test";
import {
	databaseRelay,
	erpList,
	eventually,
	launchTill,
	menu,
	newProfile,
	setUpTill,
	signIn,
	site,
	tillDb,
	type DatabaseRelay,
	type Till,
} from "../support/till";

test.describe.configure({ mode: "serial" });
test.skip(!site, "needs a seeded site: XPOS_RT_CONFIG and XPOS_RT_URL (see tests/desktop/README.md)");

let till: Till;
let page: Page;
/** Relays a restarted till's database goes through: kept open until the till closes. */
const relays: DatabaseRelay[] = [];
const tillProfile = newProfile();
/** Requests that went somewhere other than the till's ERPNext: the setup must reach every one. */
const strayRequests: string[] = [];

/** The visible cart panel's button with this icon (the cart's buttons have tooltips, no names). */
const cartButton = (icon: string) =>
	page.locator(`button:has(svg.lucide-${icon})`).filter({ visible: true }).first();

async function addItem(name: string) {
	await page.getByText(name, { exact: true }).first().click();
	await expect(page.locator("[data-cart-index]").filter({ visible: true })).toHaveCount(1);
}

function watchRequests() {
	page.on("request", (request) => {
		const url = request.url();
		if (url.startsWith("http") && !url.startsWith(site!.url)) strayRequests.push(url);
	});
}

test.beforeAll(async () => {
	till = await launchTill(tillProfile);
	page = till.page;
	watchRequests();
});

test.afterAll(async () => {
	await till?.close();
	for (const relay of relays) await relay.stop();
});

test("a new till is set up and a cashier signs in with their ERPNext password", async () => {
	await setUpTill(page, site!);
	await signIn(page, site!.supervisor, site!.cashier_password);
	await expect(page.getByText("Open your shift to get started")).toBeVisible();
});

test("the cashier opens a shift on their POS Profile", async () => {
	// Only the user's own profiles are offered; with one, it is already chosen.
	const profile = `${site!.pos_profile} (${site!.company})`;
	await expect(page.getByText(profile).or(page.getByText("Select...")).first()).toBeVisible();
	if (await page.getByText("Select...").isVisible()) {
		await page.getByText("Select...").click();
		await page.getByRole("option", { name: profile }).click();
	}
	await page.getByRole("button", { name: "Open Shift" }).click();
	await expect(page.getByText(site!.customer).first()).toBeVisible();
});

test("restarted mid-shift, the till comes back to its shift, every time", async () => {
	// A crash or a power cut. The till reopens signed in as the last cashier, or at sign-in;
	// either way it must find the shift still open, not ask for a new one. It asked whenever
	// its database answered a moment late, as after a power cut: the shift was looked up
	// before the cashier was known (bug hunt, release sweep, 22 Sep 2026).
	for (const databaseLate of [false, true, false]) {
		await till.close();
		const relay = databaseLate ? await databaseRelay() : null;
		till = await launchTill(tillProfile, { fresh: false, dbPort: relay?.port });
		page = till.page;
		watchRequests();
		if (relay) {
			await page.waitForTimeout(2000);
			await relay.start();
			relays.push(relay);
		}
		// The sale screen: its cart names the customer (a hidden layout has a copy too).
		const pos = page.getByText(site!.customer).filter({ visible: true }).first();
		const openShift = page.getByText("Open your shift to get started");
		const signInScreen = page
			.getByText("Use password instead")
			.or(page.getByPlaceholder("Enter your password"));
		await expect(pos.or(signInScreen).or(openShift).first()).toBeVisible({ timeout: 30_000 });
		if (await signInScreen.first().isVisible()) {
			await signIn(page, site!.supervisor, site!.cashier_password);
		}
		await expect(pos, `database late: ${databaseLate}`).toBeVisible({ timeout: 30_000 });
		await expect(openShift).not.toBeVisible();
	}
});

let saleLocalId = "";

test("a cash sale with change prints its receipt on the till and reaches ERPNext", async () => {
	await addItem("Round-trip Item");
	await page.getByRole("button", { name: /^Pay/ }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Amount Due")).toBeVisible();
	// More cash than is due: the till gives the rest back. It refused, calling the cash a
	// card overpayment, when its payment rows carried no type (release sweep, 22 Sep 2026).
	const change = 50;
	const tendered = dialog
		.getByText("Tendered", { exact: true })
		.locator("xpath=../..")
		.locator("input")
		.first();
	await tendered.fill(String(site!.rate + change));
	await expect(dialog.getByText("Change", { exact: true })).toBeVisible();
	await expect(dialog.getByText(/50\.00/).first()).toBeVisible();
	await expect(dialog.getByTestId("card-overpaid")).toHaveCount(0);
	await dialog.getByRole("button", { name: /Save & Print/ }).click();
	await expect(dialog).toBeHidden();

	await expect.poll(async () => (await till.printed()).length).toBe(1);
	expect((await till.printed())[0]).toContain("Round-trip Item");

	const [sale] = await tillDb<{ local_id: string }>(
		"SELECT `local_id` FROM `pending_invoices` ORDER BY `id` DESC LIMIT 1",
	);
	saleLocalId = sale.local_id;
	const [invoice] = await eventually(
		page,
		async () => {
			const rows = await erpList<{
				name: string;
				grand_total: number;
				docstatus: number;
				change_amount: number;
			}>(
				site!,
				"Sales Invoice",
				[["xpos_local_id", "=", saleLocalId]],
				["name", "grand_total", "docstatus", "change_amount"],
			);
			return rows.length ? rows : null;
		},
		{ message: "the sale in ERPNext" },
	);
	expect(invoice.docstatus).toBe(1);
	expect(invoice.grand_total).toBe(site!.rate);
	expect(invoice.change_amount).toBe(change);
});

test("a held order is kept on the till, not sent, and restored into the cart", async () => {
	await addItem("Round-trip Item");
	await cartButton("clock").click();
	await expect(page.locator("[data-cart-index]").filter({ visible: true })).toHaveCount(0);

	await menu(page, "Sales", "Held Invoices");
	const held = page.getByRole("dialog");
	await expect(held.getByText("Round-trip Item").or(held.getByText(site!.customer)).first()).toBeVisible();
	await held.getByText(site!.customer).first().click();
	await expect(page.locator("[data-cart-index]").filter({ visible: true })).toHaveCount(1);

	// Still one sale in ERPNext: a held order is not a sale.
	const [{ count }] = await tillDb<{ count: number }>(
		"SELECT COUNT(*) AS `count` FROM `pending_invoices` WHERE JSON_EXTRACT(`data`, '$.is_draft') IS NULL OR JSON_EXTRACT(`data`, '$.is_draft') = false",
	);
	expect(Number(count)).toBe(1);
	await cartButton("x").click();
});

test("Orders lists the day's sale", async () => {
	await menu(page, "Sales", "Orders");
	await expect(page.getByText(site!.customer).first()).toBeVisible();
	await menu(page, "Sales", "Point of Sale");
});

test("an expense and a bank drop are recorded on the till and posted in ERPNext", async () => {
	await menu(page, "Shift", "Cash Expense");
	let dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Expense Account")).toBeVisible();
	await dialog.getByRole("combobox").first().click();
	await page
		.getByRole("option", { name: new RegExp(site!.expense_account.split(" - ")[0]) })
		.first()
		.click();
	await dialog.getByPlaceholder("0.00").fill("15");
	await dialog.getByPlaceholder("Enter reason for this transaction...").fill("Desktop test expense");
	await dialog.getByRole("button", { name: "Record Expense" }).click();
	await expect(page.getByText("POS expense recorded")).toBeVisible();

	await menu(page, "Shift", "Cash Deposit");
	dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Deposit To")).toBeVisible();
	await dialog.getByRole("combobox").first().click();
	await page
		.getByRole("option", { name: new RegExp(site!.deposit_account.split(" - ")[0]) })
		.first()
		.click();
	await dialog.getByPlaceholder("0.00").fill("20");
	await dialog.getByPlaceholder("Enter reason for this transaction...").fill("Desktop test drop");
	await dialog.getByRole("button", { name: "Record Deposit" }).click();
	await expect(page.getByText("Cash deposit recorded")).toBeVisible();

	const [shift] = await tillDb<{ erp_id: string | null }>(
		"SELECT `erp_id` FROM `pos_opening_shifts` ORDER BY `id` DESC LIMIT 1",
	);
	const moves = await eventually(
		page,
		async () => {
			const [synced] = await tillDb<{ erp_id: string | null }>(
				"SELECT `erp_id` FROM `pos_opening_shifts` ORDER BY `id` DESC LIMIT 1",
			);
			if (!synced?.erp_id) return null;
			const rows = await erpList<{ movement_type: string; amount: number; docstatus: number }>(
				site!,
				"POS Cash Movement",
				[["pos_opening_shift", "=", synced.erp_id]],
				["movement_type", "amount", "docstatus"],
			);
			return rows.length === 2 ? rows : null;
		},
		{ message: `two cash movements in ERPNext (shift ${shift?.erp_id ?? "not yet synced"})` },
	);
	expect(moves.map((m) => Number(m.amount)).sort((a, b) => a - b)).toEqual([15, 20]);
});

test("the shift closes on the till, its summary prints on the till, and ERPNext makes the closing", async () => {
	const printedBefore = (await till.printed()).length;
	await menu(page, "Shift", "Close Shift");
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("Payment Reconciliation")).toBeVisible();
	await dialog.getByRole("button", { name: "Close Shift" }).click();
	await expect(page.getByText("Shift closed successfully!")).toBeVisible();
	await dialog.getByRole("button", { name: "Print Summary" }).click();
	await expect.poll(async () => (await till.printed()).length).toBeGreaterThan(printedBefore);
	await dialog.getByRole("button", { name: "Done" }).click();

	const [shift] = await tillDb<{ erp_id: string }>(
		"SELECT `erp_id` FROM `pos_opening_shifts` ORDER BY `id` DESC LIMIT 1",
	);
	const [closing] = await eventually(
		page,
		async () => {
			const rows = await erpList<{ name: string; docstatus: number }>(
				site!,
				"POS Closing Shift",
				[["pos_opening_shift", "=", shift.erp_id]],
				["name", "docstatus"],
			);
			return rows.length ? rows : null;
		},
		{ message: "the POS Closing Shift in ERPNext" },
	);
	expect(closing.docstatus).toBe(1);
});

test("after setup, the till talked to no server but its own ERPNext", async () => {
	// The branding request fires before the wizard, when there is no server yet. The till's
	// fonts come from Google Fonts, allowed by its CSP (index.electron.html).
	const allowed = (url: string) =>
		url.includes("get_xpos_branding") || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url);
	expect(strayRequests.filter((url) => !allowed(url))).toEqual([]);
});
