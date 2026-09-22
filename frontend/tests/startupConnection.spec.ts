/**
 * @vitest-environment jsdom
 *
 * A till whose database answers late at start, as after a power cut. The screens read the
 * server's address and the API keys from that database, once: asked before it answered,
 * the address came back as the default http://localhost:8000 and the keys as nothing, for
 * the whole session. Receipt layouts, pricing rules and settings went nowhere (bug hunt,
 * release sweep, 22 Sep 2026). Once the till is ready, they are read again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkSetupState, resetSetupState } from "@/router/setupGuard";
import { getApiBaseUrlSync, getApiCredentialsSync } from "@/services/electronBridge";

const state = { setup: "waiting-for-database", dbUp: false };

beforeEach(() => {
	state.setup = "waiting-for-database";
	state.dbUp = false;
	resetSetupState();
	window.electronAPI = {
		getSetupState: async () => state.setup,
		getServerUrl: async () => (state.dbUp ? "https://erp.example.com" : "http://localhost:8000"),
		db: { getMeta: async (key: string) => (state.dbUp ? `${key}-value` : null) },
	} as never;
});

describe("a till whose database answers late", () => {
	it("talks to its own ERPNext, with its keys, once the database is up", async () => {
		// What src/main.ts asks at start, before the database answers.
		const bridge = await import("@/services/electronBridge");
		await bridge.getApiBaseUrl();
		await bridge.warmApiCredentials();
		expect(await checkSetupState()).toBe("waiting-for-database");

		state.dbUp = true;
		state.setup = "ready";
		expect(await checkSetupState()).toBe("ready");

		expect(getApiBaseUrlSync()).toBe("https://erp.example.com");
		expect(getApiCredentialsSync()).toEqual({ apiKey: "api_key-value", apiSecret: "api_secret-value" });
	});
});
