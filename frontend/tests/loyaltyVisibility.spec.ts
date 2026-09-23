/**
 * @vitest-environment jsdom
 *
 * The cart's Loyalty Program button, where a cashier enrols a customer or unenrols them,
 * follows the POS Profile's Show Loyalty Program. It is off by default: a shop may run a
 * programme in ERPNext without enrolling at the till (asked for 23 Sep 2026). Points a
 * customer already has are still redeemed at payment, which follows the points, not this.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/electronBridge", () => ({ isElectron: () => true, setTillIdentity: vi.fn() }));

import { usePosStore } from "@/stores/posStore";

beforeEach(() => setActivePinia(createPinia()));

const withProfile = (profile: Record<string, unknown> | null) => {
	const pos = usePosStore();
	pos.posProfile = profile as never;
	return pos;
};

describe("the cart's Loyalty Program button", () => {
	it("is off on a profile that does not ask for it", () => {
		expect(withProfile({ name: "Shop 1" }).showLoyalty).toBe(false);
		expect(withProfile({ name: "Shop 1", xpos_show_loyalty: 0 }).showLoyalty).toBe(false);
	});

	it("is on where the profile asks for it", () => {
		expect(withProfile({ name: "Shop 1", xpos_show_loyalty: 1 }).showLoyalty).toBe(true);
	});

	it("is off before a shift opens, with no profile at all", () => {
		expect(withProfile(null).showLoyalty).toBe(false);
	});
});
