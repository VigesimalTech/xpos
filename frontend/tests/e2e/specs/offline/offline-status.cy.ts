/**
 * Connectivity status pill, pending badge, and Offline panel controls.
 */

import { stubError } from "../../support/frappeStub";
import {
	bootOfflinePos,
	cartAndPay,
	createInvoiceCalls,
	CREATE_INVOICE,
	openOfflinePanel,
	queueOfflineSale,
	savePaymentOnly,
} from "./helpers";

describe("offline status pill", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("shows Online when connected with an empty queue", () => {
		cy.contains("header", "Online").should("be.visible");
	});

	it("flips to Offline when the network drops", () => {
		cy.goOffline();
		cy.contains("header", "Offline").should("be.visible");
		cy.contains("header", "Online").should("not.exist");
	});

	it("toasts when going offline", () => {
		cy.goOffline();
		cy.contains(/You are offline/i).should("be.visible");
	});

	it("toasts when the connection is restored", () => {
		cy.goOffline();
		cy.goOnline();
		cy.contains(/Internet connection restored/i).should("be.visible");
	});

	it("shows a pending count badge after an offline sale", () => {
		queueOfflineSale();
		cy.contains("header", "Offline").should("be.visible");
		// Destructive badge next to the offline icon carries the pending count.
		cy.get("header .bg-destructive").should("exist").and("contain", "1");
	});

	it("does not show the offline UI when use_offline_mode is off", () => {
		bootOfflinePos({ profileFlags: { use_offline_mode: 0 } });
		cy.contains("header", "Offline").should("not.exist");
		cy.contains("header", "Online").should("not.exist");
	});
});

describe("offline panel controls", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("opens from the custom event and shows the empty state when nothing is queued", () => {
		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").should("be.visible");
		cy.contains("All caught up").should("be.visible");
		cy.contains("No pending offline invoices").should("be.visible");
	});

	it("disables Sync All while offline", () => {
		queueOfflineSale();
		openOfflinePanel();
		cy.contains("button", /Sync All/).should("be.disabled");
	});

	it("enables Sync All when online with pending rows", () => {
		queueOfflineSale();
		cy.goOnline();
		// After reconnect auto-sync may drain the queue; re-check both outcomes.
		cy.contains("header", /Online|Syncing/, { timeout: 15000 }).should("be.visible");
		openOfflinePanel();
		// body must be read outside .within() — within scopes queries to the dialog.
		cy.get("body").then(($body) => {
			if ($body.text().includes("All caught up")) {
				cy.contains("All caught up").should("be.visible");
			} else {
				cy.contains("button", /Sync All/).should("not.be.disabled");
			}
		});
	});

	it("hides Clear All when the profile forbids deleting offline invoices", () => {
		// Fixture POS_PROFILE_DOC does not set allow_delete_offline_invoice → falsy.
		queueOfflineSale();
		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains("button", "Clear All").should("not.exist");
			cy.contains(/Deleting offline invoices is disabled/i).should("be.visible");
		});
	});

	it("shows Clear All when allow_delete_offline_invoice is on", () => {
		bootOfflinePos({ profileFlags: { allow_delete_offline_invoice: 1 } });
		queueOfflineSale();
		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains("button", "Clear All").should("be.visible");
		});
	});

	it("clears the queue when Clear All is confirmed", () => {
		bootOfflinePos({ profileFlags: { allow_delete_offline_invoice: 1 } });
		queueOfflineSale();
		openOfflinePanel();

		cy.window().then((win) => {
			cy.stub(win, "confirm").returns(true);
		});
		cy.contains("button", "Clear All").click();

		cy.contains("All caught up", { timeout: 10000 }).should("be.visible");
		cy.contains("header", /Offline|Online/).should("be.visible");
	});

	it("keeps the queue when Clear All is cancelled", () => {
		bootOfflinePos({ profileFlags: { allow_delete_offline_invoice: 1 } });
		queueOfflineSale();
		openOfflinePanel();

		cy.window().then((win) => {
			cy.stub(win, "confirm").returns(false);
		});
		cy.contains("button", "Clear All").click();

		cy.contains("Ada Lovelace").should("be.visible");
	});
});

describe("status after failed sync", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("keeps the row and surfaces an error when create_invoice rejects", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();
		cy.contains(/Invoice saved offline/i).should("be.visible");

		// Non-200 with __xposStubError so isNetworkError/false-success wrapping does not swallow it.
		cy.then(() => {
			stubError(CREATE_INVOICE, "Item unavailable", "ValidationError");
		});

		cy.goOnline();
		cy.contains(/Failed to sync|needs attention|Error/i, { timeout: 15000 }).should("be.visible");

		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains("Ada Lovelace").should("be.visible");
			cy.contains(/Error|failed|Needs attention/i).should("exist");
		});

		cy.then(() => {
			expect(createInvoiceCalls().length).to.be.greaterThan(0);
		});
	});
});
