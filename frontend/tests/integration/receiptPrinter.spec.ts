/**
 * Printing receipts on the desktop till: straight to the receipt printer, with
 * no print dialog, and a clear reason when it cannot print.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invoke, printing } from "./support/electronShim";
import { closeTestDb, createTestDb } from "./support/localDb";
import { execute } from "../../electron/database/dbService";
import { registerDbHandlers } from "../../electron/database/ipcHandlers";
import { registerPrintHandlers } from "../../electron/print/receiptPrinter";

const RECEIPT = "<html><body><h1>Receipt</h1><p>Total 10.00</p></body></html>";

type PrintResult = { success: boolean; error?: string; printer?: string };

beforeAll(async () => {
	await createTestDb();
	registerDbHandlers();
	registerPrintHandlers();
});

afterAll(async () => {
	await closeTestDb();
});

beforeEach(async () => {
	await execute("DELETE FROM `app_settings` WHERE `key` = 'receipt_printer'");
	printing.jobs.length = 0;
	printing.failWith = null;
	printing.printers = [
		{ name: "Office_Laser", displayName: "Office Laser" },
		{ name: "EPSON_TM_T20III", displayName: "EPSON TM-T20III" },
	];
});

describe("H1: a receipt prints straight to the printer", () => {
	it("prints without a dialog to the system default when no receipt printer is chosen", async () => {
		const result = await invoke<PrintResult>("print:receipt", RECEIPT);

		expect(result).toMatchObject({ success: true });
		expect(printing.jobs).toHaveLength(1);
		expect(printing.jobs[0].options.silent).toBe(true);
		expect(printing.jobs[0].options.deviceName).toBeUndefined();
		expect(decodeURIComponent(printing.jobs[0].url)).toContain("Total 10.00");
	});

	it("prints to the receipt printer chosen in settings", async () => {
		await invoke("db:set-setting", "receipt_printer", "EPSON_TM_T20III", "print");

		const result = await invoke<PrintResult>("print:receipt", RECEIPT);

		expect(result).toMatchObject({ success: true, printer: "EPSON_TM_T20III" });
		expect(printing.jobs[0].options).toMatchObject({ silent: true, deviceName: "EPSON_TM_T20III" });
	});

	it("lists the installed printers for the settings screen", async () => {
		const printers = await invoke<{ name: string; displayName: string }[]>("print:list-printers");

		expect(printers).toEqual([
			{ name: "Office_Laser", displayName: "Office Laser" },
			{ name: "EPSON_TM_T20III", displayName: "EPSON TM-T20III" },
		]);
	});
});

describe("H4: when the receipt cannot print", () => {
	it("says which printer failed and why, without throwing", async () => {
		await invoke("db:set-setting", "receipt_printer", "EPSON_TM_T20III", "print");
		printing.failWith = "Printer is out of paper";

		const result = await invoke<PrintResult>("print:receipt", RECEIPT);

		expect(result.success).toBe(false);
		expect(result.error).toContain("EPSON_TM_T20III");
		expect(result.error).toContain("out of paper");
	});

	it("names a chosen printer that is no longer installed", async () => {
		await invoke("db:set-setting", "receipt_printer", "Old_Printer", "print");

		const result = await invoke<PrintResult>("print:receipt", RECEIPT);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Old_Printer");
		expect(printing.jobs).toHaveLength(0);
	});

	it("says so when no printer is installed at all", async () => {
		printing.printers = [];

		const result = await invoke<PrintResult>("print:receipt", RECEIPT);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/no printer/i);
	});
});
