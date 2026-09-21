/**
 * @vitest-environment jsdom
 *
 * K19: a manager approves on the till, with their PIN, what the cashier may not do alone.
 * Anything that needs approval asks through `requestApproval` and gets the approver's
 * name back, or null.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/services/api", () => ({ call: vi.fn(), default: { call: vi.fn() } }));

import ManagerApprovalDialog from "@/components/dialogs/ManagerApprovalDialog.vue";
import { useApprovalStore } from "@/stores/approvalStore";
import { useAuthStore } from "@/stores/authStore";
import { usePosStore } from "@/stores/posStore";

const MANAGER = { name: "manager@example.com", full_name: "Mo Manager" };
const LEAD = { name: "lead@example.com", full_name: "Lee Lead" };

let approval: Record<string, ReturnType<typeof vi.fn>>;

function mountDialog() {
	return mount(ManagerApprovalDialog, { attachTo: document.body });
}

/** The dialog renders in a portal: find things in the document. */
const $ = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => Array.from(document.body.querySelectorAll<HTMLElement>(selector));

async function tap(selector: string) {
	$(selector)!.click();
	await flushPromises();
}

async function tapPin(pin: string) {
	for (const digit of pin) await tap(`[data-pin-key="${digit}"]`);
}

beforeEach(() => {
	document.body.innerHTML = "";
	setActivePinia(createPinia());
	approval = {
		approvers: vi.fn(async () => [MANAGER, LEAD]),
		verify: vi.fn(async (approver: string, pin: string) =>
			pin === "2222" ? { ok: true, approver } : { ok: false, reason: "wrong_pin", attemptsLeft: 4 },
		),
	};
	window.electronAPI = { approval } as never;
	useAuthStore().$patch({ user: { user: "cashier@example.com" } } as never);
	usePosStore().$patch({ posProfile: { name: "Shop POS" } } as never);
});

describe("K19: the manager-approval dialog", () => {
	it("asks for the approval, and returns the approver when the PIN is right", async () => {
		mountDialog();
		const answer = useApprovalStore().requestApproval(
			{ discountPct: 25 },
			"25% off, over your 10% limit",
		);
		await flushPromises();

		expect(document.body.textContent).toContain("25% off, over your 10% limit");
		expect(approval.approvers).toHaveBeenCalledWith(
			expect.objectContaining({
				cashier: "cashier@example.com",
				posProfile: "Shop POS",
				discountPct: 25,
			}),
		);
		expect($$("[data-approver]").map((b) => b.textContent)).toEqual([
			expect.stringContaining("Mo Manager"),
			expect.stringContaining("Lee Lead"),
		]);

		await tap('[data-approver="manager@example.com"]');
		await tapPin("2222");
		await tap("[data-pin-submit]");

		expect(approval.verify).toHaveBeenCalledWith(
			"manager@example.com",
			"2222",
			expect.objectContaining({ discountPct: 25 }),
		);
		expect(await answer).toBe("manager@example.com");
		expect(useApprovalStore().open).toBe(false);
	});

	it("says how many tries are left after a wrong PIN, and stays open", async () => {
		mountDialog();
		const answer = useApprovalStore().requestApproval({ permission: "sale_return" }, "A return");
		await flushPromises();

		await tap('[data-approver="manager@example.com"]');
		await tapPin("9999");
		await tap("[data-pin-submit]");

		expect(document.body.textContent).toContain("4 tries left");
		expect(useApprovalStore().open).toBe(true);

		await tapPin("2222");
		await tap("[data-pin-submit]");
		expect(await answer).toBe("manager@example.com");
	});

	it("returns nothing when the cashier cancels", async () => {
		mountDialog();
		const answer = useApprovalStore().requestApproval({ permission: "expense" }, "An expense");
		await flushPromises();

		await tap("[data-approval-cancel]");

		expect(await answer).toBeNull();
		expect(useApprovalStore().open).toBe(false);
	});

	it("says when no one on this till can approve it", async () => {
		approval.approvers.mockResolvedValue([]);
		mountDialog();
		const answer = useApprovalStore().requestApproval({ discountPct: 90 }, "90% off");
		await flushPromises();

		expect(document.body.textContent).toContain("No one on this till can approve this");
		await tap("[data-approval-cancel]");
		expect(await answer).toBeNull();
	});

	it("is not offered on the web POS, where no PIN can be checked", async () => {
		window.electronAPI = undefined as never;
		expect(await useApprovalStore().requestApproval({ discountPct: 25 }, "25% off")).toBeNull();
		expect(useApprovalStore().open).toBe(false);
	});
});
