/**
 * Shared helpers for offline / scenario specs.
 *
 * These sit beside the *.cy.ts files (not matched by Cypress's specPattern)
 * so every offline spec boots, pays, and inspects the queue the same way.
 */

import { callsTo, lastCallTo } from "../../support/frappeStub";
import { OPEN_SHIFT, PERMISSIONS, POS_PROFILE_DOC, WAREHOUSE } from "../../fixtures/pos";

export const CREATE_INVOICE = "xpos.api.invoices.create_invoice";
export const SAVE_DRAFT = "xpos.api.invoices.save_draft_invoice";
export const STOCK = "xpos.api.items.get_stock_availability";

export const IDB_NAME = "xpos_offline_v3";

export const INVOICE_OK = {
	name: "ACC-SINV-2026-9001",
	doctype: "Sales Invoice",
	status: "Paid",
	outstanding_amount: 0,
};

/** Boot with offline mode on (default fixture) and optional profile/permission overrides. */
export function bootOfflinePos(
	overrides: {
		profileFlags?: Record<string, number>;
		permissions?: Record<string, boolean>;
		routes?: Record<string, unknown>;
	} = {},
) {
	cy.bootPos({
		routes: {
			[CREATE_INVOICE]: INVOICE_OK,
			"xpos.api.invoices.save_draft_invoice": { name: "ACC-SINV-DRAFT-0001" },
			"xpos.api.shifts.check_open_shift": {
				...OPEN_SHIFT,
				pos_profile: { ...POS_PROFILE_DOC, ...(overrides.profileFlags || {}) },
			},
			"xpos.api.auth.get_my_pos_permissions": {
				...PERMISSIONS,
				...(overrides.permissions || {}),
			},
			...(overrides.routes || {}),
		},
	});
}

/** Open the payment dialog the same way the Pay button does. */
export function openPayment() {
	cy.window().then((win) => {
		win.dispatchEvent(new CustomEvent("xpos:process-payment"));
	});
	cy.get("[role='dialog']").should("be.visible");
}

/** Cash tender defaults to the full total + Cash method — Save Only. */
export function savePaymentOnly() {
	cy.get("[data-testid='save-payment']").click();
}

/** Build a one-line cart and open payment. */
export function cartAndPay(itemName = "Espresso Beans") {
	cy.addItemToCart(itemName);
	openPayment();
}

/** Open the Offline Invoices panel. */
export function openOfflinePanel() {
	cy.window().then((win) => {
		win.dispatchEvent(new CustomEvent("xpos:open-offline-panel"));
	});
	cy.contains("[role='dialog']", "Offline Invoices").should("be.visible");
}

export function closeOfflinePanel() {
	cy.contains("[role='dialog']", "Offline Invoices").find("button").first().click();
	cy.contains("[role='dialog']", "Offline Invoices").should("not.exist");
}

/** Navbar connectivity / pending badge (visible when use_offline_mode). Status lives in <header>, not <nav>. */
export function statusPill() {
	return cy
		.get("header")
		.contains(/Online|Offline|Syncing|\d+ pending|need attention/)
		.first();
}

/** Number of create_invoice calls the stub has recorded. */
export function createInvoiceCalls() {
	return callsTo(CREATE_INVOICE);
}

export function lastCreateInvoice() {
	return lastCallTo(CREATE_INVOICE);
}

/** local_id from the last queued/synced create_invoice payload. */
export function lastLocalId(): string | undefined {
	const call = lastCreateInvoice();
	if (!call) return undefined;
	if (call.args.local_id) return String(call.args.local_id);
	try {
		const data = JSON.parse(String(call.args.data || "{}"));
		return data.local_id ? String(data.local_id) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Queue one offline sale for the given item, leaving the app offline.
 * Asserts the toast + cleared cart that mean IndexedDB accepted the row.
 */
export function queueOfflineSale(itemName = "Espresso Beans") {
	cy.goOffline();
	cartAndPay(itemName);
	savePaymentOnly();
	cy.contains(/Invoice saved offline|saved offline/i).should("be.visible");
	cy.cartRows().should("have.length", 0);
}

/** Number of get_stock_availability calls the stub has recorded. */
export function stockAvailabilityCalls() {
	return callsTo(STOCK);
}

/**
 * Read one row from the browser stockCache (Dexie → IndexedDB).
 * Resolves null when the warehouse/item key is missing (not yet cached).
 */
export function getCachedStockQty(
	itemCode: string,
	warehouse: string = WAREHOUSE,
): Cypress.Chainable<number | null> {
	return cy.window().then((win) => {
		return new Promise<number | null>((resolve) => {
			const request = win.indexedDB.open(IDB_NAME);
			request.onerror = () => resolve(null);
			request.onsuccess = () => {
				const db = request.result;
				const finish = (value: number | null) => {
					try {
						db.close();
					} catch {
						/* ignore */
					}
					resolve(value);
				};
				try {
					const tx = db.transaction("stockCache", "readonly");
					const get = tx.objectStore("stockCache").get(`${warehouse}::${itemCode}`);
					get.onsuccess = () => {
						const row = get.result as { actual_qty?: number } | undefined;
						finish(row ? Number(row.actual_qty) : null);
					};
					get.onerror = () => finish(null);
				} catch {
					finish(null);
				}
			};
		});
	});
}

/** Poll until boot's cacheAllStock has written the expected fixture qty. */
export function waitForCachedStock(
	expectedQty: number,
	itemCode = "ITEM-A",
	warehouse: string = WAREHOUSE,
	attempts = 75,
) {
	getCachedStockQty(itemCode, warehouse).then((qty) => {
		if (qty === expectedQty) return;
		if (attempts <= 0) {
			expect(qty, `cached stock for ${itemCode}`).to.equal(expectedQty);
			return;
		}
		cy.wait(200).then(() => waitForCachedStock(expectedQty, itemCode, warehouse, attempts - 1));
	});
}
