/**
 * @vitest-environment jsdom
 *
 * An approval that covers several permissions at once (a discount the role may not give,
 * over the cashier's limit). The request kept its list of permissions as a reactive proxy,
 * which Electron cannot send to the main process ("An object could not be cloned"): the
 * lookup of approvers failed and the cashier was told no one could approve (release sweep,
 * 22 Sep 2026). What goes to the main process must be plain data.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ userName: "cashier@example.com" }) }));
vi.mock("@/stores/posStore", () => ({
	usePosStore: () => ({ posProfile: { name: "Shop 1" }, posOpeningShift: { name: "3" } }),
}));

import { useApprovalStore } from "@/stores/approvalStore";

const sent: unknown[] = [];

beforeEach(() => {
	setActivePinia(createPinia());
	sent.length = 0;
	window.electronAPI = {
		approval: {
			// As Electron's IPC does: the argument is structured-cloned.
			approvers: async (ask: unknown) => {
				sent.push(structuredClone(ask));
				return [{ name: "manager@example.com", full_name: "Manager" }];
			},
			verify: async (_a: string, _p: string, ask: unknown) => {
				sent.push(structuredClone(ask));
				return { ok: true, approver: "manager@example.com" };
			},
		},
	} as never;
});

describe("an approval for several permissions", () => {
	it("reaches the main process and lists who may approve", async () => {
		const store = useApprovalStore();
		store.requestApproval(
			{ permissions: ["show_edit_discount_field", "allow_change_price"], discountPct: 20 },
			"why",
		);
		await vi.waitFor(() => expect(store.loading).toBe(false));
		expect(store.approvers.map((a) => a.name)).toEqual(["manager@example.com"]);
		expect(sent[0]).toMatchObject({
			permissions: ["show_edit_discount_field", "allow_change_price"],
			cashier: "cashier@example.com",
			posProfile: "Shop 1",
		});
		await store.verify("manager@example.com", "1234");
		expect(sent).toHaveLength(2);
	});
});
