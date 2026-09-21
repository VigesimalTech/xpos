# Copyright (c) 2026, Ali Raza and contributors
# For license information, please see license.txt

"""
Install-time seeding for the xPOS role-based permission system.
"""

import frappe

POS_PERMISSIONS = (
	# Billing & Invoicing
	("close_shift", "Close Shift", "Billing & Invoicing"),
	("allow_reprint_invoice", "Reprint Invoice", "Billing & Invoicing"),
	("print_draft_invoice", "Print Draft Invoice", "Billing & Invoicing"),
	("shift_report", "Shift Report", "Billing & Invoicing"),
	# Discounts & Pricing
	("apply_additional_discount", "Apply Additional Discount", "Discounts & Pricing"),
	("show_edit_discount_field", "Edit Discount Field", "Discounts & Pricing"),
	("allow_change_price", "Change Price", "Discounts & Pricing"),
	# Sales Operations
	("sale_return", "Sale Return", "Sales Operations"),
	("recall_other_shift_tabs", "Recall Other Shifts' Tabs", "Sales Operations"),
	("settle_outstanding_invoice", "Settle Outstanding Invoice", "Sales Operations"),
	("void_after_payment", "Void After Payment", "Sales Operations"),
	("return_without_receipt", "Return Without Receipt", "Sales Operations"),
	# Deleting a line, lowering a quantity, clearing the sale or discarding a held order.
	("remove_cart_items", "Remove Items From the Cart", "Sales Operations"),
	# Cash Management
	("expense", "Expense", "Cash Management"),
	("bank_drop", "Bank Drop", "Cash Management"),
	("no_sale_drawer", "Open Drawer Without a Sale", "Cash Management"),
	# Reports
	("current_stock_by_brand", "Current Stock by Brand", "Reports"),
	("current_stock_report", "Current Stock Report", "Reports"),
	# Screens (K27): without one, the POS Profile's Screens the Role Lacks decides whether
	# the screen is hidden or opens with a manager's PIN.
	("view_reports", "Reports", "Screens"),
	("barcode_printer", "Barcode Printer", "Screens"),
	("price_checker", "Price Checker", "Screens"),
	("purchasing", "Purchasing", "Screens"),
	# Administration
	("manage_role_permissions", "Manage Role Permissions", "Administration"),
	# A manager's PIN on the till approves what the cashier's role does not allow.
	("approve_exceptions", "Approve Exceptions", "Administration"),
)

ALL_PERMISSION_NAMES = tuple(name for name, _label, _group in POS_PERMISSIONS)

# Cashiers ring up sales out of the box; every catalog permission is an elevated
# capability, so none are enabled by default but the Price Checker, a cashier's tool.
_CASHIER_ENABLED: set[str] = {"price_checker"}
_MANAGER_DISABLED = {"manage_role_permissions"}

DEFAULT_ROLES = (
	("Cashier", _CASHIER_ENABLED),
	("Manager", set(ALL_PERMISSION_NAMES) - _MANAGER_DISABLED),
	("Administrator", set(ALL_PERMISSION_NAMES)),
)


def after_install():
	seed_pos_permissions()
	seed_default_roles()


def seed_pos_permissions(only=None):
	"""Upsert the static POS Permission catalog, or the permissions named in `only`. Idempotent.

	A patch passes the permissions it adds, and only those: saving a POS Role fills in
	every catalog permission it lacks as disabled, so a patch that seeded the whole
	catalog would leave a later patch's permissions already present, all off, and that
	patch would skip them (found in K27: managers upgraded from before K19 lost every
	screen).
	"""
	for permission_name, permission_label, _group in POS_PERMISSIONS:
		if only is not None and permission_name not in only:
			continue
		if frappe.db.exists("POS Permission", permission_name):
			continue
		frappe.get_doc(
			{
				"doctype": "POS Permission",
				"permission_name": permission_name,
				"permission_label": permission_label,
			}
		).insert(ignore_permissions=True)


def seed_default_roles():
	"""Create the default POS Role records with their child permission rows.

	Skips roles that already exist so existing customisations are preserved.
	"""
	for role_name, enabled_set in DEFAULT_ROLES:
		if frappe.db.exists("POS Role", role_name):
			continue
		role = frappe.get_doc({"doctype": "POS Role", "role_name": role_name})
		for permission_name in ALL_PERMISSION_NAMES:
			role.append(
				"permissions",
				{
					"permission": permission_name,
					"enabled": 1 if permission_name in enabled_set else 0,
				},
			)
		role.insert(ignore_permissions=True)
