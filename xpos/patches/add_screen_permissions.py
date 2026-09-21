import frappe

NEW_PERMISSIONS = (
	"view_reports",
	"barcode_printer",
	"price_checker",
	"purchasing",
)

# Roles that get every screen: the seeded Manager and Administrator, and any role already
# trusted to change what every role may do.
_MANAGER_ROLES = {"Manager", "Administrator"}

# A cashier's own tool: every role keeps it on upgrade.
_EVERY_ROLE = {"price_checker"}


def new_permission_defaults(role_name: str, enabled: set[str]) -> dict[str, int]:
	"""The screen permissions (K27) for a role that already exists.

	Managers get all of them. Every other role gets the Price Checker only: Reports, the
	Barcode Printer and Purchasing were open to everyone before, and are now hidden from
	a cashier, or opened with a manager's PIN, as the POS Profile says.
	"""
	manager = role_name in _MANAGER_ROLES or "manage_role_permissions" in enabled
	return {key: 1 if manager or key in _EVERY_ROLE else 0 for key in NEW_PERMISSIONS}


def execute():
	"""Add the screen permissions to POS Roles that already exist."""
	from xpos.api.auth import clear_role_permission_cache
	from xpos.install import seed_pos_permissions

	seed_pos_permissions(only=NEW_PERMISSIONS)

	for role_name in frappe.get_all("POS Role", pluck="name"):
		role = frappe.get_doc("POS Role", role_name)
		present = {row.permission for row in role.permissions}
		missing = [key for key in NEW_PERMISSIONS if key not in present]
		if not missing:
			continue
		enabled = {row.permission for row in role.permissions if row.enabled}
		defaults = new_permission_defaults(role_name, enabled)
		for key in missing:
			role.append("permissions", {"permission": key, "enabled": defaults[key]})
		role.save(ignore_permissions=True)

	clear_role_permission_cache()
