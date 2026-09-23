/**
 * K21: a blind cash-up. With the POS Profile's Hide Expected Amount the cashier counts the
 * drawer without seeing what it should hold, starting from an empty count; the difference
 * is left for the supervisor, in ERPNext and the exceptions report. The printed close
 * leaves them out too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";

const pos = reactive({
	hideExpectedAmount: false,
	showClosingDialog: true,
	invoiceCurrency: "USD",
	cashModeOfPayment: "Cash",
	profileName: "Shop 1",
	posOpeningShift: { name: "POS-OS-1", user: "ann@example.com" },
	fetchClosingData: vi.fn(async () => ({
		total_invoices: 3,
		grand_total: 150,
		expected_amounts: { Cash: { amount: 250, currency: "USD" } },
		opening_balances: { Cash: { amount: 100, currency: "USD" } },
	})),
	closeShift: vi.fn(),
});

vi.mock("@/stores/posStore", () => ({ usePosStore: () => pos }));
vi.mock("@/services/api", () => ({ call: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock("@/services/electronBridge", () => ({ isElectron: () => true }));
vi.mock("@/services/ensureAllowed", () => ({ ensureAllowed: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/composables/useMoney", () => ({ useMoney: () => ({ money: (n: number) => String(n) }) }));
vi.mock("@/components/help/HelpLink.vue", () => ({ default: { template: "<span />" } }));

import ClosingDialog from "@/components/dialogs/ClosingDialog.vue";
import { buildShiftSummaryHtml } from "@/services/receiptTemplate";

async function open() {
	const wrapper = mount(ClosingDialog, { attachTo: document.body });
	await flushPromises();
	return wrapper;
}

const cells = (testid: string) => document.body.querySelectorAll(`[data-testid="${testid}"]`);

beforeEach(() => {
	document.body.innerHTML = "";
	pos.hideExpectedAmount = false;
});

describe("closing a shift", () => {
	it("shows what is expected and starts the count from it, as before", async () => {
		const wrapper = await open();
		expect(cells("closing-expected")).toHaveLength(1);
		expect(cells("closing-difference")).toHaveLength(1);
		expect((cells("closing-input")[0] as HTMLInputElement).value).toContain("250");
		wrapper.unmount();
	});

	it("blind, hides what is expected and the difference, and starts the count empty", async () => {
		pos.hideExpectedAmount = true;
		const wrapper = await open();
		expect(cells("closing-expected")).toHaveLength(0);
		expect(cells("closing-difference")).toHaveLength(0);
		expect(document.body.textContent).not.toContain("250");
		expect((cells("closing-input")[0] as HTMLInputElement).value).not.toContain("250");
		wrapper.unmount();
	});
});

describe("the printed close", () => {
	const summary = {
		shift: "POS-OS-1",
		cashier: "ann@example.com",
		pos_profile: "Shop 1",
		printed_at: "2026-09-23 18:00",
		currency: "USD",
		total_invoices: 3,
		returns_count: 0,
		grand_total: 150,
		cash_out: 0,
		rows: [
			{
				mode_of_payment: "Cash",
				currency: "USD",
				opening_amount: 100,
				expected_amount: 250,
				closing_amount: 240,
				difference: -10,
			},
		],
	};

	it("blind, leaves out what was expected and the difference, and keeps the count", () => {
		const html = buildShiftSummaryHtml({ ...summary, blind: true });
		expect(html).not.toContain("Expected");
		expect(html).not.toContain("Difference");
		expect(html).toContain("Counted");
	});

	it("otherwise shows both", () => {
		const html = buildShiftSummaryHtml(summary);
		expect(html).toContain("Expected");
		expect(html).toContain("Difference");
	});
});
