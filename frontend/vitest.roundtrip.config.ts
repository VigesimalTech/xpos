import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Round-trip tests: the desktop sync engine and local database against a real
// Frappe + ERPNext + X POS site. CI seeds and serves the site
// (xpos/tests/round_trip.py); XPOS_RT_CONFIG points at what the seed wrote.
export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/roundtrip/**/*.spec.ts"],
		fileParallelism: false,
		setupFiles: ["tests/roundtrip/tillKeySetup.ts"],
		testTimeout: 120_000,
		hookTimeout: 120_000,
	},
	resolve: {
		alias: {
			electron: resolve(__dirname, "./tests/integration/support/electronShim.ts"),
		},
	},
});
