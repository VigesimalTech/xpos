/**
 * @vitest-environment jsdom
 *
 * K27: a screen the cashier's POS Role lacks is hidden, or, when the POS Profile says
 * Show, Ask a Manager, offered and opened with a manager's PIN on the till. Purchasing
 * also needs the POS Profile's Allow Purchasing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const perms = vi.hoisted(() => ({ value: {} as Record<string, boolean> }));
vi.mock("@/services/userRights", () => ({
	hasPermission: (k: string) => perms.value[k] ?? false,
	canDoOrAsk: (k: string) => (perms.value[k] ?? false) || !!window.electronAPI,
}));
const pos = vi.hoisted(() => ({
	askForScreens: false,
	allowPurchasing: false,
	allowPosExpense: false,
	allowCashDeposit: false,
}));
vi.mock("@/stores/posStore", () => ({ usePosStore: () => pos }));
const approval = vi.hoisted(() => ({ requestApproval: vi.fn() }));
vi.mock("@/stores/approvalStore", () => ({ useApprovalStore: () => approval }));

import { canOpenScreen, openScreen, screenOfRoute } from "@/services/screenAccess";

const onTheTill = () => (window.electronAPI = { approval: {} } as never);
const onTheWeb = () => (window.electronAPI = undefined);

beforeEach(() => {
	perms.value = {};
	Object.assign(pos, {
		askForScreens: false,
		allowPurchasing: false,
		allowPosExpense: false,
		allowCashDeposit: false,
	});
	approval.requestApproval.mockReset();
	approval.requestApproval.mockResolvedValue(null);
	onTheTill();
});

describe("K27: screens the cashier's role lacks", () => {
	it("a role with the permission sees the screen and opens it without asking", async () => {
		perms.value.view_reports = true;
		expect(canOpenScreen("reports")).toBe(true);
		expect(await openScreen("reports")).toBe(true);
		expect(approval.requestApproval).not.toHaveBeenCalled();
	});

	it("Hide: without the permission the screen is not offered and does not open", async () => {
		expect(canOpenScreen("reports")).toBe(false);
		expect(canOpenScreen("barcode_printer")).toBe(false);
		expect(await openScreen("reports")).toBe(false);
		expect(approval.requestApproval).not.toHaveBeenCalled();
	});

	it("Show, Ask a Manager: the screen is offered and opens once a manager approves", async () => {
		pos.askForScreens = true;
		approval.requestApproval.mockResolvedValue("manager@shop");
		expect(canOpenScreen("reports")).toBe(true);
		expect(await openScreen("reports")).toBe(true);
		expect(approval.requestApproval).toHaveBeenCalledWith({ permission: "view_reports" }, "Open Reports");
	});

	it("Show, Ask a Manager: no approval, no screen", async () => {
		pos.askForScreens = true;
		expect(await openScreen("barcode_printer")).toBe(false);
	});

	it("the web POS has no PIN: Show, Ask a Manager hides the screen there", async () => {
		onTheWeb();
		pos.askForScreens = true;
		expect(canOpenScreen("reports")).toBe(false);
		expect(await openScreen("reports")).toBe(false);
	});
});

describe("K27: purchasing (D7)", () => {
	it("is hidden from everyone while the POS Profile does not allow it", async () => {
		perms.value.purchasing = true;
		pos.askForScreens = true;
		expect(canOpenScreen("purchasing")).toBe(false);
		expect(await openScreen("purchasing")).toBe(false);
	});

	it("once allowed, follows the role like any other screen", async () => {
		pos.allowPurchasing = true;
		expect(canOpenScreen("purchasing")).toBe(false);
		perms.value.purchasing = true;
		expect(canOpenScreen("purchasing")).toBe(true);
	});
});

describe("K27: screens for an action stay offered to ask a manager (D8)", () => {
	it("expenses show when the POS Profile allows them, whatever the role", () => {
		expect(canOpenScreen("expenses")).toBe(false);
		pos.allowPosExpense = true;
		expect(canOpenScreen("expenses")).toBe(true);
	});

	it("on the web they follow the role", () => {
		onTheWeb();
		pos.allowCashDeposit = true;
		expect(canOpenScreen("bank_drops")).toBe(false);
		perms.value.bank_drop = true;
		expect(canOpenScreen("bank_drops")).toBe(true);
	});
});

describe("K27: every way into a screen is covered by the router", () => {
	it("maps each gated route to its screen", () => {
		expect(screenOfRoute("report-viewer")).toBe("reports");
		expect(screenOfRoute("purchase-invoice")).toBe("purchasing");
		expect(screenOfRoute("stock-receiving")).toBe("purchasing");
		expect(screenOfRoute("price-checker")).toBe("price_checker");
		expect(screenOfRoute("pos")).toBeUndefined();
	});
});
