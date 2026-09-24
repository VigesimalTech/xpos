/**
 * Queue recovery: stock rejections, dead-letter, retry, stuck rows.
 *
 * Maps to audit findings on fail-open stock checks, dead_letter ENUM drift,
 * and rows stranded in `syncing`. Browser e2e can cover the renderer paths;
 * Electron process-kill cases are noted for desktop QA.
 */

import { clearDelay, delayMethod, stub, stubError } from "../../support/frappeStub";
import {
	CREATE_INVOICE,
	bootOfflinePos,
	cartAndPay,
	createInvoiceCalls,
	openOfflinePanel,
	savePaymentOnly,
	stockAvailabilityCalls,
} from "./helpers";

const STOCK_ERROR =
	"Insufficient stock for Espresso Beans. Available: 0, requested: 1";

describe("sync failure - stock rejection → dead letter", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("dead-letters a queued sale when the server rejects for insufficient stock", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();
		cy.contains(/Invoice saved offline/i).should("be.visible");

		const stockCallsBeforeReject = stockAvailabilityCalls().length;

		cy.then(() => {
			stubError(CREATE_INVOICE, STOCK_ERROR, "XPosInsufficientStockError");
		});
		cy.goOnline();

		cy.contains(/rejected for insufficient stock|needs attention/i, {
			timeout: 15000,
		}).should("be.visible");

		// reconcileStockFromServer must refresh qty after a stock rejection.
		cy.wrap(null, { timeout: 10000 }).should(() => {
			expect(
				stockAvailabilityCalls().length,
				"get_stock_availability after stock rejection",
			).to.be.greaterThan(stockCallsBeforeReject);
		});

		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains("Ada Lovelace").should("be.visible");
			cy.contains(/Needs attention|dead_letter/i).should("exist");
			cy.contains("button", "Requeue").should("be.visible");
		});
	});

	it("does not auto-retry a dead-lettered row on the next sync cycle", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();
		cy.then(() => {
			stubError(CREATE_INVOICE, STOCK_ERROR, "XPosInsufficientStockError");
		});
		cy.goOnline();
		cy.contains(/rejected for insufficient stock/i, { timeout: 15000 }).should("be.visible");

		const afterReject = createInvoiceCalls().length;

		// Force another sync by re-opening online path / waiting a tick.
		cy.window().then((win) => {
			win.dispatchEvent(new CustomEvent("xpos:open-offline-panel"));
		});
		cy.contains("[role='dialog']", "Offline Invoices").should("be.visible");
		cy.contains("button", /Sync All/).then(($btn) => {
			if (!$btn.is(":disabled")) cy.wrap($btn).click();
		});

		cy.wait(2000);
		cy.then(() => {
			// Dead-letter rows are skipped — no additional create_invoice.
			expect(createInvoiceCalls().length, "no auto-retry of dead_letter").to.equal(
				afterReject,
			);
		});
	});

	it("requeues a dead-letter row when stock is available again", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();
		cy.then(() => {
			stubError(CREATE_INVOICE, STOCK_ERROR, "XPosInsufficientStockError");
		});
		cy.goOnline();
		cy.contains(/rejected for insufficient stock/i, { timeout: 15000 }).should("be.visible");

		// Stock is fine again — overwrite the error route with success.
		cy.then(() => {
			stub(CREATE_INVOICE, { name: "ACC-SINV-2026-9002", status: "Paid" });
		});

		openOfflinePanel();
		cy.contains("button", "Requeue").click();

		cy.wrap(null, { timeout: 15000 }).should(() => {
			// At least one successful create after requeue.
			const success = createInvoiceCalls().filter(
				(c) => c.args && c.args.local_id,
			);
			expect(success.length).to.be.greaterThan(0);
		});
	});
});

describe("sync failure - generic error → retry then dead letter", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("marks the row failed and surfaces an error after a non-stock rejection", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();

		cy.then(() => {
			stubError(CREATE_INVOICE, "Server exploded", "ValidationError");
		});
		cy.goOnline();

		cy.contains(/Failed to sync/i, { timeout: 15000 }).should("be.visible");

		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains("Ada Lovelace").should("be.visible");
			cy.contains(/Error|failed|Needs attention/i).should("exist");
			cy.contains("button", "Retry").should("be.visible");
		});
	});

	it("retries a failed row successfully once the server recovers", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();
		cy.then(() => {
			stubError(CREATE_INVOICE, "Temporary failure", "ValidationError");
		});
		cy.goOnline();
		cy.contains(/Failed to sync/i, { timeout: 15000 }).should("be.visible");

		// Recover the endpoint.
		cy.then(() => {
			stub(CREATE_INVOICE, { name: "ACC-SINV-2026-9003", status: "Paid" });
		});

		openOfflinePanel();
		cy.contains("button", "Retry").click();

		cy.contains(/Invoice synced successfully|All caught up/i, { timeout: 15000 }).should(
			"be.visible",
		);
	});
});

describe("status pill honesty under queue errors", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("does not claim a clean Online / 0 pending after a successful offline queue", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();
		cy.contains(/Invoice saved offline/i).should("be.visible");

		// While still offline, pill must not say "Online".
		cy.contains("header", "Offline").should("be.visible");
		cy.contains("header", "Online").should("not.exist");
		// And pending count should be non-zero (badge "1").
		cy.get("header").should("contain", "1");
	});

	it("shows Syncing while a push is in flight", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();

		cy.then(() => delayMethod(CREATE_INVOICE, 2500));
		cy.goOnline();

		// Auto-sync starts on online event.
		cy.contains("header", /Syncing/i, { timeout: 10000 }).should("be.visible");
		cy.then(() => clearDelay(CREATE_INVOICE));
		cy.contains(/Synced \d+ offline invoice/i, { timeout: 15000 }).should("be.visible");
	});
});

describe("known gaps (documented, may fail — desktop / process-kill)", () => {
	// These cannot be fully exercised in a single Cypress page session.
	// Kept as explicit QA markers so they are not forgotten.

	it("TODO(desktop): kill process after status=syncing → row recovers on restart", () => {
		cy.log(
			"Electron: crash between SET status='syncing' and POST leaves rows invisible " +
				"to pending|failed selection (syncEngine.ts). Manual desktop QA required.",
		);
	});

	it("TODO(desktop): pending_purchases ENUM lacks dead_letter → UPDATE error under strict SQL", () => {
		cy.log(
			"schema.sql pending_purchases.status ENUM has no 'dead_letter' but code writes it. " +
				"Verify under SQL strict mode on desktop.",
		);
	});

	it("TODO(desktop): IndexedDB recovery must not wipe pendingInvoices when snapshot read fails", () => {
		cy.log(
			"idbService.ensureDatabaseReady: read failure → Dexie.delete with empty snapshot " +
				"destroys unsynced sales. Needs fault-injection harness.",
		);
	});
});
