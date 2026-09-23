# Copyright (c) 2026, Ali Raza and contributors
# For license information, please see license.txt

"""Missing Till Sales (K43): sale numbers a till used that never reached ERPNext.

Each till numbers the sales it signs one after another. ERPNext records the number on
each sale that arrives, so a gap is a sale that was paid at the till and never came:
still waiting on a till that has not synced, refused by ERPNext and still on the till,
or deleted from the till's database before it synced. A gap that stays after the till
has synced is the one to ask about.

A gap shows once a later sale arrives: the last sales before a till stops syncing
cannot be missed by number, only by the till's own list of unsent sales.

`find_gaps` holds the arithmetic and needs no database.
"""

import frappe
from frappe import _

from xpos.api.utilities import get_invoice_type


def find_gaps(sales: list[dict]) -> list[dict]:
	"""The runs of numbers missing between a till's sales, in order.

	`sales` are one till key's sales: `xpos_till_sequence`, `name`, `posting_date`. A
	number received twice (a duplicate) is not a gap.
	"""
	ordered = sorted(
		(s for s in sales if (s.get("xpos_till_sequence") or 0) > 0),
		key=lambda s: s["xpos_till_sequence"],
	)
	gaps = []
	for before, after in zip(ordered, ordered[1:], strict=False):
		first, last = before["xpos_till_sequence"] + 1, after["xpos_till_sequence"] - 1
		if first > last:
			continue
		gaps.append(
			{
				"missing_from": first,
				"missing_to": last,
				"missing_count": last - first + 1,
				"before_invoice": before["name"],
				"before_date": before.get("posting_date"),
				"after_invoice": after["name"],
				"after_date": after.get("posting_date"),
			}
		)
	return gaps


def execute(filters=None):
	filters = frappe._dict(frappe.parse_json(filters) if filters else {})
	doctype = get_invoice_type()
	if not frappe.get_meta(doctype).has_field("xpos_till_sequence"):
		return get_columns(doctype), []

	keys = frappe.get_all("POS Till Key", fields=["key_id", "till_user"])
	till_of = {k.key_id: k.till_user for k in keys}
	conditions = {"xpos_till_sequence": [">", 0], "xpos_till_key": ["is", "set"]}
	if filters.get("till_user"):
		wanted = [k.key_id for k in keys if k.till_user == filters.till_user]
		conditions["xpos_till_key"] = ["in", wanted or [""]]

	sales = frappe.get_all(
		doctype,
		filters=conditions,
		fields=["name", "posting_date", "xpos_till_key", "xpos_till_sequence"],
		order_by="xpos_till_key, xpos_till_sequence",
	)
	by_key: dict[str, list[dict]] = {}
	for sale in sales:
		by_key.setdefault(sale.xpos_till_key, []).append(sale)

	rows = []
	for key_id, key_sales in sorted(by_key.items()):
		for gap in find_gaps(key_sales):
			if filters.get("from_date") and str(gap["after_date"]) < str(filters.from_date):
				continue
			rows.append({"till_user": till_of.get(key_id), "key_id": key_id, **gap})
	return get_columns(doctype), rows


def get_columns(doctype: str) -> list[dict]:
	return [
		{
			"label": _("Till User"),
			"fieldname": "till_user",
			"fieldtype": "Link",
			"options": "User",
			"width": 200,
		},
		{"label": _("Till Key"), "fieldname": "key_id", "fieldtype": "Data", "width": 150},
		{"label": _("Missing From"), "fieldname": "missing_from", "fieldtype": "Int", "width": 110},
		{"label": _("Missing To"), "fieldname": "missing_to", "fieldtype": "Int", "width": 110},
		{"label": _("Sales Missing"), "fieldname": "missing_count", "fieldtype": "Int", "width": 110},
		{
			"label": _("Sale Before"),
			"fieldname": "before_invoice",
			"fieldtype": "Link",
			"options": doctype,
			"width": 180,
		},
		{"label": _("Date Before"), "fieldname": "before_date", "fieldtype": "Date", "width": 110},
		{
			"label": _("Sale After"),
			"fieldname": "after_invoice",
			"fieldtype": "Link",
			"options": doctype,
			"width": 180,
		},
		{"label": _("Date After"), "fieldname": "after_date", "fieldtype": "Date", "width": 110},
	]
