/**
 * Exploratory driver: starts one till, as the desktop tests do, and keeps it running so a
 * person (or an agent) can work it step by step and look at what happened after each step.
 *
 *   XPOS_RT_CONFIG=… XPOS_RT_URL=… npx playwright test -c playwright.explore.config.ts
 *
 * The till talks to ERPNext through a switchable line (support/network.ts), so the
 * network can be cut or hung at any moment. It listens on 127.0.0.1:${XPOS_EXPLORE_PORT:-47111}:
 *
 *   POST /run      body: the body of an async function (page, till, site, h, x), run in the
 *                  test process; its return value comes back as JSON.
 *                  h: support/till.ts. x: { net, tillSite, reconcile, suspicious }.
 *                  Set the till up with x.tillSite (the line's URL), not site.
 *   GET  /shot?name=x   a screenshot, saved under test-results/explore/x.png
 *   GET  /log      what the page console, the main process, the network and the printers
 *                  said since the last /log
 *   GET  /check    the oracles: till against ERPNext (x.reconcile) and every suspicious log
 *                  line since the last /check
 *   POST /restart  quit the app and start it again on the same profile and database
 *   POST /quit     close the till and end the run
 *
 * To reopen a till after /quit: XPOS_EXPLORE_FRESH=0, XPOS_EXPLORE_PROFILE=<its folder>
 * and XPOS_EXPLORE_LINE_PORT=<the port of its line, printed at start>.
 *
 * Every print channel is recorded, not printed: no paper, and every receipt is kept.
 */
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import * as h from "../support/till";
import { serverLine } from "../support/network";
import { reconcile, suspicious } from "./oracles";

const PORT = Number(process.env.XPOS_EXPLORE_PORT || 47111);
const SHOTS = join(process.cwd(), "test-results/explore");

test("explore", async () => {
	test.setTimeout(0);
	if (!h.site) throw new Error("needs XPOS_RT_CONFIG and XPOS_RT_URL");
	mkdirSync(SHOTS, { recursive: true });
	const net = await serverLine(h.site.url, Number(process.env.XPOS_EXPLORE_LINE_PORT) || undefined);
	// Start with the line down, to reopen a till into an outage (XPOS_EXPLORE_LINE=hang|refuse).
	const startLine = process.env.XPOS_EXPLORE_LINE;
	if (startLine === "hang" || startLine === "refuse") await net.offline(startLine);
	const tillSite = { ...h.site, url: net.url };
	const fresh = process.env.XPOS_EXPLORE_FRESH !== "0";
	const profile = process.env.XPOS_EXPLORE_PROFILE || h.newProfile();

	const log: string[] = [];
	let logRead = 0;
	let checkRead = 0;
	const stamp = () => new Date().toISOString().slice(11, 23);
	const add = (tag: string, text: string) =>
		log.push(
			...String(text)
				.trimEnd()
				.split("\n")
				.map((l) => `${stamp()} [${tag}] ${l}`),
		);

	let till: h.Till;
	let page: h.Till["page"];

	async function attach(t: h.Till) {
		till = t;
		page = t.page;
		page.on("console", (m) => add(`page:${m.type()}`, m.text()));
		page.on("pageerror", (e) => add("page:exception", e.stack || e.message));
		// A till's window must not go away on its own: say when and how it did.
		page.on("crash", () => add("page:crash", "the renderer process crashed"));
		page.on("close", () => add("page:closed", "the till's window closed"));
		t.app.on("window", (w) => add("app:window", `new window ${w.url()}`));
		page.on("requestfailed", (r) =>
			add("net:failed", `${r.method()} ${r.url()} ${r.failure()?.errorText}`),
		);
		page.on("response", (r) => {
			if (r.status() >= 400) add(`net:${r.status()}`, `${r.request().method()} ${r.url()}`);
		});
		const main = t.app.process();
		main.stdout?.on("data", (d) => add("main", d));
		main.stderr?.on("data", (d) => add("main:err", d));
		// launchTill records print:receipt; record the other print channels too.
		await t.app.evaluate(({ ipcMain }) => {
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
	}

	await attach(await h.launchTill(profile, { fresh }));

	const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
	let done: () => void;
	const finished = new Promise<void>((r) => (done = r));
	const x = { net, tillSite, reconcile: () => reconcile(h.site!), suspicious };

	const server = createServer(async (req, res) => {
		const url = new URL(req.url || "/", "http://x");
		const reply = (code: number, body: unknown) => {
			res.writeHead(code, { "content-type": "application/json" });
			res.end(JSON.stringify(body, null, 1));
		};
		try {
			switch (url.pathname) {
				case "/log": {
					const out = log.slice(logRead);
					logRead = log.length;
					return reply(200, out);
				}
				case "/check": {
					const lines = suspicious(log.slice(checkRead));
					checkRead = log.length;
					return reply(200, {
						...(await reconcile(h.site!)),
						suspicious: lines,
						network: net.state(),
					});
				}
				case "/shot": {
					const path = join(SHOTS, `${url.searchParams.get("name") || Date.now()}.png`);
					await page.screenshot({ path });
					return reply(200, { path });
				}
				case "/restart": {
					await till.close();
					add("driver", "restart");
					await attach(await h.launchTill(profile, { fresh: false }));
					return reply(200, { ok: true });
				}
				case "/quit":
					reply(200, { ok: true });
					return done();
				case "/run": {
					let body = "";
					for await (const chunk of req) body += chunk;
					const fn = new AsyncFunction("page", "till", "site", "h", "x", body);
					const result = await fn(page, till, h.site, h, x);
					return reply(200, { result: result ?? null });
				}
			}
			reply(404, { error: "unknown" });
		} catch (e) {
			reply(500, { error: String((e as Error)?.stack || e) });
		}
	});
	server.listen(PORT, "127.0.0.1");
	console.log(`explore driver on http://127.0.0.1:${PORT}, profile ${profile}, till line ${net.url}`);
	await finished;
	server.close();
	await till.close();
	await net.close();
});
