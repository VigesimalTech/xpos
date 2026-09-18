import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { pwaManifest } from "../pwa.manifest";

// Frappe serves the POS page at /xpos (website_route_rules in hooks.py) and
// redirects /xpos/ there. A browser offers to install the app, and lets the
// service worker control the page, only when that URL is inside the scope.
const PAGE_URL = "/xpos";
// The web build's public files are served from here (vite build --base).
const ASSET_BASE = "/assets/xpos/xpos/";
const ORIGIN = "https://pos.example.com";

const root = resolve(__dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

function inScope(url: string, scope: string): boolean {
	return new URL(url, ORIGIN).pathname.startsWith(new URL(scope, ORIGIN).pathname);
}

/** Resolve a manifest-relative URL the way the browser does. */
function fromManifest(src: string, manifestUrl: string): string {
	return new URL(src, new URL(manifestUrl, ORIGIN)).pathname;
}

function linkHref(rel: string): string {
	const match = read("index.html").match(new RegExp(`<link rel="${rel}" href="([^"]+)"`));
	expect(match, `index.html has no <link rel="${rel}">`).not.toBeNull();
	return match![1];
}

describe("the web POS can be installed as a PWA", () => {
	it("the page Frappe serves is inside the manifest scope", () => {
		expect(inScope(PAGE_URL, pwaManifest.scope!)).toBe(true);
	});

	it("the start URL is inside the scope and is not redirected", () => {
		expect(inScope(pwaManifest.start_url!, pwaManifest.scope!)).toBe(true);
		expect(pwaManifest.start_url).toBe(PAGE_URL);
	});

	it("the service worker is registered for the manifest scope, and the server allows it", () => {
		const registration = read("src/main.ts").match(
			/serviceWorker\s*\.register\("([^"]+)",\s*\{\s*scope:\s*"([^"]+)"/,
		);
		expect(registration).not.toBeNull();
		expect(registration![2]).toBe(pwaManifest.scope);

		const allowed = read("../xpos/pwa.py").match(/"Service-Worker-Allowed":\s*([A-Z_]+|"[^"]+")/);
		expect(allowed).not.toBeNull();
		const allowedValue = allowed![1].startsWith('"')
			? allowed![1].slice(1, -1)
			: read("../xpos/pwa.py").match(new RegExp(`${allowed![1]}\\s*=\\s*"([^"]+)"`))![1];
		expect(inScope(pwaManifest.scope!, allowedValue)).toBe(true);
	});

	it("the page links a manifest URL that resolves from /xpos", () => {
		const href = linkHref("manifest");
		// Relative to /xpos, "./manifest.webmanifest" is /manifest.webmanifest: a 404.
		expect(new URL(href, new URL(PAGE_URL, ORIGIN)).pathname).toBe("/xpos/manifest.webmanifest");
	});

	it("every manifest icon resolves to a file the build serves", () => {
		for (const icon of [...(pwaManifest.icons || []), ...(pwaManifest.screenshots || [])]) {
			const path = fromManifest(icon.src, "/xpos/manifest.webmanifest");
			expect(path.startsWith(ASSET_BASE), `${icon.src} resolves to ${path}`).toBe(true);
			expect(existsSync(resolve(root, "public", path.slice(ASSET_BASE.length)))).toBe(true);
		}
	});

	it("the apple-touch-icon resolves to a file the build serves", () => {
		const path = new URL(linkHref("apple-touch-icon"), new URL(PAGE_URL, ORIGIN)).pathname;
		expect(path.startsWith(ASSET_BASE), `resolves to ${path}`).toBe(true);
		expect(existsSync(resolve(root, "public", path.slice(ASSET_BASE.length)))).toBe(true);
	});
});
