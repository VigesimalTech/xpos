import frappe


def execute():
	"""The POS Profile's Allow Discount Change now rules line discounts (decided 22 Sep
	2026). X POS ignored it, and ERPNext leaves it off, so every existing profile is switched
	on once: otherwise every till would lose line discounts on upgrade. A shop that wants
	none unticks it again."""
	frappe.db.sql(
		"UPDATE `tabPOS Profile` SET `allow_discount_change` = 1 WHERE IFNULL(`allow_discount_change`, 0) = 0"
	)
