"""Check each sale against the cashier's rights, as configured in ERPNext.

Policy lives in ERPNext and cascades to the tills: the cashier's POS Role
permissions, their discount limit on the POS Profile user row, and the POS
Profile's maximum discount. The till enforces it; this module checks every
sale again when it reaches the server, for the cashier who made it rather
than the till's API user, and for the manager who approved an exception on the till
(`approval.py`). Tills sell offline, so a sale that breaks policy
has usually been paid for already: the POS Profile decides whether it is
recorded and flagged for review (the default) or rejected.

`policy_exceptions` holds the rules and needs no database; `apply_sale_policy`
looks up what they need and applies the POS Profile's choice.
"""

import frappe
from frappe import _
from frappe.utils import cint

from xpos.api.till import sent_by_till

# The POS Role permissions a sale can need.
POLICY_RIGHTS = ("allow_change_price", "show_edit_discount_field", "apply_additional_discount", "sale_return")

_TOLERANCE = 0.005  # rounding in percentages


def _pct(value) -> float:
	try:
		number = float(value or 0)
	except (TypeError, ValueError):
		number = 0.0
	return min(max(number, 0.0), 100.0)


def effective_discount_limit(cashier_limit, profile_max) -> float:
	"""The discount a cashier may give alone: 0 means none, 100 means no cap, the lower wins."""
	return min(_pct(cashier_limit), _pct(profile_max))


def _fmt(value: float) -> str:
	return f"{round(value, 2):g}"


def policy_exceptions(
	data: dict,
	*,
	cashier: str,
	pos_profile: str,
	on_profile: bool,
	rights: dict,
	discount_limit: float,
	list_prices: dict,
	profile_allows_rate_change: bool = True,
) -> list[str]:
	"""Every way this sale goes beyond what the cashier may do alone. Empty means in policy.

	`list_prices` maps (item_code, uom) to the POS Profile's price-list rate. A price
	below the list counts as a discount: it is a discount by another name.
	"""
	flags: list[str] = []
	limit_flagged = False

	if not on_profile:
		flags.append(_("Cashier {0} is not on POS Profile {1}.").format(cashier, pos_profile))

	if int(data.get("is_return") or 0) and not rights.get("sale_return"):
		flags.append(_("Return by {0} without the Sale Return permission.").format(cashier))

	list_total = 0.0
	net_total = 0.0
	for item in data.get("items") or []:
		if int(item.get("is_free_item") or 0):
			continue
		code = item.get("item_code")
		uom = item.get("uom") or item.get("stock_uom")
		qty = abs(float(item.get("qty") or 0))
		rate = float(item.get("rate") or 0)
		disc_pct = float(item.get("discount_percentage") or 0)
		disc_amt = float(item.get("discount_amount") or 0)

		list_price = list_prices.get((code, uom))
		base = float(list_price) if list_price is not None else rate
		if disc_pct:
			paid = rate * (1 - disc_pct / 100)
		elif disc_amt:
			paid = rate - disc_amt
		else:
			paid = rate

		price_changed = list_price is not None and abs(rate - base) > _TOLERANCE
		# The POS Profile's Allow Rate Change rules: off, no one changes a price on it (22 Sep 2026).
		if price_changed and not profile_allows_rate_change:
			flags.append(
				_(
					"Item {0}: price changed from {1} to {2}, and the POS Profile does not allow rate changes."
				).format(code, _fmt(base), _fmt(rate))
			)
		elif price_changed and not rights.get("allow_change_price"):
			flags.append(
				_("Item {0}: price changed from {1} to {2} without the Change Price permission.").format(
					code, _fmt(base), _fmt(rate)
				)
			)
		if (disc_pct or disc_amt) and not rights.get("show_edit_discount_field"):
			flags.append(_("Item {0}: discount given without the Edit Discount permission.").format(code))

		if base > 0:
			line_pct = (base - paid) / base * 100
			if line_pct > discount_limit + _TOLERANCE:
				limit_flagged = True
				flags.append(
					_("Item {0}: {1}% off, over {2}'s discount limit of {3}%.").format(
						code, _fmt(line_pct), cashier, _fmt(discount_limit)
					)
				)

		list_total += base * qty
		net_total += paid * qty

	cart_pct = float(data.get("additional_discount_percentage") or 0)
	if not cart_pct and float(data.get("discount_amount") or 0) and net_total:
		cart_pct = float(data.get("discount_amount")) / net_total * 100
	if cart_pct > _TOLERANCE:
		if not rights.get("apply_additional_discount"):
			flags.append(
				_("A cart discount by {0} without the Apply Additional Discount permission.").format(cashier)
			)
		if cart_pct > discount_limit + _TOLERANCE:
			limit_flagged = True
			flags.append(
				_("A {0}% cart discount, over {1}'s discount limit of {2}%.").format(
					_fmt(cart_pct), cashier, _fmt(discount_limit)
				)
			)

	# Discounts that are each within the limit can still add up past it.
	if list_total > 0 and not limit_flagged:
		total_pct = (list_total - net_total * (1 - cart_pct / 100)) / list_total * 100
		if total_pct > discount_limit + _TOLERANCE:
			flags.append(
				_("{0}% off in total, over {1}'s discount limit of {2}%.").format(
					_fmt(total_pct), cashier, _fmt(discount_limit)
				)
			)

	return flags


def resolve_cashier(data: dict) -> str:
	"""Who made the sale.

	A person signed in to the web POS is the cashier, whatever the sale says, so no one
	can claim a manager's rights by naming them. A till syncs as its own API user and
	says which cashier signed in on it; without that, the shift's cashier.
	"""
	if not sent_by_till():
		return frappe.session.user
	cashier = data.get("xpos_cashier")
	if cashier:
		return cashier
	shift = data.get("pos_opening_shift")
	if shift:
		shift_user = frappe.db.get_value("POS Opening Shift", shift, "user")
		if shift_user:
			return shift_user
	return frappe.session.user


def _list_prices(data: dict, price_list: str | None) -> dict:
	if not price_list:
		return {}
	prices = {}
	for item in data.get("items") or []:
		key = (item.get("item_code"), item.get("uom") or item.get("stock_uom"))
		if key in prices or not key[0]:
			continue
		rate = frappe.db.get_value(
			"Item Price",
			{"item_code": key[0], "price_list": price_list, "selling": 1, "uom": key[1]},
			"price_list_rate",
		)
		if rate is not None:
			prices[key] = rate
	return prices


def check_sale_policy(data: dict, pos, cashier: str) -> list[str]:
	"""The policy exceptions for a sale, from the POS configuration in ERPNext."""
	from xpos.api.auth import is_superuser, user_has_pos_permission

	superuser = is_superuser(cashier)
	row = frappe.db.get_value(
		"POS Profile User",
		{"parent": pos.name, "parenttype": "POS Profile", "user": cashier},
		["name", "discount_limit"],
		as_dict=True,
	)
	rights = {key: user_has_pos_permission(key, user=cashier, pos_profile=pos.name) for key in POLICY_RIGHTS}
	cashier_limit = 100 if superuser else (row.discount_limit if row else 0)

	return policy_exceptions(
		data,
		cashier=cashier,
		pos_profile=pos.name,
		on_profile=bool(row) or superuser,
		rights=rights,
		discount_limit=effective_discount_limit(cashier_limit, pos.get("max_discount_percentage_allowed")),
		list_prices=_list_prices(data, pos.get("selling_price_list")),
		profile_allows_rate_change=bool(cint(pos.get("allow_rate_change"))),
	)


def apply_sale_policy(invoice_doc, data: dict, pos) -> None:
	"""Record who made the sale and who approved it, check it, and flag or reject it as
	the POS Profile says."""
	from xpos.api.approval import apply_approval, check_approver, resolve_approver

	cashier = resolve_cashier(data)
	invoice_doc.xpos_cashier = cashier
	flags = check_sale_policy(data, pos, cashier)
	approver = resolve_approver(data) if flags else None
	if approver:
		problems = check_approver(approver, cashier, pos)
		approver_flags = [] if problems else check_sale_policy(data, pos, approver)
		flags, approved_by, approved = apply_approval(flags, approver, problems, approver_flags)
	else:
		approved_by = approved = None
	invoice_doc.xpos_approved_by = approved_by
	invoice_doc.xpos_approved_exceptions = approved
	if not flags:
		invoice_doc.xpos_policy_flags = None
		return
	if (pos.get("xpos_out_of_policy_action") or "Flag") == "Reject":
		# Reject stops a sale the cashier is still making (the web POS online). A sale with a
		# till's local id was paid at the till before ERPNext saw it: refusing it would strand
		# money already taken, and leave the shift's close short of it. Flag it for review.
		if not invoice_doc.get("xpos_local_id"):
			frappe.throw(
				_("This sale is outside the POS Profile's policy: {0}").format(" ".join(flags)),
				title=_("Sale outside policy"),
			)
		flags = [
			*flags,
			_("Outside policy and the POS Profile says Reject, but it was already paid at the till."),
		]
	invoice_doc.xpos_policy_flags = "\n".join(flags)
