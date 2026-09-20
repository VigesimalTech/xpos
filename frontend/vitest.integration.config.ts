import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Main-process integration tests: the sync engine and local database under
// Node, with `electron` replaced by a shim and a real MariaDB underneath.
export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/integration/**/*.spec.ts"],
		// One MariaDB database is shared, so test files must not run at once.
		fileParallelism: false,
		testTimeout: 30_000,
		hookTimeout: 60_000,
	},
	resolve: {
		alias: {
			electron: resolve(__dirname, "./tests/integration/support/electronShim.ts"),
			"@": resolve(__dirname, "./src"),
		},
	},
});
