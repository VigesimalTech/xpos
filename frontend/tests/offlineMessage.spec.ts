/**
 * The cashier never reads the internal "__offline__": reports, returns and the customer
 * form showed it when ERPNext could not be reached (22 Sep 2026).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/api", () => ({ call: vi.fn() }));

import { plainMessage, offlineMessage } from "@/lib/offlineMessage";
import { extractErrorMessage } from "@/utils";

describe("offline, in words", () => {
	it("replaces the marker with a sentence", () => {
		expect(plainMessage("Failed to create customer: __offline__")).toBe(offlineMessage());
		expect(offlineMessage()).toContain("ERPNext is not reachable");
	});

	it("leaves every other message alone", () => {
		expect(plainMessage("Item RT-ITEM is disabled")).toBe("Item RT-ITEM is disabled");
	});

	it("an offline error extracted for the screen reads as the sentence", () => {
		expect(extractErrorMessage(new Error("__offline__"))).toBe(offlineMessage());
	});
});
