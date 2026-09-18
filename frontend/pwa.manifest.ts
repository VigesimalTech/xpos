import type { ManifestOptions } from "vite-plugin-pwa";

// The web app manifest for installing X POS as a PWA. Kept out of
// vite.config.ts so tests can check it against the route Frappe serves.
//
// Frappe serves the page at /xpos and redirects /xpos/ there, so the scope
// and start URL are /xpos: with /xpos/ the page sat outside its own scope,
// was never installable and was never controlled by the service worker.
// Icons are absolute because the manifest is served from /xpos/ while the
// files are built under /assets/xpos/xpos/.
const ASSETS = "/assets/xpos/xpos/";

export const pwaManifest: Partial<ManifestOptions> = {
	name: "X POS - Point of Sale",
	short_name: "X POS",
	description: "Modern Point of Sale application with offline support",
	theme_color: "#f97316",
	background_color: "#ffffff",
	display: "standalone",
	orientation: "any",
	scope: "/xpos",
	start_url: "/xpos",
	id: "/xpos/",
	categories: ["business", "finance"],
	icons: [
		{
			src: `${ASSETS}pwa-192x192.svg`,
			sizes: "192x192",
			type: "image/svg+xml",
		},
		{
			src: `${ASSETS}pwa-512x512.svg`,
			sizes: "512x512",
			type: "image/svg+xml",
		},
		{
			src: `${ASSETS}pwa-512x512.svg`,
			sizes: "512x512",
			type: "image/svg+xml",
			purpose: "any maskable",
		},
	],
	screenshots: [
		{
			src: `${ASSETS}pwa-512x512.svg`,
			sizes: "512x512",
			type: "image/svg+xml",
			form_factor: "wide",
			label: "X POS Dashboard",
		},
		{
			src: `${ASSETS}pwa-512x512.svg`,
			sizes: "512x512",
			type: "image/svg+xml",
			form_factor: "narrow",
			label: "X POS Mobile",
		},
	],
};
