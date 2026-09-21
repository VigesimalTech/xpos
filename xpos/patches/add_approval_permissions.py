import frappe

NEW_PERMISSIONS = (
	"approve_exceptions",
	"void_after_payment",
	"no_sale_drawer",
	"return_without_receipt",
)

# Roles that approve out of the box: the seeded Manager and Administrator, and any role
# already trusted to change what every role may do.
_APPROVER_ROLES = {"Manager", "Administrator"}


def new_permission_defaults(role_name: str, enabled: set[str]) -> dict[str, int]:
	"""The new permissions for a role that already exists.

	Approvers get all four: an approver who could not do these actions themselves could
	not approve them either (an approval is held to the approver's own rights). Every
	other role gets none, so no cashier gains a right on upgrade; they ask a manager.
	"""
	approver = role_name in _APPROVER_ROLES or "manage_role_permissions" in enabled
	return {key: 1 if approver else 0 for key in NEW_PERMISSIONS}


def execute():
	"""Add the manager-approval permissions to POS Roles that already exist."""
	from xpos.api.auth import clear_role_permission_cache
	from xpos.install import seed_pos_permissions

	seed_pos_permissions()

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
