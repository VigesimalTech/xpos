/**
 * A server that takes the connection and never answers (a dead Wi-Fi link, a captive
 * portal) must not hold the sync for ever. Before the limit, one such request kept the
 * sync "running" and every later sync, sales included, waited behind it until the app
 * restarted (found by the bug hunt with the line set to "hang").
 */
import { createServer, type Server, type Socket } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rendererEvents, setOnline } from "./support/electronShim";
import { clearSyncTables, closeTestDb, createTestDb } from "./support/localDb";
import {
	initSyncEngine,
	runSyncCyclePublic,
	setRequestTimeout,
	stopSyncEngine,
} from "../../electron/sync/syncEngine";

let silent: Server;
const held: Socket[] = [];
let url = "";

beforeAll(async () => {
	await createTestDb();
	await clearSyncTables();
	silent = createServer((socket) => held.push(socket)); // takes it, says nothing
	await new Promise<void>((r) => silent.listen(0, "127.0.0.1", () => r()));
	url = `http://127.0.0.1:${(silent.address() as { port: number }).port}`;
});

afterAll(async () => {
	stopSyncEngine();
	setRequestTimeout(60_000);
	for (const s of held) s.destroy();
	await new Promise((r) => silent.close(r));
	await closeTestDb();
});

describe("a server that never answers", () => {
	it("does not hold the sync: the cycle ends, says why, and the next one can run", async () => {
		setOnline(true);
		setRequestTimeout(200);
		initSyncEngine({ serverUrl: url, csrfToken: "", sessionCookies: "", apiKey: "k", apiSecret: "s" });
		rendererEvents.length = 0;

		const started = Date.now();
		await runSyncCyclePublic();
		expect(Date.now() - started).toBeLessThan(30_000);
		expect(JSON.stringify(rendererEvents)).toContain("No answer from ERPNext");

		// A second cycle runs, rather than returning at once behind a sync still "running".
		const before = held.length;
		await runSyncCyclePublic();
		expect(held.length).toBeGreaterThan(before);
	}, 60_000);

	it("an answer cut off part way fails the step at once, as ERPNext not answering", async () => {
		// Headers and the start of a body, then the line drops.
		const cut = createServer((socket) =>
			socket.once("data", () => {
				socket.write(
					'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"message": [',
				);
				setTimeout(() => socket.destroy(), 20);
			}),
		);
		await new Promise<void>((r) => cut.listen(0, "127.0.0.1", () => r()));
		const cutUrl = `http://127.0.0.1:${(cut.address() as { port: number }).port}`;
		stopSyncEngine();
		setRequestTimeout(30_000);
		initSyncEngine({ serverUrl: cutUrl, csrfToken: "", sessionCookies: "", apiKey: "k", apiSecret: "s" });
		rendererEvents.length = 0;

		const started = Date.now();
		await runSyncCyclePublic();
		expect(Date.now() - started).toBeLessThan(10_000);
		// Reported as ERPNext not answering, not as the record's own failure.
		expect(rendererEvents).toContainEqual(
			expect.objectContaining({
				channel: "sync-error",
				data: expect.objectContaining({ unreachable: true }),
			}),
		);
		await new Promise((r) => cut.close(r));
	}, 60_000);
});
