/**
 * @vitest-environment jsdom
 *
 * A report that needs a permission the cashier's POS Role lacks follows the POS Profile's
 * Screens the Role Lacks, as the screens do (K27): hidden, or, with Show, Ask a Manager,
 * listed and opened with a manager's PIN on the till. They were listed as Locked, and
 * could not be opened, whatever it said.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const perms = vi.hoisted(() => ({ value: {} as Record<string, boolean> }));
vi.mock("@/services/userRights", () => ({
	hasPermission: (k: string) => perms.value[k] ?? false,
	canDoOrAsk: (k: string) => (perms.value[k] ?? false) || !!window.electronAPI,
}));
const pos = vi.hoisted(() => ({ askForScreens: false }));
vi.mock("@/stores/posStore", () => ({ usePosStore: () => pos }));
const approval = vi.hoisted(() => ({ requestApproval: vi.fn() }));
vi.mock("@/stores/approvalStore", () => ({ useApprovalStore: () => approval }));

import { approveReport, getReportDefinition, isReportOffered } from "@/services/reports";

const shiftReport = getReportDefinition("pos-shift-reconciliation")!;
const openReport = getReportDefinition("dead-stock-report")!;

beforeEach(() => {
	perms.value = {};
	pos.askForScreens = false;
	approval.requestApproval.mockReset();
	approval.requestApproval.mockResolvedValue(null);
	window.electronAPI = { approval: {} } as never;
});

describe("a report the role lacks", () => {
	it("Hide: is not listed and does not open", async () => {
		expect(isReportOffered(shiftReport)).toBe(false);
		expect(await approveReport(shiftReport)).toBe(false);
		expect(approval.requestApproval).not.toHaveBeenCalled();
	});

	it("Show, Ask a Manager: is listed and opens once a manager approves", async () => {
		pos.askForScreens = true;
		approval.requestApproval.mockResolvedValue("manager@shop");
		expect(isReportOffered(shiftReport)).toBe(true);
		expect(await approveReport(shiftReport)).toBe(true);
		expect(approval.requestApproval).toHaveBeenCalledWith(
			{ permission: "shift_report" },
			"Open Shift Reconciliation",
		);
	});

	it("Show, Ask a Manager: no approval, no report", async () => {
		pos.askForScreens = true;
		expect(await approveReport(shiftReport)).toBe(false);
	});

	it("the web POS has no PIN: it stays hidden there", async () => {
		window.electronAPI = undefined;
		pos.askForScreens = true;
		expect(isReportOffered(shiftReport)).toBe(false);
		expect(await approveReport(shiftReport)).toBe(false);
	});
});

describe("a report the role has, or one that needs no permission", () => {
	it("is listed and opens without asking", async () => {
		perms.value.shift_report = true;
		expect(isReportOffered(shiftReport)).toBe(true);
		expect(await approveReport(shiftReport)).toBe(true);
		expect(isReportOffered(openReport)).toBe(true);
		expect(await approveReport(openReport)).toBe(true);
		expect(approval.requestApproval).not.toHaveBeenCalled();
	});
});
