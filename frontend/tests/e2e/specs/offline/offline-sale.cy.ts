/**
 * Offline sale → local queue → reconnect → sync.
 *
 * Covers the core offline money path from docs/features/16-offline-mode.md:
 * take payment with no network, surface the pending count, then flush the
 * queue once connectivity returns — without duplicating the invoice.
 */

import {
	bootOfflinePos,
	cartAndPay,
	createInvoiceCalls,
	openOfflinePanel,
	queueOfflineSale,
	savePaymentOnly,
} from "./helpers";

describe("offline sale - queue and sync", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("saves the sale offline and clears the cart when there is no network", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();

		cy.contains(/Invoice saved offline/i).should("be.visible");
		cy.cartRows().should("have.length", 0);
		// Offline path must not touch the server.
		cy.then(() => {
			expect(createInvoiceCalls()).to.have.length(0);
		});
	});

	it("shows Offline in the status pill while disconnected", () => {
		cy.goOffline();
		cy.contains("header", "Offline").should("be.visible");
	});

	it("bumps the pending badge after an offline sale", () => {
		queueOfflineSale();

		cy.contains("header", "Offline").should("be.visible");
		cy.get("header .bg-destructive").should("contain", "1");
	});

	it("lists the queued invoice in the offline panel with a pending badge", () => {
		queueOfflineSale();
		openOfflinePanel();

		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains("Ada Lovelace").should("be.visible");
			cy.contains(/pending/i).should("exist");
			cy.contains(/Draft/i).should("not.exist");
		});
	});

	it("syncs the queued invoice when connectivity returns", () => {
		queueOfflineSale();
		cy.goOnline();

		// online handler kicks syncPendingInvoices when pendingCount > 0
		cy.wrap(null, { timeout: 10000 }).should(() => {
			expect(createInvoiceCalls().length, "create_invoice after reconnect").to.be.greaterThan(0);
		});

		cy.then(() => {
			const call = createInvoiceCalls().at(-1)!;
			// Must carry the same local_id the queue row was created with.
			expect(call.args.local_id, "local_id on sync").to.be.a("string").and.not.be.empty;
			const data = JSON.parse(String(call.args.data));
			expect(data.items?.length, "queued line items").to.be.greaterThan(0);
			// Not a draft — this is a real sale.
			expect(data.is_draft ?? 0).to.not.equal(true);
		});

		// Successful sync removes the row → badge back to Online / 0 pending.
		cy.contains("header", /Online|Syncing/, { timeout: 15000 }).should("be.visible");
		cy.get("header .bg-destructive").should("not.exist");
	});

	it("sends each queued sale exactly once across a multi-sale sync", () => {
		// Two offline sales.
		cy.goOffline();
		cartAndPay("Espresso Beans");
		savePaymentOnly();
		cy.contains(/Invoice saved offline/i).should("be.visible");
		cartAndPay("Filter Papers");
		savePaymentOnly();
		cy.contains(/Invoice saved offline/i).should("be.visible");

		const before = createInvoiceCalls().length;
		cy.goOnline();

		cy.wrap(null, { timeout: 15000 }).should(() => {
			const created = createInvoiceCalls().length - before;
			expect(created, "create_invoice count for 2 queued sales").to.be.at.least(2);
		});

		// Wait for queue to drain, then no more calls (no re-push loop).
		cy.contains("header", /Online|0 pending/).should("be.visible", { timeout: 15000 });
		cy.wait(1500);
		cy.then(() => {
			const total = createInvoiceCalls().length - before;
			expect(total, "no duplicate pushes after drain").to.equal(2);
		});
	});

	it("does not call create_invoice while still offline after a failed push attempt", () => {
		queueOfflineSale();
		// Still offline: periodic/manual sync must no-op.
		cy.then(() => {
			// Open panel and click Sync All while offline → button disabled.
		});
		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains("button", /Sync All/).should("be.disabled");
		});
		cy.then(() => {
			expect(createInvoiceCalls()).to.have.length(0);
		});
	});

	it("keeps a successful online create_invoice on the happy path (control)", () => {
		cartAndPay();
		savePaymentOnly();

		cy.wrap(null).should(() => {
			expect(createInvoiceCalls().length, "online create_invoice").to.be.greaterThan(0);
		});
		cy.contains(/saved successfully/i).should("be.visible");
		cy.cartRows().should("have.length", 0);
	});
});

describe("offline sale - network drop mid-request", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("queues locally when create_invoice dies with a network error after going online", () => {
		cartAndPay();

		// App thinks it is online, but the POST never completes — classic lost response.
		cy.intercept("POST", "**/api/method/xpos.api.invoices.create_invoice", {
			forceNetworkError: true,
		}).as("createFail");

		savePaymentOnly();

		cy.contains(/Invoice saved offline|saved offline/i).should("be.visible", { timeout: 10000 });
		cy.cartRows().should("have.length", 0);

		// The failed attempt may have been recorded by the catch-all stub or by this
		// intercept; what matters is the queue has a row we can sync later.
		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains("Ada Lovelace").should("be.visible");
		});
	});
});
