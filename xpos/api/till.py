"""Requests from a till.

The desktop till signs in to ERPNext as its own API user, not as the person at the
till. It says which cashier signed in on it, so every check that asks "who is doing
this" has to ask about that cashier. A person signed in to the web POS is who they
are, whatever a request says.
"""

from urllib.parse import unquote

import frappe
from frappe import _

# Sent by the desktop app on every request: who is signed in on the till, and its POS Profile.
CASHIER_HEADER = "X-XPOS-Cashier"
PROFILE_HEADER = "X-XPOS-POS-Profile"


def sent_by_till() -> bool:
	"""Whether the request came from a till's API key rather than a person's own sign-in."""
	if not getattr(frappe.local, "request", None):
		return False
	return (frappe.get_request_header("Authorization") or "").lower().startswith("token ")


def till_cashier() -> str | None:
	"""On a till, the cashier its headers name, checked against the till's POS Profile.

	For checks that ask who is doing something: `till_cashier() or frappe.session.user`.
	None for a person's own sign-in, and for a till that has not said who is signed in
	or which POS Profile it is on. Resolved once per request.
	"""
	if not sent_by_till():
		return None
	if "xpos_till_cashier" not in frappe.flags:
		# The till percent-encodes both: a header carries Latin-1 only.
		cashier = unquote(frappe.get_request_header(CASHIER_HEADER) or "")
		pos_profile = unquote(frappe.get_request_header(PROFILE_HEADER) or "")
		frappe.flags["xpos_till_cashier"] = (
			acting_user(cashier, pos_profile) if cashier and pos_profile else None
		)
	return frappe.flags["xpos_till_cashier"]


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
