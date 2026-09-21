"""The till's audit log (K20): what happened at a till that leaves no sale behind.

A line deleted from a sale, a quantity lowered, a sale cleared, a held order
discarded, a receipt printed again, a manager's approval, a wrong PIN. None of these
makes an invoice, so without this log ERPNext would never hear of them, and they are
exactly what the exceptions report (K21) is for.

The till logs each event locally, online or not, and sends them in batches when it
syncs. The server keeps every event it is sent: an audit log that refuses entries
loses the ones that matter most. What does not check out against ERPNext (a cashier
who is not on the POS Profile, an approver without Approve Exceptions, an event type
this server has no name for) is kept and noted in **Checks** instead.

`audit_event_doc` holds the rules and needs no database.
"""

import json

import frappe
from frappe import _

from xpos.api.approval import check_approver
from xpos.api.till import sent_by_till

DOCTYPE = "POS Audit Event"

# The till's event keys and their names in ERPNext. "no_sale" and "void_after_payment"
# are named ahead of the till actions (K3), so a till that logs them later is understood.
EVENT_TYPES = {
	"line_removed": "Line Removed",
	"qty_lowered": "Quantity Lowered",
	"sale_cleared": "Sale Cleared",
	"held_order_discarded": "Held Order Discarded",
	"reprint": "Reprint",
	"approval": "Approval",
	"pin_failed": "PIN Failed",
	"no_sale": "No Sale",
	"void_after_payment": "Void After Payment",
}
OTHER = "Other"

# One request's worth: a till that was offline for days sends the rest next cycle.
MAX_BATCH = 200


def _cut(value, length: int):
	if value is None:
		return None
	return str(value)[:length]


def audit_event_doc(
	event: dict,
	*,
	till_user: str,
	cashier_on_profile: bool,
	pin_user_on_profile: bool,
	shift_exists: bool,
	approval_problems: list[str],
) -> dict:
	"""The POS Audit Event for one event a till logged, with what did not check out."""
	checks: list[str] = []
	raw_type = str(event.get("event_type") or "")
	event_type = EVENT_TYPES.get(raw_type)
	if not event_type:
		event_type = OTHER
		checks.append(_("The till logged an event type this server does not know: {0}.").format(raw_type))

	pos_profile = event.get("pos_profile")
	cashier = event.get("cashier") or None
	if cashier and not cashier_on_profile:
		checks.append(_("{0} is not a user of POS Profile {1}.").format(cashier, pos_profile))
	pin_user = event.get("pin_user") or None
	if pin_user and not pin_user_on_profile:
		checks.append(_("{0} is not a user of POS Profile {1}.").format(pin_user, pos_profile))

	shift = event.get("pos_opening_shift") or None
	if shift and not shift_exists:
		checks.append(_("POS Opening Shift {0} is not on this server.").format(shift))
		shift = None

	checks.extend(approval_problems)

	details = event.get("details")
	if details is not None and not isinstance(details, str):
		details = json.dumps(details, indent=1, default=str)

	return {
		"doctype": DOCTYPE,
		"event_type": event_type,
		"event_time": event.get("event_time"),
		"pos_profile": pos_profile,
		"pos_opening_shift": shift,
		"cashier": cashier,
		"approved_by": event.get("approved_by") or None,
		"pin_user": pin_user,
		"item_code": _cut(event.get("item_code"), 140) or None,
		"item_name": _cut(event.get("item_name"), 140),
		"qty": event.get("qty") or 0,
		"amount": event.get("amount") or 0,
		"reference": _cut(event.get("reference"), 140),
		"description": _cut(event.get("description"), 1000),
		"details": details,
		"checks": "\n".join(checks),
		"till_user": till_user,
		"client_request_id": f"till:{event.get('local_id')}",
	}


def _on_profile(user: str | None, pos_profile: str | None) -> bool:
	if not user or not pos_profile:
		return True
	return bool(
		frappe.db.exists(
			"POS Profile User", {"parent": pos_profile, "parenttype": "POS Profile", "user": user}
		)
	)


def _approval_problems(event: dict) -> list[str]:
	approver = event.get("approved_by")
	pos_profile = event.get("pos_profile")
	if not approver or not pos_profile:
		return []
	# Renamed or deleted while the till was offline: keep the event, say why it is unchecked.
	if not frappe.db.exists("POS Profile", pos_profile):
		return [
			_("POS Profile {0} is not on this server, so the approval by {1} could not be checked.").format(
				pos_profile, approver
			)
		]
	pos = frappe.get_cached_doc("POS Profile", pos_profile)
	return check_approver(approver, event.get("cashier") or "", pos)


@frappe.whitelist(methods=["POST"])
def sync_audit_events(events: str | list):
	"""Store a batch of a till's audit events. Returns the local ids now on the server.

	A retry after a lost reply is accepted without storing the event again. One event
	that cannot be stored is left for the till to send again; the rest still are.
	"""
	if not sent_by_till():
		frappe.throw(_("Only a till can send its audit log."), frappe.PermissionError)

	events = json.loads(events) if isinstance(events, str) else (events or [])
	accepted: list[str] = []
	for event in events[:MAX_BATCH]:
		local_id = event.get("local_id") if isinstance(event, dict) else None
		if not local_id:
			continue
		if frappe.db.exists(DOCTYPE, {"client_request_id": f"till:{local_id}"}):
			accepted.append(local_id)
			continue
		try:
			frappe.db.savepoint("xpos_audit_event")
			shift = event.get("pos_opening_shift")
			doc = frappe.get_doc(
				audit_event_doc(
					event,
					till_user=frappe.session.user,
					cashier_on_profile=_on_profile(event.get("cashier"), event.get("pos_profile")),
					pin_user_on_profile=_on_profile(event.get("pin_user"), event.get("pos_profile")),
					shift_exists=bool(shift and frappe.db.exists("POS Opening Shift", shift)),
					approval_problems=_approval_problems(event),
				)
			)
			# A user deleted or renamed since must not lose the event.
			doc.flags.ignore_links = True
			doc.insert(ignore_permissions=True)
			accepted.append(local_id)
		except Exception:
			frappe.db.rollback(save_point="xpos_audit_event")
			frappe.log_error(title=f"X POS audit event {local_id} not stored")
	return {"accepted": accepted}
