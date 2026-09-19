// Copyright (c) 2026 Ali Raza and contributors
// For license information, please see license.txt

frappe.ui.form.on("POS Profile", {
	setup: function (frm) {
		frm.set_query("cash_mode_of_payment", function (doc) {
			return {
				filters: { type: "Cash" },
			};
		});

		frm.set_query("default_pos_expense_account", function (doc) {
			return {
				filters: {
					company: doc.company,
					is_group: 0,
					root_type: "Expense",
				},
			};
		});

		frm.set_query("back_office_cash_account", function (doc) {
			return {
				filters: {
					company: doc.company,
					is_group: 0,
					account_type: "Cash",
				},
			};
		});

		frm.set_query("default_source_account", function (doc) {
			return {
				filters: {
					company: doc.company,
					is_group: 0,
					account_type: "Cash",
				},
			};
		});

		frm.set_query("account", "allowed_expense_accounts", function (doc) {
			return {
				filters: {
					company: doc.company,
					is_group: 0,
					root_type: "Expense",
				},
			};
		});

		frm.set_query("erp_tax_account", "purchase_taxes", function (doc) {
			return {
				filters: {
					company: doc.company,
					is_group: 0,
					account_type: "Tax",
				},
			};
		});

		frm.set_query("account", "allowed_source_accounts", function (doc) {
			return {
				filters: {
					company: doc.company,
					is_group: 0,
					account_type: "Cash",
				},
			};
		});
	},
});

// The till PIN is a Password field so ERPNext never shows it back, but Frappe's password
// control rates what is typed as a password and swaps the description for "Include symbols,
// numbers and capital letters". A PIN is 4 to 6 digits: keep the description, take digits only.
const XPOS_PIN = /^\d{4,6}$/;

function xpos_set_up_pin_field(control) {
	control.disable_password_checks();
	const input = control.$input && control.$input.get(0);
	if (!input || input.dataset.xposPin) return;
	input.dataset.xposPin = "1";
	input.setAttribute("inputmode", "numeric");
	input.setAttribute("maxlength", "6");
	input.setAttribute("autocomplete", "new-password");
	input.addEventListener("input", () => {
		const digits = input.value.replace(/\D/g, "").slice(0, 6);
		if (digits !== input.value) input.value = digits;
	});
}

frappe.ui.form.on("POS Profile User", {
	form_render(frm, cdt, cdn) {
		const row = frm.fields_dict.applicable_for_users.grid.grid_rows_by_docname[cdn];
		const control = row && row.grid_form && row.grid_form.fields_dict.xpos_pin;
		if (control) xpos_set_up_pin_field(control);
	},

	xpos_pin(frm, cdt, cdn) {
		const pin = locals[cdt][cdn].xpos_pin;
		// A saved PIN shows as asterisks; that is not a new one.
		if (pin && !/^\*+$/.test(pin) && !XPOS_PIN.test(pin)) {
			frappe.show_alert({ message: __("A till PIN is 4 to 6 digits."), indicator: "orange" });
		}
	},
});
