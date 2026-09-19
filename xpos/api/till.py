"""Requests from a till.

The desktop till signs in to ERPNext as its own API user, not as the person at the
till. It says which cashier signed in on it, so every check that asks "who is doing
this" has to ask about that cashier. A person signed in to the web POS is who they
are, whatever a request says.
"""

import frappe
from frappe import _


def sent_by_till() -> bool:
	"""Whether the request came from a till's API key rather than a person's own sign-in."""
	return (frappe.get_request_header("Authorization") or "").lower().startswith("token ")


def acting_user(cashier: str | None = None, pos_profile: str | None = None) -> str:
	"""The person a request acts for.

	A till names its cashier, who must be a user of the POS Profile the request is for:
	a till cannot act for someone who does not work that till. A till that names no
	one acts as itself.
	"""
	if not sent_by_till() or not cashier or cashier == frappe.session.user:
		return frappe.session.user
	if not pos_profile or not frappe.db.exists(
		"POS Profile User", {"parent": pos_profile, "parenttype": "POS Profile", "user": cashier}
	):
		frappe.throw(
			_("{0} is not a user of POS Profile {1}.").format(cashier, pos_profile or ""),
			frappe.PermissionError,
		)
	return cashier
