import frappe


def execute():
	"""Receipts show discounts as amounts: Print Discount Amount on for every POS Profile,
	the new default (decided 22 Sep 2026). A shop can switch it off again."""
	frappe.db.sql(
		"UPDATE `tabPOS Profile` SET `print_discount_amount` = 1 WHERE IFNULL(`print_discount_amount`, 0) = 0"
	)
