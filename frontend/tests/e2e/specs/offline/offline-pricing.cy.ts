/**
 * Offline pricing rules and catalogue behaviour.
 *
 * Extends the offline blocks already in pricing-rules.cy.ts with the
 * capabilities from docs/features/16-offline-mode.md: cached items,
 * cached customers, local rule engine, recovery when back online.
 */

import {
	parseCartPayload,
	reconcileWith,
	ruleSnapshot,
} from "../../fixtures/pricingRules";
import { clearDelay, delayMethod } from "../../support/frappeStub";
import { bootOfflinePos } from "./helpers";

const RECONCILE = "xpos.api.pricing_rules.reconcile_line_prices";
const SNAPSHOT = "xpos.api.pricing_rules.get_active_pricing_rules";

describe("offline pricing rules", () => {
	it("applies a cached rule from the snapshot while offline", () => {
		bootOfflinePos({
			routes: {
				[SNAPSHOT]: [ruleSnapshot({ discount_percentage: 10, item_codes: ["ITEM-A"] })],
				[RECONCILE]: reconcileWith({ discountPercentage: 10 }),
			},
		});

		cy.addItemToCart("Espresso Beans");
		cy.cartRow("Espresso Beans").contains("Auto").should("be.visible");

		cy.goOffline();
		cy.addItemToCart("Espresso Beans");

		cy.cartRow("Espresso Beans").should("contain", "-$20");
		cy.contains("Prices calculated offline").should("be.visible");
		cy.contains("Total").parent().should("contain", "180");
	});

	it("does not show the offline banner while still online", () => {
		bootOfflinePos({
			routes: {
				[SNAPSHOT]: [ruleSnapshot()],
				[RECONCILE]: reconcileWith({ discountPercentage: 10 }),
			},
		});

		cy.addItemToCart("Espresso Beans");
		cy.cartRow("Espresso Beans").contains("Auto").should("be.visible");
		cy.contains("Prices calculated offline").should("not.exist");
	});

	it("switches from snapshot to server rules when back online", () => {
		bootOfflinePos({
			routes: {
				[SNAPSHOT]: [ruleSnapshot({ discount_percentage: 10 })],
				[RECONCILE]: reconcileWith({ discountPercentage: 25 }),
			},
		});

		cy.addItemToCart("Espresso Beans");
		cy.goOffline();
		cy.addItemToCart("Espresso Beans");
		cy.contains("Prices calculated offline").should("be.visible");

		cy.goOnline();
		cy.addItemToCart("Espresso Beans");

		cy.contains("Prices calculated offline").should("not.exist");
		cy.cartRow("Espresso Beans").should("contain", "-$75");
	});

	it("keeps items on the grid after going offline (cached catalogue)", () => {
		bootOfflinePos();
		cy.contains("Espresso Beans").should("be.visible");

		cy.goOffline();
		// Grid must still render from IndexedDB / already-loaded state.
		cy.contains("Espresso Beans").should("be.visible");
		cy.contains("Filter Papers").should("be.visible");
	});

	it("can still add an item to the cart while offline", () => {
		bootOfflinePos();
		cy.goOffline();
		cy.addItemToCart("Filter Papers");
		cy.cartRows().should("have.length", 1);
		cy.cartRow("Filter Papers").should("contain", "Filter Papers");
	});

	it("can still search/select a customer while offline", () => {
		bootOfflinePos();
		cy.goOffline();
		// Customer was selected at boot; re-open selector and pick the other one.
		cy.contains("button", /Ada Lovelace|Walk-in Customer/).click();
		cy.contains("Grace Hopper", { timeout: 10000 }).click();
		cy.get("[role='dialog']").should("not.exist");
		cy.contains("Grace Hopper").should("be.visible");
	});
});

describe("offline pricing - no rules / ignore_pricing_rule", () => {
	it("leaves list prices alone offline when the snapshot is empty", () => {
		bootOfflinePos({
			routes: {
				[SNAPSHOT]: [],
				[RECONCILE]: { updates: [], free_lines: [], invoice_updates: {} },
			},
		});

		cy.addItemToCart("Espresso Beans");
		cy.goOffline();
		cy.addItemToCart("Espresso Beans");

		cy.cartRow("Espresso Beans").should("not.contain", "Auto");
		cy.contains("Total").parent().should("contain", "200");
	});
});

describe("offline pricing - race safety", () => {
	it("discards a slow online reply that arrives after going offline", () => {
		bootOfflinePos({
			routes: {
				[RECONCILE]: (args: Record<string, unknown>) =>
					reconcileWith({ discountPercentage: 50 })(args),
			},
		});

		// Hold the first reconcile, then drop the network mid-flight.
		cy.then(() => delayMethod(RECONCILE, 3000));
		cy.addItemToCart("Espresso Beans");
		cy.wait(200);
		cy.goOffline();
		cy.then(() => clearDelay(RECONCILE));

		// Offline path must take over; a late 50% reply must not blow up the cart.
		cy.wait(3500);
		cy.cartRows().should("have.length.at.least", 1);
		cy.contains("Total").should("be.visible");
	});
});
