import type { GenerateSWOptions } from "workbox-build";

// Workbox settings for the web POS service worker. Kept out of vite.config.ts
// so tests can check them against the routes Frappe serves.
//
// Frappe renders the POS page (per user, with boot data), so it is not in the
// precache and cannot be a navigateFallback: Workbox throws non-precached-url
// while the worker loads and the worker never installs. Pages under /xpos are
// cached at runtime instead, network first, and any screen not yet cached
// falls back to the cached /xpos page (the app routes on the client).
// Match functions and plugins are serialised into sw.js, so they must not
// refer to anything outside themselves.
export const pwaWorkbox: Partial<GenerateSWOptions> = {
	navigateFallback: null,
	// Control the page from the first visit, so it can be cached then
	// (see warmAppShell), not only after a second online visit.
	clientsClaim: true,
	skipWaiting: true,
	globPatterns: ["**/*.{js,css,svg,png,ico,woff,woff2,ttf,eot}"],
	globIgnores: ["**/index.html"],
	modifyURLPrefix: { "": "/assets/xpos/xpos/" },
	maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
	runtimeCaching: [
		{
			// The POS page and every client-side screen under it; not the worker,
			// manifest or other files Frappe serves from /xpos/.
			urlPattern: ({ url }) =>
				url.pathname === "/xpos" ||
				(url.pathname.startsWith("/xpos/") && !/\.[a-z0-9]+$/i.test(url.pathname)),
			handler: "NetworkFirst",
			options: {
				cacheName: "xpos-html-cache",
				plugins: [
					{
						// Offline, on a screen never loaded online: serve the cached POS page.
						handlerDidError: async () =>
							(await caches.match("/xpos", { ignoreSearch: true })) ?? undefined,
					},
				],
				expiration: {
					maxEntries: 5,
					maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
				},
				networkTimeoutSeconds: 3,
				cacheableResponse: {
					statuses: [0, 200],
				},
			},
		},
		{
			urlPattern: /^https?:\/\/.*\/api\/method\//,
			handler: "NetworkFirst",
			method: "GET",
			options: {
				cacheName: "xpos-api-cache",
				expiration: {
					maxEntries: 200,
					maxAgeSeconds: 60 * 60 * 24, // 24 hours
				},
				networkTimeoutSeconds: 5,
				cacheableResponse: {
					statuses: [0, 200],
				},
			},
		},
		{
			urlPattern: /^https?:\/\/.*\/assets\//,
			handler: "CacheFirst",
			options: {
				cacheName: "xpos-assets-cache",
				expiration: {
					maxEntries: 200,
					maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
				},
				cacheableResponse: {
					statuses: [0, 200],
				},
			},
		},
		{
			urlPattern: /^https?:\/\/.*\/files\//,
			handler: "CacheFirst",
			options: {
				cacheName: "xpos-files-cache",
				expiration: {
					maxEntries: 100,
					maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
				},
				cacheableResponse: {
					statuses: [0, 200],
				},
			},
		},
	],
};
