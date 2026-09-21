import { defineConfig } from "@playwright/test";

// The exploratory driver (tests/desktop/explore/driver.spec.ts): one till, kept running,
// worked step by step. Same site and database settings as playwright.desktop.config.ts.
export default defineConfig({
	testDir: "tests/desktop/explore",
	outputDir: "test-results/explore-run",
	workers: 1,
	timeout: 0,
	retries: 0,
	reporter: [["list"]],
});
