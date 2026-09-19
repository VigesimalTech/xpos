/**
 * Item and customer images, and the receipt logo, are ERPNext files. Private
 * files need the viewer signed in; the desktop app is signed in with its API
 * key, which an <img> cannot send, so the main process adds it to image
 * requests for the ERPNext server, and only those.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { webRequest } from "./support/electronShim";
import { closeTestDb, createTestDb } from "./support/localDb";
import { execute, setMeta } from "../../electron/database/dbService";
import { installServerFileAuth } from "../../electron/serverFiles";

const SERVER = "https://erp.example.com";
const TOKEN = "token test-key:test-secret";

/** Send a request through the installed listener; return the headers it goes out with. */
async function send(url: string, requestHeaders: Record<string, string> = {}) {
	const listener = webRequest.beforeSendHeaders;
	expect(listener, "no request listener installed").not.toBeNull();
	return new Promise<Record<string, string>>((resolve) =>
		listener!({ url, method: "GET", requestHeaders: { ...requestHeaders } }, (r) =>
			resolve(r.requestHeaders ?? requestHeaders),
		),
	);
}

beforeAll(async () => {
	await createTestDb();
	installServerFileAuth();
});

afterAll(async () => {
	await closeTestDb();
});

beforeEach(async () => {
	await execute("DELETE FROM `sync_meta` WHERE `key` IN ('server_url', 'api_key', 'api_secret')").catch(
		() => undefined,
	);
	await setMeta("server_url", SERVER);
	await setMeta("api_key", "test-key");
	await setMeta("api_secret", "test-secret");
});

describe("S1: item images load on the desktop app", () => {
	it("sends the API key with a private file from the ERPNext server", async () => {
		const headers = await send(`${SERVER}/private/files/coca-cola.jpg`);
		expect(headers.Authorization).toBe(TOKEN);
	});

	it("sends it with a public file too", async () => {
		const headers = await send(`${SERVER}/files/fanta.jpg`);
		expect(headers.Authorization).toBe(TOKEN);
	});

	it("never sends the key to any other site", async () => {
		const headers = await send("https://images.example.net/private/files/coca-cola.jpg");
		expect(headers.Authorization).toBeUndefined();
	});

	it("leaves API calls alone: they carry their own credentials", async () => {
		const headers = await send(`${SERVER}/api/method/frappe.ping`);
		expect(headers.Authorization).toBeUndefined();
	});

	it("keeps a request's own Authorization header", async () => {
		const headers = await send(`${SERVER}/private/files/x.jpg`, { Authorization: "token other:one" });
		expect(headers.Authorization).toBe("token other:one");
	});

	it("sends nothing before the till has an API key", async () => {
		await setMeta("api_key", "");
		const headers = await send(`${SERVER}/private/files/x.jpg`);
		expect(headers.Authorization).toBeUndefined();
	});
});
