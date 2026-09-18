/**
 * @vitest-environment jsdom
 *
 * The service worker has to install, and then serve the POS page when the
 * till is offline: at /xpos and at any screen under it, from the first visit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeCaching } from "workbox-build";
import { pwaWorkbox } from "../pwa.workbox";
import { warmAppShell } from "@/services/pwaShell";

const ORIGIN = "https://pos.example.com";

type Matcher = (ctx: { url: URL; request: { mode: string; destination: string } }) => boolean;

/** The runtime-caching rule that serves POS pages, found by what it matches. */
function pageRule(): RuntimeCaching {
	const rule = (pwaWorkbox.runtimeCaching || []).find((r) => matchesPage(r, "/xpos"));
	expect(rule, "no runtime-caching rule serves /xpos").toBeDefined();
	return rule!;
}

function matchesPage(rule: RuntimeCaching, path: string, mode = "navigate"): boolean {
	const url = new URL(path, ORIGIN);
	const pattern = rule.urlPattern;
	if (pattern instanceof RegExp) return pattern.test(url.href);
	if (typeof pattern === "function")
		return (pattern as unknown as Matcher)({ url, request: { mode, destination: "document" } });
	return false;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("O1: the POS page opens offline", () => {
	it("the worker installs: it does not route pages to a file it has not precached", () => {
		// vite-plugin-pwa defaults navigateFallback to index.html, but the build does
		// not precache index.html (Frappe renders the page). Workbox then throws
		// non-precached-url while the worker loads, so it never installs.
		const fallback = pwaWorkbox.navigateFallback;
		const ignored = (pwaWorkbox.globIgnores || []).some((g) => g.includes("index.html"));
		expect(fallback === null || (fallback !== undefined && !ignored)).toBe(true);
	});

	it.each(["/xpos", "/xpos/", "/xpos/pos", "/xpos/login?redirect=%2Fxpos%2Fpos"])(
		"serves %s network-first, from cache when offline",
		(path) => {
			const rule = pageRule();
			expect(matchesPage(rule, path)).toBe(true);
			expect(rule.handler).toBe("NetworkFirst");
		},
	);

	it.each([
		"/xpos/sw.js",
		"/xpos/manifest.webmanifest",
		"/xpos/workbox-1a2b3c.js",
		"/xposition",
		"/api/method/frappe.ping",
		"/assets/xpos/xpos/assets/index.js",
	])("does not treat %s as a POS page", (path) => {
		expect(matchesPage(pageRule(), path)).toBe(false);
	});

	it("opens a screen never visited online from the cached POS page", async () => {
		const cached = new Response("<html>POS</html>");
		const match = vi.fn(async (url: string) => (url === "/xpos" ? cached : undefined));
		vi.stubGlobal("caches", { match });

		const plugin = (pageRule().options?.plugins || []).find((p) => p.handlerDidError);
		expect(plugin, "no fallback when the network and the cache both miss").toBeDefined();
		const response = await plugin!.handlerDidError!({
			request: new Request(`${ORIGIN}/xpos/pos`),
		} as never);

		expect(response).toBe(cached);
	});

	it("takes control of the page on the first visit", () => {
		expect(pwaWorkbox.clientsClaim).toBe(true);
	});
});

describe("O1: the page is cached on the first visit", () => {
	it("fetches the POS page once the worker controls it, so it is in the cache", async () => {
		const fetchMock = vi.fn(async () => new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);
		const sw = { controller: {}, addEventListener: vi.fn() };

		await warmAppShell(sw as never);

		expect(fetchMock).toHaveBeenCalledWith(
			"/xpos",
			expect.objectContaining({ credentials: "same-origin" }),
		);
	});

	it("waits for the worker to take control first", async () => {
		const fetchMock = vi.fn(async () => new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);
		let onChange: () => void = () => {};
		const sw = {
			controller: null,
			addEventListener: vi.fn((_: string, cb: () => void) => (onChange = cb)),
		};

		const done = warmAppShell(sw as never);
		expect(fetchMock).not.toHaveBeenCalled();
		onChange();
		await done;

		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
