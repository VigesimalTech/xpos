"""A manager's approval for what a cashier may not do alone.

When a cashier needs something beyond their POS Role or discount limit, a manager
approves it on the till with their PIN (checked on the till, offline). The till
sends who approved with the record; this module checks that approval again on the
server, from the same configuration in ERPNext:

- the approver works that shop: a user of the POS Profile the record is for;
- their POS Role holds **Approve Exceptions** on that POS Profile;
- they are not the cashier, unless the POS Profile allows self-approval.

An approval is held to the approver's own rights: a manager with a 20% discount
limit approves up to 20%, and anything beyond still counts against the record.

Only a till names an approver. A person signed in to the web POS is checked as
themselves: nobody entered a PIN there, so an approver in the payload is ignored.

`approval_problems` and `apply_approval` hold the rules and need no database.
"""

import frappe
from frappe import _

from xpos.api.till import sent_by_till

APPROVE_KEY = "approve_exceptions"


def approval_problems(
	*,
	cashier: str,
	approver: str,
	pos_profile: str,
	approver_on_profile: bool,
	approver_can_approve: bool,
	allow_self_approval: bool,
) -> list[str]:
	"""Why this approval does not count. Empty means it does."""
	problems: list[str] = []
	if not approver_on_profile:
		problems.append(_("Approver {0} is not on POS Profile {1}.").format(approver, pos_profile))
	if not approver_can_approve:
		problems.append(_("Approver {0} does not have the Approve Exceptions permission.").format(approver))
	if approver == cashier and not allow_self_approval:
		problems.append(
			_("{0} approved their own exception; POS Profile {1} does not allow self-approval.").format(
				approver, pos_profile
			)
		)
	return problems


def apply_approval(
	cashier_flags: list[str],
	approver: str | None,
	problems: list[str],
	approver_flags: list[str],
) -> tuple[list[str], str | None, str | None]:
	"""What stands after an approval: (exceptions, approved by, what was approved).

	`cashier_flags` are the record's exceptions for the cashier, `problems` those of
	the approval itself, `approver_flags` the record's exceptions for the approver.
	"""
	if not cashier_flags or not approver:
		return cashier_flags, None, None
	if problems:
		return cashier_flags + problems, None, None
	return approver_flags, approver, "\n".join(cashier_flags)


def resolve_approver(data: dict) -> str | None:
	"""The approver a till names on a record; never from a person's own sign-in."""
	if not sent_by_till():
		return None
	return data.get("xpos_approved_by") or None


def check_approver(approver: str, cashier: str, pos) -> list[str]:
	"""`approval_problems` for this approver on this POS Profile, from ERPNext."""
	from xpos.api.auth import is_superuser, user_has_pos_permission

	superuser = is_superuser(approver)
	on_profile = superuser or bool(
		frappe.db.exists(
			"POS Profile User", {"parent": pos.name, "parenttype": "POS Profile", "user": approver}
		)
	)
	return approval_problems(
		cashier=cashier,
		approver=approver,
		pos_profile=pos.name,
		approver_on_profile=on_profile,
		approver_can_approve=user_has_pos_permission(APPROVE_KEY, user=approver, pos_profile=pos.name),
		allow_self_approval=bool(pos.get("xpos_allow_self_approval")),
	)
