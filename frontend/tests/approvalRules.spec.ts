/**
 * K19: who may approve, on the till, what a cashier may not do alone. The same rules
 * the server checks again when the record syncs (xpos/api/approval.py).
 */
import { describe, expect, it } from "vitest";
import { approvalRefusal, effectiveDiscountLimit } from "../electron/approval/approvalRules";

const CASHIER = "cashier@example.com";
const MANAGER = "manager@example.com";

function manager(extra: Record<string, unknown> = {}) {
	return {
		name: MANAGER,
		enabled: 1,
		approve_exceptions: 1,
		discount_limit: 30,
		sale_return: 1,
		expense: 1,
		...extra,
	};
}

const ask = (extra: Record<string, unknown> = {}) => ({
	cashier: CASHIER,
	profileMaxDiscount: 100,
	allowSelfApproval: false,
	...extra,
});

describe("K19: the discount rule on the till", () => {
	it("0 means none, 100 means no cap, the lower of the two wins", () => {
		expect(effectiveDiscountLimit(0, 100)).toBe(0);
		expect(effectiveDiscountLimit(20, 0)).toBe(0);
		expect(effectiveDiscountLimit(20, 15)).toBe(15);
		expect(effectiveDiscountLimit(150, 100)).toBe(100);
		expect(effectiveDiscountLimit(null, null)).toBe(0);
	});
});

describe("K19: who may approve on the till", () => {
	it("a manager with Approve Exceptions approves within their own rights", () => {
		expect(approvalRefusal(manager(), ask({ permission: "sale_return" }))).toBeNull();
		expect(approvalRefusal(manager(), ask({ discountPct: 25 }))).toBeNull();
	});

	it("someone without Approve Exceptions may not approve", () => {
		expect(approvalRefusal(manager({ approve_exceptions: 0 }), ask())).toBe("not_an_approver");
	});

	it("a disabled user may not approve", () => {
		expect(approvalRefusal(manager({ enabled: 0 }), ask())).toBe("disabled");
	});

	it("the cashier may not approve their own exception unless the POS Profile allows it", () => {
		const self = manager({ name: CASHIER });
		expect(approvalRefusal(self, ask())).toBe("self_approval");
		expect(approvalRefusal(self, ask({ allowSelfApproval: true }))).toBeNull();
	});

	it("an approver may not approve what their own role does not allow", () => {
		expect(approvalRefusal(manager({ expense: 0 }), ask({ permission: "expense" }))).toBe(
			"lacks_permission",
		);
	});

	it("one approval for a whole sale needs every permission it covers", () => {
		const both = ask({ permissions: ["sale_return", "expense"] });
		expect(approvalRefusal(manager(), both)).toBeNull();
		expect(approvalRefusal(manager({ expense: 0 }), both)).toBe("lacks_permission");
	});

	it("an approver may not approve a discount beyond their own limit", () => {
		expect(approvalRefusal(manager(), ask({ discountPct: 50 }))).toBe("over_limit");
		// The POS Profile's maximum caps the approver too.
		expect(approvalRefusal(manager(), ask({ discountPct: 25, profileMaxDiscount: 20 }))).toBe(
			"over_limit",
		);
	});
});
