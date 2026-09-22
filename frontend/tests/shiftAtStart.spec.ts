/**
 * @vitest-environment jsdom
 *
 * A till restarted mid-shift, signed back in as its last cashier while it starts. The
 * shift was looked up before that cashier was known, as "Guest", so none was found and the
 * till asked to open a shift, discarding the count typed in (bug hunt, release sweep,
 * 22 Sep 2026). Before the cashier is known it decides nothing; once they are, it finds
 * their shift.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/services/dbBridge", () => ({
	cachePOSData: vi.fn(),
	getCachedPOSData: vi.fn(),
	cacheReceiptContext: vi.fn(),
}));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true, setTillIdentity: vi.fn() }));
vi.mock("@/utils", () => ({ isOnline: () => true, isNetworkError: () => false }));
vi.mock("@/stores/settingsStore", () => ({
	useSettingsStore: () => ({ fetchSettings: vi.fn().mockResolvedValue(undefined), reset: vi.fn() }),
}));
const auth = vi.hoisted(() => ({ userName: "Guest" }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => auth }));

import { usePosStore } from "@/stores/posStore";

const checkOpenShift = vi.fn();

beforeEach(() => {
	setActivePinia(createPinia());
	checkOpenShift.mockReset();
	checkOpenShift.mockResolvedValue({
		pos_opening_shift: { name: "1" },
		pos_profile: { name: "Shop 1" },
		company: { name: "Test Co" },
	});
	window.electronAPI = { db: { checkOpenShift, getPosUser: async () => null } } as never;
	globalThis.__ = ((text: string) => text) as never;
});

describe("the open shift, at start", () => {
	it("is not looked up, and no new shift is offered, before the cashier is known", async () => {
		auth.userName = "Guest";
		const pos = usePosStore();
		await pos.checkExistingShift();
		expect(checkOpenShift).not.toHaveBeenCalled();
		expect(pos.showOpeningDialog).toBe(false);
	});

	it("is found once the cashier is known", async () => {
		auth.userName = "cashier@example.com";
		const pos = usePosStore();
		await pos.checkExistingShift();
		expect(checkOpenShift).toHaveBeenCalledWith("cashier@example.com");
		expect(pos.showOpeningDialog).toBe(false);
		expect(pos.posOpeningShift).toMatchObject({ name: "1" });
	});
});
