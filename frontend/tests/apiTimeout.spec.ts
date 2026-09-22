/**
 * @vitest-environment jsdom
 *
 * A call to ERPNext that is never answered (a dead Wi-Fi link) counts as offline after a
 * time limit, instead of leaving the screen waiting for ever (found by the bug hunt).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/composables/useToast", () => ({ showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() }));
vi.mock("@/utils", () => ({ isOnline: () => true, isNetworkError: () => false }));
vi.mock("@/services/electronBridge", () => ({
	isElectron: () => false,
	getApiBaseUrlSync: () => "",
	getApiCredentialsSync: () => ({}),
}));
vi.mock("@/services/errorLog", () => ({ captureError: vi.fn() }));
vi.mock("@/services/idbService", () => ({ getMeta: vi.fn() }));
vi.mock("@/composables/useCurrency", () => ({ formatWithSymbol: vi.fn() }));

import { call, REQUEST_TIMEOUT_MS } from "@/services/api";

/** A fetch that never answers, but gives up when its signal is aborted, as the browser's does. */
const silentFetch = vi.fn(
	(_url: string, init: RequestInit) =>
		new Promise<Response>((_resolve, reject) => {
			init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
		}),
);

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("fetch", silentFetch);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("a call nobody answers", () => {
	it("counts as offline once the time limit passes", async () => {
		const answer = call("xpos.api.anything").catch((e: Error) => e.message);
		await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
		let settled = false;
		void answer.then(() => (settled = true));
		await Promise.resolve();
		expect(settled).toBe(false);

		await vi.advanceTimersByTimeAsync(2);
		await expect(answer).resolves.toBe("__offline__");
	});
});
