/**
 * Hold / draft orders offline must NOT become real invoices on sync.
 *
 * Audit finding C6 (Electron pushTable had no is_draft guard). The renderer
 * path does skip drafts (offlineStore.syncPendingInvoices) — these specs lock
 * that contract so a regression fails here before it hits production.
 */

import { CREATE_INVOICE, bootOfflinePos, createInvoiceCalls, openOfflinePanel } from "./helpers";
import { callsTo } from "../../support/frappeStub";

function holdOrderOffline() {
	cy.goOffline();
	cy.get("[data-testid='hold-order']:visible").first().click();
	cy.contains(/draft saved offline|saved offline/i).should("be.visible");
	cy.cartRows().should("have.length", 0);
}

describe("offline draft (hold order)", () => {
	beforeEach(() => {
		bootOfflinePos();
	});

	it("saves a held order offline without calling the server", () => {
		cy.addItemToCart("Espresso Beans");
		holdOrderOffline();

		cy.then(() => {
			expect(callsTo("xpos.api.invoices.save_draft_invoice")).to.have.length(0);
			expect(createInvoiceCalls()).to.have.length(0);
		});
	});

	it("marks the panel row as Draft, not a payable pending sale", () => {
		cy.addItemToCart("Espresso Beans");
		holdOrderOffline();
		openOfflinePanel();

		cy.contains("[role='dialog']", "Offline Invoices").within(() => {
			cy.contains(/Draft/i).should("be.visible");
			// Drafts are not counted as syncable pending sales in the same way;
			// at minimum they must be distinguishable.
			cy.contains("Load to Cart").should("be.visible");
		});
	});

	it("does not push a draft to create_invoice when connectivity returns", () => {
		cy.addItemToCart("Espresso Beans");
		holdOrderOffline();

		const before = createInvoiceCalls().length;
		cy.goOnline();

		// Give the online handler + any sync tick time to (incorrectly) push.
		cy.wait(2000);
		cy.then(() => {
			expect(
				createInvoiceCalls().length - before,
				"create_invoice must not fire for is_draft rows",
			).to.equal(0);
		});
	});

	it("does not push a draft via Sync All after reconnect", () => {
		cy.addItemToCart("Espresso Beans");
		holdOrderOffline();
		cy.goOnline();

		openOfflinePanel();
		const before = createInvoiceCalls().length;
		// body must be read outside .within() — within scopes queries to the dialog.
		cy.get("body").then(($body) => {
			if (!$body.text().includes("Offline Invoices")) return;
			const btn = $body.find("button").filter((_, el) => (el.textContent || "").includes("Sync All"));
			if (btn.length && !btn.is(":disabled")) {
				cy.wrap(btn.first()).click();
			}
		});

		cy.wait(1500);
		cy.then(() => {
			expect(createInvoiceCalls().length - before, "no create_invoice for drafts").to.equal(0);
		});
	});

	it("loads a draft back into the cart from the panel", () => {
		cy.addItemToCart("Espresso Beans");
		holdOrderOffline();
		openOfflinePanel();

		cy.contains("[role='dialog']", "Offline Invoices").contains("button", "Load to Cart").click();
		cy.cartRows().should("have.length.at.least", 1);
		cy.cartRow("Espresso Beans").should("contain", "Espresso Beans");
	});

	it("online hold still uses save_draft_invoice, not create_invoice", () => {
		cy.addItemToCart("Espresso Beans");
		cy.get("[data-testid='hold-order']:visible").first().click();
		cy.contains(/Order saved as draft/i).should("be.visible");

		cy.then(() => {
			expect(callsTo("xpos.api.invoices.save_draft_invoice").length).to.be.greaterThan(0);
			expect(createInvoiceCalls()).to.have.length(0);
		});
	});
});
