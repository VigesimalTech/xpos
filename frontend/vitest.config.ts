import { configDefaults, defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
	plugins: [vue()],
	test: {
		globals: true,
		environment: "jsdom",
		include: ["tests/**/*.spec.ts", "tests/**/*.test.ts"],
		// Main-process tests need MariaDB; they run with vitest.integration.config.ts.
		// tests/desktop is Playwright driving the built app (playwright.desktop.config.ts).
		exclude: [
			...configDefaults.exclude,
			"tests/integration/**",
			"tests/roundtrip/**",
			"tests/desktop/**",
		],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
		},
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
});
