# Copyright (c) 2026, Ali Raza and contributors
# For license information, please see license.txt

"""POS Exceptions (K21): what each cashier did outside a plain sale, by shop and day or week.

A supervisor reads it to see who takes items out of sales before payment, who gives
refunds and discounts, whose sales went beyond their rights, whose drawer counts are off,
and whose PIN is being tried. Routine edits are not blocked at the till (a lowered
quantity needs no manager); this report is what makes them visible.

Where the figures come from:
- Sales, returns, discounts and sales outside policy: the POS invoices, by their cashier
  (xpos_cashier; the invoice's owner for sales made before it was recorded).
- Items taken out of sales, reprints, approvals and wrong PINs: the POS Audit Events the
  tills and the web POS send.
- Count differences: the submitted POS Closing Shifts.

`build_rows` holds the arithmetic and needs no database.
"""

from collections import defaultdict
from datetime import date, timedelta

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, nowdate

from xpos.api.utilities import get_invoice_type

# Audit event types and the columns they count into.
TAKEN_OUT = {
	"Line Removed": "lines_removed",
	"Quantity Lowered": "qty_lowered",
	"Sale Cleared": "sales_cleared",
	"Held Order Discarded": "held_discarded",
}
COUNTED = {"Reprint": "reprints", "Approval": "approvals", "PIN Failed": "wrong_pins"}

COUNT_FIELDS = (
	"sales",
	"returns",
	"lines_removed",
	"qty_lowered",
	"sales_cleared",
	"held_discarded",
	"approvals",
	"outside_policy",
	"reprints",
	"wrong_pins",
)
VALUE_FIELDS = (
	"sales_value",
	"returns_value",
	"lines_removed_value",
	"qty_lowered_value",
	"sales_cleared_value",
	"held_discarded_value",
	"discounts_value",
	"count_difference",
)


def execute(filters=None):
	filters = frappe._dict(frappe.parse_json(filters) if filters else {})
	from_date, to_date = _period(filters)
	profiles = _profiles(filters)
	if not profiles:
		return get_columns(), [], None, None, []

	rows = build_rows(
		invoices=_invoices(from_date, to_date, profiles, filters),
		events=_events(from_date, to_date, profiles),
		closings=_closings(from_date, to_date, profiles),
		group_by=filters.get("group_by") or "Day",
		cashier=filters.get("cashier"),
	)
	return get_columns(filters.get("group_by") or "Day"), rows, None, None, get_summary(rows)


def get_columns(group_by: str = "Day") -> list[dict]:
	def count(fieldname, label, width=90):
		return {"fieldname": fieldname, "label": _(label), "fieldtype": "Int", "width": width}

	def value(fieldname, label, width=120):
		return {"fieldname": fieldname, "label": _(label), "fieldtype": "Currency", "width": width}

	return [
		{
			"fieldname": "period",
			"label": _("Week of") if group_by == "Week" else _("Date"),
			"fieldtype": "Date",
			"width": 100,
		},
		{
			"fieldname": "pos_profile",
			"label": _("POS Profile"),
			"fieldtype": "Link",
			"options": "POS Profile",
			"width": 130,
		},
		{"fieldname": "cashier", "label": _("Cashier"), "fieldtype": "Link", "options": "User", "width": 180},
		count("sales", "Sales"),
		value("sales_value", "Sales Value"),
		value("taken_out_value", "Taken Out Before Payment", 150),
		{"fieldname": "taken_out_pct", "label": _("Taken Out %"), "fieldtype": "Percent", "width": 100},
		count("lines_removed", "Lines Removed"),
		value("lines_removed_value", "Lines Removed Value"),
		count("qty_lowered", "Quantities Lowered", 110),
		value("qty_lowered_value", "Quantities Lowered Value", 140),
		count("sales_cleared", "Sales Cleared"),
		value("sales_cleared_value", "Sales Cleared Value"),
		count("held_discarded", "Held Orders Discarded", 120),
		value("held_discarded_value", "Held Orders Discarded Value", 150),
		count("returns", "Returns"),
		value("returns_value", "Returns Value"),
		value("discounts_value", "Discounts Given"),
		count("outside_policy", "Outside Policy", 100),
		count("approvals", "Manager Approvals", 110),
		count("reprints", "Reprints"),
		count("wrong_pins", "Wrong PINs"),
		value("count_difference", "Count Difference", 130),
	]


def build_rows(invoices, events, closings, group_by="Day", cashier=None) -> list[dict]:
	"""One row per period, POS Profile and cashier, busiest exceptions first within a period.

	invoices: dicts with posting_date, pos_profile, cashier, is_return, base_grand_total,
	    discount (whole-sale and line discounts, in company currency), xpos_policy_flags.
	events: POS Audit Events with event_type, event_time, pos_profile, cashier, pin_user, amount.
	closings: dicts with posting_date, pos_profile, user, difference.
	"""
	rows: dict[tuple, dict] = {}

	def row(day, pos_profile, user) -> dict | None:
		if not user or (cashier and user != cashier):
			return None
		key = (_period_start(day, group_by), pos_profile or "", user)
		if key not in rows:
			rows[key] = {
				"period": key[0],
				"pos_profile": key[1],
				"cashier": user,
				**dict.fromkeys(COUNT_FIELDS, 0),
				**dict.fromkeys(VALUE_FIELDS, 0.0),
			}
		return rows[key]

	for inv in invoices:
		r = row(inv.get("posting_date"), inv.get("pos_profile"), inv.get("cashier"))
		if r is None:
			continue
		total = abs(flt(inv.get("base_grand_total")))
		if inv.get("is_return"):
			r["returns"] += 1
			r["returns_value"] += total
			continue
		r["sales"] += 1
		r["sales_value"] += total
		r["discounts_value"] += flt(inv.get("discount"))
		if (inv.get("xpos_policy_flags") or "").strip():
			r["outside_policy"] += 1

	for ev in events:
		kind = ev.get("event_type")
		# A wrong PIN counts against whose PIN it was, which is who someone tried to be.
		user = ev.get("pin_user") if kind == "PIN Failed" else ev.get("cashier")
		r = row(ev.get("event_time"), ev.get("pos_profile"), user or ev.get("cashier"))
		if r is None:
			continue
		if kind in TAKEN_OUT:
			field = TAKEN_OUT[kind]
			r[field] += 1
			r[f"{field}_value"] += abs(flt(ev.get("amount")))
		elif kind in COUNTED:
			r[COUNTED[kind]] += 1

	for closing in closings:
		r = row(closing.get("posting_date"), closing.get("pos_profile"), closing.get("user"))
		if r is not None:
			r["count_difference"] += flt(closing.get("difference"))

	out = []
	for r in rows.values():
		r["taken_out_value"] = sum(r[f"{field}_value"] for field in TAKEN_OUT.values())
		r["taken_out_pct"] = flt(r["taken_out_value"] / r["sales_value"] * 100, 1) if r["sales_value"] else 0
		for field in VALUE_FIELDS + ("taken_out_value",):
			r[field] = flt(r[field], 2)
		out.append(r)
	return sorted(out, key=lambda r: (r["period"], -r["taken_out_value"], r["pos_profile"], r["cashier"]))


def get_summary(rows: list[dict]) -> list[dict]:
	def total(field):
		return flt(sum(r[field] for r in rows), 2)

	difference = total("count_difference")
	return [
		{
			"label": _("Taken Out Before Payment"),
			"value": total("taken_out_value"),
			"datatype": "Currency",
			"indicator": "Orange",
		},
		{"label": _("Returns"), "value": total("returns_value"), "datatype": "Currency", "indicator": "Blue"},
		{
			"label": _("Discounts Given"),
			"value": total("discounts_value"),
			"datatype": "Currency",
			"indicator": "Blue",
		},
		{
			"label": _("Count Difference"),
			"value": difference,
			"datatype": "Currency",
			"indicator": "Red" if difference else "Green",
		},
		{
			"label": _("Wrong PINs"),
			"value": sum(r["wrong_pins"] for r in rows),
			"datatype": "Int",
			"indicator": "Red" if any(r["wrong_pins"] for r in rows) else "Green",
		},
	]


def _period_start(day, group_by: str) -> date:
	"""The day, or the Monday of its week. Takes a date, a datetime or text."""
	d = getdate(day)
	return d - timedelta(days=d.weekday()) if group_by == "Week" else d


def _period(filters) -> tuple[date, date]:
	to_date = getdate(filters.get("to_date") or nowdate())
	from_date = getdate(filters.get("from_date") or add_days(to_date, -6))
	if from_date > to_date:
		frappe.throw(_("From Date must be on or before To Date."))
	return from_date, to_date


def _profiles(filters) -> list[str]:
	conditions = {}
	if filters.get("company"):
		conditions["company"] = filters["company"]
	if filters.get("pos_profile"):
		conditions["name"] = filters["pos_profile"]
	return frappe.get_all("POS Profile", filters=conditions, pluck="name")


def _invoices(from_date, to_date, profiles, filters) -> list[dict]:
	doctype = get_invoice_type()
	conditions = {
		"docstatus": 1,
		"is_pos": 1,
		"posting_date": ["between", [from_date, to_date]],
		"pos_profile": ["in", profiles],
	}
	if filters.get("company"):
		conditions["company"] = filters["company"]
	invoices = frappe.get_all(
		doctype,
		filters=conditions,
		fields=[
			"name",
			"posting_date",
			"pos_profile",
			"xpos_cashier",
			"owner",
			"is_return",
			"base_grand_total",
			"base_discount_amount",
			"xpos_policy_flags",
		],
	)
	line_discounts = _line_discounts(doctype, [i.name for i in invoices if not i.is_return])
	for inv in invoices:
		inv["cashier"] = inv.get("xpos_cashier") or inv.get("owner")
		inv["discount"] = flt(inv.get("base_discount_amount")) + line_discounts.get(inv.name, 0)
	return invoices


def _line_discounts(doctype: str, names: list[str]) -> dict[str, float]:
	"""What each sale's lines were sold under their price-list price, in company currency."""
	if not names:
		return {}
	out: dict[str, float] = defaultdict(float)
	for item in frappe.get_all(
		f"{doctype} Item",
		filters={"parent": ["in", names], "parenttype": doctype},
		fields=["parent", "base_price_list_rate", "base_rate", "qty"],
	):
		below = flt(item.base_price_list_rate) - flt(item.base_rate)
		if below > 0:
			out[item.parent] += below * flt(item.qty)
	return out


def _events(from_date, to_date, profiles) -> list[dict]:
	return frappe.get_all(
		"POS Audit Event",
		filters={
			"event_time": ["between", [f"{from_date} 00:00:00", f"{to_date} 23:59:59"]],
			"pos_profile": ["in", profiles],
		},
		fields=["event_type", "event_time", "pos_profile", "cashier", "pin_user", "amount"],
	)


def _closings(from_date, to_date, profiles) -> list[dict]:
	closings = frappe.get_all(
		"POS Closing Shift",
		filters={
			"docstatus": 1,
			"posting_date": ["between", [from_date, to_date]],
			"pos_profile": ["in", profiles],
		},
		fields=["name", "posting_date", "pos_profile", "user"],
	)
	if not closings:
		return []
	differences: dict[str, float] = defaultdict(float)
	for detail in frappe.get_all(
		"POS Closing Shift Detail",
		filters={"parent": ["in", [c.name for c in closings]], "parenttype": "POS Closing Shift"},
		fields=["parent", "difference"],
	):
		differences[detail.parent] += flt(detail.difference)
	for closing in closings:
		closing["difference"] = differences.get(closing.name, 0)
	return closings
