/**
 * Offline stock effects: local cache decrement, successful-sync silence,
 * rejection → server stock refresh.
 */

import { ITEM_A } from "../../fixtures/pos";
import {
	bootOfflinePos,
	createInvoiceCalls,
	getCachedStockQty,
	queueOfflineSale,
	stockAvailabilityCalls,
	waitForCachedStock,
} from "./helpers";

describe("offline stock effects", () => {
	beforeEach(() => {
		bootOfflinePos();
		// cacheAllStock runs after boot; wait for the fixture qty so adjustCachedStock has a row.
		waitForCachedStock(ITEM_A.actual_qty);
	});

	it("decrements local cached stock by the sold qty when queueing offline", () => {
		const before = ITEM_A.actual_qty;
		queueOfflineSale(); // default cart qty = 1

		// reserveStock → adjustCachedStock(delta: -1) on success.
		getCachedStockQty(ITEM_A.item_code).should("equal", before - 1);
		// Offline path must not push to the server.
		cy.then(() => {
			expect(createInvoiceCalls()).to.have.length(0);
		});
	});

	it("does not re-fetch stock from the server as part of a successful reconnect sync", () => {
		queueOfflineSale();
		const stockCallsBeforeSync = stockAvailabilityCalls().length;
		const qtyAfterQueue = ITEM_A.actual_qty - 1;

		cy.goOnline();

		// Sync flushes the queue → create_invoice must fire.
		cy.wrap(null, { timeout: 15000 }).should(() => {
			expect(createInvoiceCalls().length, "create_invoice after reconnect").to.be.greaterThan(0);
		});
		cy.contains("header", /Online|Syncing/, { timeout: 15000 }).should("be.visible");
		cy.get("header .bg-destructive").should("not.exist");

		// Product contract today: success path only deletes the queue row.
		// reconcileStockFromServer runs only on stock rejection — not here.
		cy.then(() => {
			expect(
				stockAvailabilityCalls().length,
				"get_stock_availability must not be called on successful sync",
			).to.equal(stockCallsBeforeSync);
		});

		// Local cache keeps the offline reservation (server qty never written back on success).
		getCachedStockQty(ITEM_A.item_code).should("equal", qtyAfterQueue);
	});
});
