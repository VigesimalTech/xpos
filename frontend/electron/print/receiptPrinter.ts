/**
 * Receipt printing for the desktop till.
 *
 * A receipt goes straight to the printer, with no print dialog: a cashier
 * should not have to confirm a dialog for every sale. The printer is the one
 * chosen in Settings (`receipt_printer`), or the system default when none is.
 * A failure never throws: it comes back with the printer and the reason, so
 * the sale still completes and the cashier is told the receipt did not print.
 */
import { BrowserWindow, ipcMain } from "electron";
import { queryOne } from "../database/dbService";
import { createLogger } from "../logger";

const log = createLogger("ReceiptPrinter");

export const RECEIPT_PRINTER_SETTING = "receipt_printer";

// Electron no longer reports which printer is the system default, so none is
// marked; with no receipt printer chosen the job goes to the OS default.
export interface PrinterInfo {
	name: string;
	displayName: string;
}

export interface PrintResult {
	success: boolean;
	printer?: string;
	error?: string;
}

async function listPrinters(): Promise<PrinterInfo[]> {
	const win = BrowserWindow.getAllWindows()[0];
	if (!win) return [];
	const printers = await win.webContents.getPrintersAsync();
	return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name }));
}

async function chosenPrinter(): Promise<string | null> {
	const row = await queryOne<{ value: string }>("SELECT `value` FROM `app_settings` WHERE `key` = ?", [
		RECEIPT_PRINTER_SETTING,
	]);
	return row?.value?.trim() || null;
}

export async function printReceipt(html: string): Promise<PrintResult> {
	let printer: string | null = null;
	try {
		printer = await chosenPrinter();
		const printers = await listPrinters();
		if (printers.length === 0) {
			return { success: false, error: "No printer is installed on this till." };
		}
		if (printer && !printers.some((p) => p.name === printer)) {
			return {
				success: false,
				printer,
				error: `Receipt printer "${printer}" is not installed. Choose one in Settings.`,
			};
		}
		const target = printer || "the system default printer";

		const printWin = new BrowserWindow({
			show: false,
			webPreferences: { nodeIntegration: false, contextIsolation: true },
		});
		try {
			await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
			const options: Electron.WebContentsPrintOptions = {
				silent: true,
				printBackground: true,
				margins: { marginType: "none" },
			};
			if (printer) options.deviceName = printer;
			const { success, reason } = await new Promise<{ success: boolean; reason: string }>((resolve) =>
				printWin.webContents.print(options, (ok, failureReason) =>
					resolve({ success: ok, reason: failureReason }),
				),
			);
			if (!success) {
				log.warn(`Receipt did not print on ${target}: ${reason}`);
				return {
					success: false,
					printer: target,
					error: `Receipt did not print on ${target}: ${reason}`,
				};
			}
			return { success: true, printer: target };
		} finally {
			if (!printWin.isDestroyed()) printWin.close();
		}
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		log.error(`Receipt print failed: ${reason}`);
		return { success: false, printer: printer ?? undefined, error: `Receipt did not print: ${reason}` };
	}
}

export function registerPrintHandlers(): void {
	ipcMain.handle("print:receipt", (_e, html: string) => printReceipt(html));
	ipcMain.handle("print:list-printers", () => listPrinters());
}
