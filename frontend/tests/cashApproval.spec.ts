/**
 * @vitest-environment jsdom
 *
 * K19: an expense or bank drop by a cashier whose role does not allow it needs a manager's
 * PIN on the till; the approver goes with the record to ERPNext.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const perms = vi.hoisted(() => ({ value: {} as Record<string, boolean> }));
vi.mock("@/services/userRights", () => ({ hasPermission: (k: string) => perms.value[k] ?? false }));
const approval = vi.hoisted(() => ({ requestApproval: vi.fn() }));
vi.mock("@/stores/approvalStore", () => ({ useApprovalStore: () => approval }));

import { approveCashMovement } from "@/services/cashApproval";

beforeEach(() => {
	perms.value = {};
	approval.requestApproval.mockReset();
	window.electronAPI = { approval: {} } as never;
});

describe("K19: cash out of the drawer needs the right, or a manager", () => {
	it("goes ahead without asking when the cashier's role allows it", async () => {
		perms.value.expense = true;
		expect(await approveCashMovement("expense", 20)).toEqual({ ok: true });
		expect(approval.requestApproval).not.toHaveBeenCalled();
	});

	it("asks a manager for an expense the cashier may not record, and names them", async () => {
		approval.requestApproval.mockResolvedValue("manager@example.com");
		expect(await approveCashMovement("expense", 20)).toEqual({
			ok: true,
			approvedBy: "manager@example.com",
		});
		expect(approval.requestApproval).toHaveBeenCalledWith(
			{ permission: "expense" },
			expect.stringContaining("20"),
		);
	});

	it("asks for Bank Drop for a bank drop", async () => {
		approval.requestApproval.mockResolvedValue("manager@example.com");
		await approveCashMovement("bank_drop", 500);
		expect(approval.requestApproval).toHaveBeenCalledWith(
			{ permission: "bank_drop" },
			expect.any(String),
		);
	});

	it("records nothing when the approval is cancelled", async () => {
		approval.requestApproval.mockResolvedValue(null);
		expect(await approveCashMovement("expense", 20)).toEqual({ ok: false });
	});
});
