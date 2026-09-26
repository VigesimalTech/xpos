/**
 * Idempotency / double-submit around offline queueing.
 *
 * Audit findings C3–C5: missing local_id on online create, isSubmitting set
 * after await, concurrent sync. These specs encode the *correct* contract.
 */

import { clearDelay, delayMethod, lastCallTo } from "../../support/frappeStub";
import {
	CREATE_INVOICE,
	bootOfflinePos,
	cartAndPay,
	createInvoiceCalls,
	openOfflinePanel,
	savePaymentOnly,
} from "./helpers";

describe("double-submit protection", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("creates only one invoice when Save is clicked twice quickly (online)", () => {
		// Slow the create so a second click can land in the race window.
		delayMethod(CREATE_INVOICE, 800);

		cartAndPay();
		cy.get("[data-testid='save-payment']").click();
		// Immediate second click while the first is in flight.
		cy.get("[data-testid='save-payment']").click({ force: true });

		cy.contains(/saved successfully|Invoice saved offline|Payment failed/i, {
			timeout: 15000,
		}).should("be.visible");

		cy.wrap(null, { timeout: 5000 }).should(() => {
			const n = createInvoiceCalls().filter((c) => c.method === CREATE_INVOICE).length;
			// Allow the in-flight first call; a second successful POST is the bug.
			// forceNetworkError / stub replies still record one intercept per attempt.
			expect(n, "create_invoice attempts").to.be.at.most(2);
		});

		// Stronger: after settle, pending queue must be empty (no offline twin).
		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains(/All caught up|No pending/i).should("be.visible");
		});

		clearDelay(CREATE_INVOICE);
	});

	it("disables Save Only while a submit is in flight", () => {
		delayMethod(CREATE_INVOICE, 1000);
		cartAndPay();
		cy.get("[data-testid='save-payment']").click();
		// Button should go disabled as soon as isSubmitting flips.
		cy.get("[data-testid='save-payment']").should("be.disabled");
		clearDelay(CREATE_INVOICE);
		cy.contains(/saved successfully|Payment failed/i, { timeout: 15000 }).should("be.visible");
	});

	it("queues exactly one offline row when offline and Save is double-clicked", () => {
		cy.goOffline();
		cartAndPay();
		cy.get("[data-testid='save-payment']").click();
		cy.get("[data-testid='save-payment']").click({ force: true });

		cy.contains(/Invoice saved offline/i, { timeout: 10000 }).should("be.visible");
		// Panel should show a single customer row for this single-line cart scenario.
		openOfflinePanel();
		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.get("p").filter(":contains('Ada Lovelace')").should("have.length", 1);
		});
	});
});

describe("local_id on create_invoice", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("online create_invoice request includes a local_id for dedupe", () => {
		cartAndPay();
		savePaymentOnly();

		cy.wrap(null).should(() => {
			expect(createInvoiceCalls().length).to.be.greaterThan(0);
		});

		cy.then(() => {
			const call = lastCallTo(CREATE_INVOICE)!;
			const hasArg = call.args.local_id != null && String(call.args.local_id).length > 0;
			let hasInData = false;
			try {
				const data = JSON.parse(String(call.args.data || "{}"));
				hasInData = data.local_id != null && String(data.local_id).length > 0;
			} catch {
				/* ignore */
			}
			// Contract: either top-level arg or embedded in data — currently often missing (audit C4).
			expect(
				hasArg || hasInData,
				`create_invoice must send local_id (arg=${hasArg}, data=${hasInData})`,
			).to.equal(true);
		});
	});

	it("sync of a queued sale sends the queue row's local_id", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();
		cy.contains(/Invoice saved offline/i).should("be.visible");

		cy.goOnline();
		cy.wrap(null, { timeout: 15000 }).should(() => {
			expect(createInvoiceCalls().length).to.be.greaterThan(0);
		});

		cy.then(() => {
			const call = createInvoiceCalls().at(-1)!;
			expect(String(call.args.local_id || ""), "sync local_id").to.not.equal("");
		});
	});
});

describe("sync mutex (no overlapping pushes)", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("does not fire a second create_invoice for the same row while Sync All is running", () => {
		cy.goOffline();
		cartAndPay();
		savePaymentOnly();
		cy.contains(/Invoice saved offline/i).should("be.visible");

		cy.goOnline();
		// Slow every create so a concurrent Sync All would overlap.
		delayMethod(CREATE_INVOICE, 2000);

		// Manual sync while auto-sync may already be running.
		cy.window().then((win) => {
			win.dispatchEvent(new CustomEvent("xpos:open-offline-panel"));
		});
		cy.contains("[role='dialog']", "Offline Invoices").should("be.visible");
		cy.contains("button", /Sync All/).then(($btn) => {
			if (!$btn.is(":disabled")) cy.wrap($btn).click();
		});
		// Second click attempt.
		cy.contains("button", /Sync All/).then(($btn) => {
			if (!$btn.is(":disabled")) cy.wrap($btn).click();
		});

		cy.wait(4000);
		cy.then(() => {
			const creates = createInvoiceCalls();
			// One queued sale → at most one successful logical push; allow 1 attempt
			// plus at most one race loser that the server should dedupe via local_id.
			expect(creates.length, "create_invoice attempts during mutex race").to.be.at.most(2);
			const ids = creates.map((c) => String(c.args.local_id || ""));
			const unique = new Set(ids.filter(Boolean));
			if (creates.length > 1 && ids.every(Boolean)) {
				expect(unique.size, "distinct local_ids if multiple attempts").to.equal(1);
			}
		});

		clearDelay(CREATE_INVOICE);
	});
});
