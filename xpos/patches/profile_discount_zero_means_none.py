import frappe


def execute():
	"""Keep existing POS Profiles uncapped now that a maximum discount of 0 means none.

	Until now 0 meant "no cap". It now means no discount without a manager, and 100
	means no cap. Profiles left at 0 are moved to 100 once, so an upgrade does not
	stop every discount on them. Runs once, so a 0 set after it is kept.
	"""
	if not frappe.db.has_column("POS Profile", "max_discount_percentage_allowed"):
		return

	profiles = frappe.get_all(
		"POS Profile",
		filters={"max_discount_percentage_allowed": ["in", [0, None]]},
		pluck="name",
	)
	for name in profiles:
		frappe.db.set_value(
			"POS Profile", name, "max_discount_percentage_allowed", 100, update_modified=False
		)
	if profiles:
		print(
			f"Set Max Discount Percentage Allowed to 100 (no cap) on {len(profiles)} POS Profile(s) "
			"that had 0, which now means no discount: " + ", ".join(profiles)
		)
