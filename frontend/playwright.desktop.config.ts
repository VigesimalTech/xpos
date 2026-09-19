import { defineConfig } from "@playwright/test";

// Desktop end-to-end tests: Playwright starts the built Electron app (`yarn build:electron`)
// and works it as a cashier would, against a real ERPNext seeded by
// xpos/tests/round_trip.py. XPOS_RT_URL and XPOS_RT_CONFIG are the same as for
// `yarn test:roundtrip`; the till's own database is a fresh test_ database on the
// local MariaDB (XPOS_TEST_DB_*). See tests/desktop/README.md.
export default defineConfig({
	testDir: "tests/desktop/specs",
	outputDir: "test-results/desktop",
	// One till, one database, one server: the specs run one at a time.
	workers: 1,
	fullyParallel: false,
	timeout: 180_000,
	expect: { timeout: 20_000 },
	retries: 0,
	reporter: [["list"], ["html", { outputFolder: "playwright-report/desktop", open: "never" }]],
	use: {
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
});
