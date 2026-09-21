/**
 * Exploratory driver: starts one till, as the desktop tests do, and keeps it running so a
 * person (or an agent) can work it step by step and look at what happened after each step.
 *
 *   XPOS_RT_CONFIG=… XPOS_RT_URL=… npx playwright test -c playwright.explore.config.ts
 *
 * It listens on 127.0.0.1:${XPOS_EXPLORE_PORT:-47111}:
 *   POST /run   body: the body of an async function (page, till, site, h) run in the test
 *               process; its return value comes back as JSON. `h` holds the harness helpers.
 *   GET  /shot?name=x   a screenshot, saved under test-results/explore/x.png
 *   GET  /log   what the page's console, the main process and the printers said since the
 *               last call, then cleared
 *   POST /quit  closes the till and ends the run
 *
 * Every print channel is recorded, not printed: no paper, and every receipt is kept.
 */
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import * as h from "../support/till";

const PORT = Number(process.env.XPOS_EXPLORE_PORT || 47111);
const SHOTS = join(process.cwd(), "test-results/explore");

test("explore", async () => {
	test.setTimeout(0);
	mkdirSync(SHOTS, { recursive: true });
	const fresh = process.env.XPOS_EXPLORE_FRESH !== "0";
	const profile = process.env.XPOS_EXPLORE_PROFILE || h.newProfile();
	const till = await h.launchTill(profile, { fresh });
	const page = till.page;
	const log: string[] = [];
	const stamp = () => new Date().toISOString().slice(11, 23);

	page.on("console", (m) => log.push(`${stamp()} [page:${m.type()}] ${m.text()}`));
	page.on("pageerror", (e) => log.push(`${stamp()} [page:exception] ${e.message}`));
	page.on("requestfailed", (r) =>
		log.push(`${stamp()} [net:failed] ${r.method()} ${r.url()} ${r.failure()?.errorText}`),
	);
	page.on("response", (r) => {
		if (r.status() >= 400) log.push(`${stamp()} [net:${r.status()}] ${r.request().method()} ${r.url()}`);
	});
	const main = till.app.process();
	main.stdout?.on("data", (d) =>
		log.push(
			...String(d)
				.trimEnd()
				.split("\n")
				.map((l) => `${stamp()} [main] ${l}`),
		),
	);
	main.stderr?.on("data", (d) =>
		log.push(
			...String(d)
				.trimEnd()
				.split("\n")
				.map((l) => `${stamp()} [main:err] ${l}`),
		),
	);

	// Record the other print channels too (launchTill records print:receipt).
	await till.app.evaluate(({ ipcMain }) => {
		const g = globalThis as Record<string, unknown>;
		const other: unknown[] = [];
		g.__xposOtherPrints = other;
		for (const channel of ["print:invoice", "print:report"]) {
			ipcMain.removeHandler(channel);
			ipcMain.handle(channel, (_e, ...args: unknown[]) => {
				other.push({ channel, args });
				return { success: true };
			});
		}
	});

	const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
	let done: () => void;
	const finished = new Promise<void>((r) => (done = r));

	const server = createServer(async (req, res) => {
		const url = new URL(req.url || "/", "http://x");
		const reply = (code: number, body: unknown) => {
			res.writeHead(code, { "content-type": "application/json" });
			res.end(JSON.stringify(body, null, 1));
		};
		try {
			if (url.pathname === "/log") {
				const out = log.splice(0);
				return reply(200, out);
			}
			if (url.pathname === "/shot") {
				const path = join(SHOTS, `${url.searchParams.get("name") || Date.now()}.png`);
				await page.screenshot({ path });
				return reply(200, { path });
			}
			if (url.pathname === "/quit") {
				reply(200, { ok: true });
				return done();
			}
			if (url.pathname === "/run") {
				let body = "";
				for await (const chunk of req) body += chunk;
				const fn = new AsyncFunction("page", "till", "site", "h", body);
				const result = await fn(page, till, h.site, h);
				return reply(200, { result: result ?? null });
			}
			reply(404, { error: "unknown" });
		} catch (e) {
			reply(500, { error: String((e as Error)?.stack || e) });
		}
	});
	server.listen(PORT, "127.0.0.1");
	console.log(`explore driver on http://127.0.0.1:${PORT}, profile ${profile}`);
	await finished;
	server.close();
	await till.close();
});
