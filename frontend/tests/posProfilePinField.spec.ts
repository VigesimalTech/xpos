/**
 * @vitest-environment jsdom
 *
 * The ERPNext POS Profile form script (xpos/x_pos/api/pos_profile.js): the till PIN field on a
 * cashier's row takes digits only, at most six, and does not rate the PIN as a password.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handlers = Record<string, (frm: unknown, cdt: string, cdn: string) => void>;

function loadFormScript() {
	const handlers: Record<string, Handlers> = {};
	const frappe = {
		ui: { form: { on: (doctype: string, h: Handlers) => (handlers[doctype] = h) } },
		show_alert: vi.fn(),
	};
	const locals: Record<string, Record<string, Record<string, unknown>>> = { "POS Profile User": {} };
	const source = readFileSync(join(__dirname, "../../xpos/x_pos/api/pos_profile.js"), "utf8");
	new Function("frappe", "locals", "__", source)(frappe, locals, (s: string) => s);
	return { handlers: handlers["POS Profile User"], frappe, locals };
}

function openRow(handlers: Handlers) {
	const input = document.createElement("input");
	input.type = "password";
	const control = { $input: { get: () => input }, disable_password_checks: vi.fn() };
	const frm = {
		fields_dict: {
			applicable_for_users: {
				grid: {
					grid_rows_by_docname: { row1: { grid_form: { fields_dict: { xpos_pin: control } } } },
				},
			},
		},
	};
	handlers.form_render(frm, "POS Profile User", "row1");
	return { input, control, frm };
}

function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event("input"));
}

describe("the till PIN field on the POS Profile", () => {
	let script: ReturnType<typeof loadFormScript>;
	beforeEach(() => {
		script = loadFormScript();
	});

	it("does not rate the PIN as a password, which replaced the field's description", () => {
		const { control } = openRow(script.handlers);
		expect(control.disable_password_checks).toHaveBeenCalled();
	});

	it("takes digits only, at most six", () => {
		const { input } = openRow(script.handlers);

		type(input, "12a4");
		expect(input.value).toBe("124");
		type(input, "1234567");
		expect(input.value).toBe("123456");
		expect(input.getAttribute("maxlength")).toBe("6");
		expect(input.getAttribute("inputmode")).toBe("numeric");
	});

	it("warns when the PIN is too short, not for a saved PIN's asterisks", () => {
		const { frm } = openRow(script.handlers);
		const row = (script.locals["POS Profile User"].row1 = { xpos_pin: "12" });

		script.handlers.xpos_pin(frm, "POS Profile User", "row1");
		expect(script.frappe.show_alert).toHaveBeenCalledTimes(1);

		row.xpos_pin = "******";
		script.handlers.xpos_pin(frm, "POS Profile User", "row1");
		row.xpos_pin = "1234";
		script.handlers.xpos_pin(frm, "POS Profile User", "row1");
		expect(script.frappe.show_alert).toHaveBeenCalledTimes(1);
	});
});
