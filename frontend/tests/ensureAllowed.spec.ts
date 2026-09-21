/**
 * @vitest-environment jsdom
 *
 * K19: an action the cashier's role does not allow is not hidden on the desktop till; it
 * asks for a manager's PIN. On the web POS it is refused, as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const perms = vi.hoisted(() => ({ value: {} as Record<string, boolean> }));
vi.mock("@/services/userRights", () => ({ hasPermission: (k: string) => perms.value[k] ?? false }));
const approval = vi.hoisted(() => ({ requestApproval: vi.fn() }));
vi.mock("@/stores/approvalStore", () => ({ useApprovalStore: () => approval }));

import { ensureAllowed } from "@/services/ensureAllowed";

beforeEach(() => {
	perms.value = {};
	approval.requestApproval.mockReset();
	window.electronAPI = { approval: {} } as never;
});

describe("K19: ask a manager rather than refuse", () => {
	it("goes ahead when the cashier's role allows it", async () => {
		perms.value.close_shift = true;
		expect(await ensureAllowed("close_shift", "Closing the shift")).toEqual({ ok: true });
		expect(approval.requestApproval).not.toHaveBeenCalled();
	});

	it("asks a manager otherwise, and says who approved", async () => {
		approval.requestApproval.mockResolvedValue("manager@example.com");
		expect(await ensureAllowed("close_shift", "Closing the shift")).toEqual({
			ok: true,
			approvedBy: "manager@example.com",
		});
		expect(approval.requestApproval).toHaveBeenCalledWith(
			{ permission: "close_shift" },
			"Closing the shift",
		);
	});

	it("does not go ahead when the approval is cancelled", async () => {
		approval.requestApproval.mockResolvedValue(null);
		expect(await ensureAllowed("allow_reprint_invoice", "A reprint")).toEqual({ ok: false });
	});

	it("refuses on the web POS, where no PIN can be checked", async () => {
		window.electronAPI = undefined as never;
		expect(await ensureAllowed("close_shift", "Closing the shift")).toEqual({ ok: false });
		expect(approval.requestApproval).not.toHaveBeenCalled();
	});
});
