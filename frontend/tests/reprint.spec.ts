/**
 * @vitest-environment jsdom
 *
 * Printing a receipt again. On the till, ERPNext's print view is a page it has no browser
 * session for: its own sales print from its copy, ERPNext's invoices from HTML it fetches
 * with its key. The web POS keeps the print view.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let electron = true;
vi.mock("@/services/electronBridge", () => ({ isElectron: () => electron }));
vi.mock("@/services/api", () => ({ call: vi.fn(), showError: vi.fn() }));
vi.mock("@/services/dbBridge", () => ({ getCachedReceiptContext: vi.fn(async () => null) }));
vi.mock("@/utils", () => ({ get_full_url: (u: string) => `https://erp.example.com${u}` }));
vi.mock("@/stores/posStore", () => ({
	usePosStore: () => ({
		invoiceType: "Sales Invoice",
		defaultPrintFormat: "XPOS Thermal Receipt",
		printSettings: {},
		profileName: "Shop",
		posProfile: { company: "C" },
	}),
}));

import { call } from "@/services/api";
import { usePrintInvoice } from "@/composables/usePrintInvoice";
import { buildShiftSummaryHtml } from "@/services/receiptTemplate";

const printReceipt = vi.fn(async (_html: string) => ({ success: true }));
const printInvoice = vi.fn(async () => ({ success: true }));
const getPendingInvoice = vi.fn(async (id: number) => ({ id, data: {}, customer_name: "", grand_total: 1 }));

beforeEach(() => {
	electron = true;
	vi.mocked(call).mockReset();
	printReceipt.mockClear();
	printInvoice.mockClear();
	getPendingInvoice.mockClear();
	(window as any).electronAPI = { print: { printReceipt, printInvoice }, db: { getPendingInvoice } };
	vi.spyOn(window, "open").mockImplementation(() => null);
});

describe("printing a receipt again", () => {
	it("prints a till's own sale from the till's copy", async () => {
		await usePrintInvoice().reprint("LOCAL-5");
		expect(getPendingInvoice).toHaveBeenCalledWith(5);
		expect(call).not.toHaveBeenCalled();
		expect(window.open).not.toHaveBeenCalled();
	});

	it("prints an ERPNext invoice on the till from HTML fetched with the till's key", async () => {
		vi.mocked(call).mockResolvedValueOnce({ html: "<p>ACC-SINV-1</p>", style: "p{}" });
		vi.mocked(call).mockResolvedValue(undefined);

		await usePrintInvoice().reprint("ACC-SINV-1");

		expect(call).toHaveBeenCalledWith(
			"frappe.www.printview.get_html_and_style",
			expect.objectContaining({
				doc: "Sales Invoice",
				name: "ACC-SINV-1",
				print_format: "XPOS Thermal Receipt",
			}),
		);
		expect(printReceipt).toHaveBeenCalledWith("<style>p{}</style><p>ACC-SINV-1</p>");
		expect(window.open).not.toHaveBeenCalled();
	});

	it("opens ERPNext's print view on the web", async () => {
		electron = false;
		await usePrintInvoice().reprint("ACC-SINV-1");
		expect(window.open).toHaveBeenCalledWith(
			expect.stringMatching(
				/^https:\/\/erp\.example\.com\/printview\?doctype=Sales%20Invoice&name=ACC-SINV-1/,
			),
			"_blank",
		);
	});

	it("goes through one helper: no screen opens the print view itself", () => {
		const src = join(__dirname, "../src");
		const allowed = new Set(["composables/usePrintInvoice.ts", "components/dialogs/ClosingDialog.vue"]);
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir)) {
				const path = join(dir, entry);
				if (statSync(path).isDirectory()) walk(path);
				else if (/\.(ts|vue)$/.test(entry) && readFileSync(path, "utf8").includes("/printview")) {
					const rel = path.slice(src.length + 1);
					if (!allowed.has(rel)) offenders.push(rel);
				}
			}
		};
		walk(src);
		expect(offenders).toEqual([]);
	});
});

describe("the shift close the till prints", () => {
	it("shows the count against what was expected, escaped", () => {
		const html = buildShiftSummaryHtml({
			shift: "3",
			cashier: "<Ada>",
			pos_profile: "Shop",
			printed_at: "2026-09-19 18:00:00",
			currency: "NGN",
			total_invoices: 2,
			returns_count: 0,
			grand_total: 800,
			cash_out: 250,
			rows: [
				{
					mode_of_payment: "Cash",
					currency: "NGN",
					opening_amount: 1000,
					expected_amount: 1550,
					closing_amount: 1500,
					difference: -50,
				},
			],
		});
		expect(html).toContain("&lt;Ada&gt;");
		expect(html).toContain("Expected");
		expect(html).toContain("Counted");
		expect(html).toContain("Expenses and drops");
	});
});
