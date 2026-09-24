/**
 * K44: a till left alone locks itself, and the cashier signed in opens it again with
 * their own PIN; the sale in progress is still there, and a wrong PIN reaches ERPNext's
 * audit log. Worked through the app against a real ERPNext, with the shop's POS Profile
 * set to lock after one minute and the supervisor given a known till PIN.
 *
 * Unlocking by password (a cashier with no PIN) is covered by tests/idleLock.spec.ts.
 */
import { expect, test, type Page } from "@playwright/test";
import {
	erpList,
	erpSetTillPin,
	erpSetValue,
	eventually,
	launchTill,
	newProfile,
	setUpTill,
	signIn,
	site,
	type Till,
} from "../support/till";

test.describe.configure({ mode: "serial" });
test.skip(!site, "needs a seeded site: XPOS_RT_CONFIG and XPOS_RT_URL (see tests/desktop/README.md)");

const FIELD = "xpos_idle_lock_minutes";
const PIN = "2468";

let till: Till;
let page: Page;
let lockMinutesBefore: unknown = null;
let wrongPinsBefore = 0;

const cartLines = () => page.locator("[data-cart-index]").filter({ visible: true });
const lockScreen = () => page.getByTestId("lock-screen");

async function wrongPinEvents(): Promise<number> {
	const events = await erpList(site!, "POS Audit Event", [
		["event_type", "=", "PIN Failed"],
		["pin_user", "=", site!.supervisor],
	]);
	return events.length;
}

async function typePin(pin: string) {
	for (const digit of pin) await lockScreen().getByRole("button", { name: digit, exact: true }).click();
}

test.beforeAll(async () => {
	const [profile] = await erpList<Record<string, unknown>>(
		site!,
		"POS Profile",
		[["name", "=", site!.pos_profile]],
		["name", FIELD],
	);
	lockMinutesBefore = profile?.[FIELD] ?? null;
	// Before the till is set up, so its first sync brings both.
	await erpSetValue(site!, "POS Profile", site!.pos_profile, FIELD, 1);
	await erpSetTillPin(site!, site!.pos_profile, site!.supervisor, PIN);
	wrongPinsBefore = await wrongPinEvents();
	till = await launchTill(newProfile());
	page = till.page;
});

test.afterAll(async () => {
	await till?.close();
	await erpSetValue(site!, "POS Profile", site!.pos_profile, FIELD, lockMinutesBefore ?? 5);
});

test("a cashier signs in, opens a shift and starts a sale", async () => {
	await setUpTill(page, site!);
	await signIn(page, site!.supervisor, site!.cashier_password);
	const profile = `${site!.pos_profile} (${site!.company})`;
	await expect(page.getByText(profile).or(page.getByText("Select...")).first()).toBeVisible();
	if (await page.getByText("Select...").isVisible()) {
		await page.getByText("Select...").click();
		await page.getByRole("option", { name: profile }).click();
	}
	await page.getByRole("button", { name: "Open Shift" }).click();
	await expect(page.getByText(site!.customer).first()).toBeVisible();

	await page.getByText("Round-trip Item", { exact: true }).first().click();
	await expect(cartLines()).toHaveCount(1);
	await expect(lockScreen()).toHaveCount(0);
});

test("left alone for the profile's minute, the till locks and asks the cashier's PIN", async () => {
	await expect(lockScreen()).toBeVisible({ timeout: 90_000 });
	await expect(lockScreen().getByText("Enter your PIN to carry on")).toBeVisible();
	await expect(lockScreen().getByText("Sign out, for someone else to use the till")).toBeVisible();
});

test("nothing behind the lock answers: a click on the sale screen does not reach it", async () => {
	await page.mouse.click(10, 10);
	await expect(lockScreen()).toBeVisible();
	await expect(cartLines()).toHaveCount(1);
});

test("a wrong PIN leaves it locked", async () => {
	await typePin("1111");
	await lockScreen().getByRole("button", { name: "Unlock" }).click();
	await expect(lockScreen().getByTestId("lock-error")).toContainText("Wrong PIN");
	await expect(lockScreen()).toBeVisible();
});

test("the cashier's own PIN opens it, with the sale still in the cart", async () => {
	await typePin(PIN);
	await lockScreen().getByRole("button", { name: "Unlock" }).click();
	await expect(lockScreen()).toHaveCount(0);
	await expect(cartLines()).toHaveCount(1);
	await expect(page.getByText(site!.customer).first()).toBeVisible();
});

test("the wrong PIN is recorded in ERPNext's audit log", async () => {
	await eventually(page, async () => (await wrongPinEvents()) > wrongPinsBefore, {
		message: "the wrong PIN in POS Audit Events",
	});
});
