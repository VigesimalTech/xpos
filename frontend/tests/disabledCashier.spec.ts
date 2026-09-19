/**
 * @vitest-environment jsdom
 *
 * K24: a cashier disabled in ERPNext or removed from the POS Profile must not sign in
 * on the till, even offline with a cached password.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));
vi.mock("@/services/userRights", () => ({ loadPermissions: vi.fn(), resetPermissions: vi.fn() }));

import { useAuthStore } from "@/stores/authStore";

function makePosUser(overrides: Record<string, unknown> = {}) {
	return {
		name: "cashier@example.com",
		username: "cashier",
		full_name: "A Cashier",
		enabled: 1,
		password_hash: "hashed",
		...overrides,
	};
}

let db: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
	setActivePinia(createPinia());
	db = {
		getPosUser: vi.fn(async () => makePosUser()),
		verifyPassword: vi.fn(async () => true),
		cachePasswordFromServer: vi.fn(async () => ({ success: true })),
		setSetting: vi.fn(),
		verifyPin: vi.fn(async () => ({ ok: true })),
	};
	window.electronAPI = {
		db,
		startSyncEngine: vi.fn(async () => ({ success: true })),
	} as never;
});

describe("K24: a disabled cashier cannot sign in on the till", () => {
	it("refuses password sign-in when the user is disabled", async () => {
		db.getPosUser.mockResolvedValue(makePosUser({ enabled: 0 }));
		const auth = useAuthStore();
		const result = await auth.login("cashier", "password123");
		expect(result).toBe(false);
		expect(auth.error).toContain("disabled");
		expect(db.verifyPassword).not.toHaveBeenCalled();
	});

	it("refuses password sign-in when enabled is the string '0' (MariaDB TINYINT)", async () => {
		db.getPosUser.mockResolvedValue(makePosUser({ enabled: "0" }));
		const auth = useAuthStore();
		const result = await auth.login("cashier", "password123");
		expect(result).toBe(false);
		expect(auth.error).toContain("disabled");
	});

	it("allows password sign-in when the user is enabled", async () => {
		db.getPosUser.mockResolvedValue(makePosUser({ enabled: 1 }));
		const auth = useAuthStore();
		const result = await auth.login("cashier", "password123");
		expect(result).toBe(true);
	});

	it("allows password sign-in when enabled is not present (legacy rows)", async () => {
		const user = makePosUser();
		delete (user as Record<string, unknown>).enabled;
		db.getPosUser.mockResolvedValue(user);
		const auth = useAuthStore();
		const result = await auth.login("cashier", "password123");
		expect(result).toBe(true);
	});
});
