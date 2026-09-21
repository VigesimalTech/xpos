/**
 * H6: a till that starts before its local database, as after a power cut or when it opens
 * at login while MariaDB is still starting. It must wait for the database and then carry on
 * to sign-in. It must not offer the setup wizard, where a cashier could enter the wrong
 * server or key.
 *
 * No ERPNext needed: the till is set up with a role only, and its database sits behind a
 * relay that can be switched off and on.
 */
import { expect, test } from "@playwright/test";
import {
	databaseRelay,
	launchTill,
	newProfile,
	tillDb,
	type DatabaseRelay,
	type Till,
} from "../support/till";

test.describe.configure({ mode: "serial" });

const WIZARD = "Select Installation Type";
const WAITING = "Waiting for the local database";

let relay: DatabaseRelay;
let till: Till | null = null;
const profile = newProfile();

test.beforeAll(async () => {
	relay = await databaseRelay();
	await relay.start();
});

test.afterEach(async () => {
	await till?.close();
	till = null;
});

test.afterAll(async () => {
	await relay.stop();
});

test("a new till with its database up offers setup", async () => {
	till = await launchTill(profile, { dbPort: relay.port });
	await expect(till.page.getByText(WIZARD)).toBeVisible();
});

test("once set up, the till opens at sign-in", async () => {
	// The role is what setup leaves behind; a till set up before this version has no
	// other record of it, so this is also the upgrade path.
	await tillDb("INSERT INTO `sync_meta` (`key`, `value`, `updated_at`) VALUES ('node_role', 'hub', NOW())");

	till = await launchTill(profile, { fresh: false, dbPort: relay.port });
	await expect(till.page).toHaveURL(/#\/login/);
});

test("started before its database, it waits and then carries on to sign-in", async () => {
	await relay.stop();

	till = await launchTill(profile, { fresh: false, dbPort: relay.port });
	await expect(till.page.getByText(WAITING)).toBeVisible();
	await expect(till.page.getByText(WIZARD)).not.toBeVisible();

	await relay.start();

	await expect(till.page).toHaveURL(/#\/login/, { timeout: 30_000 });
	await expect(till.page.getByText(WIZARD)).not.toBeVisible();
});
