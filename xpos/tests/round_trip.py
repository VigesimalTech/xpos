"""Seed a test site for the desktop round-trip tests.

Run once on a fresh site in CI:

    bench --site test_site execute xpos.tests.round_trip.setup --kwargs '{"out": "/tmp/xpos-rt.json"}'

It completes the setup wizard for one company, then adds what a till needs:
a stocked item with a price, a customer, a POS Profile with Cash, and API
keys for the till to sync with. The names it created are written to `out`
for the tests. Safe to run twice.

`bench execute` connects as Administrator and commits when this returns, so
there is no set_user or commit here.
"""

import json

import frappe
from frappe.utils import add_days, getdate, nowdate

COMPANY = "Test Shop"
ABBR = "TS"
ITEM = "RT-ITEM"
CUSTOMER = "RT Customer"
POS_PROFILE = "RT POS"
# A second shop, and cashiers and tills in each, for "which cashiers does a till get".
POS_PROFILE_2 = "RT POS 2"
CASHIERS = {
	"rt-cashier@example.com": [POS_PROFILE],
	"rt-other@example.com": [POS_PROFILE_2],
	"rt-both@example.com": [POS_PROFILE, POS_PROFILE_2],
	"rt-till@example.com": [POS_PROFILE],
	"rt-till-2@example.com": [POS_PROFILE_2],
}
# The sale-policy tests: this cashier may give up to 10% alone; the second shop
# rejects out-of-policy sales rather than flagging them.
CASHIER_DISCOUNT_LIMIT = {("rt-cashier@example.com", POS_PROFILE): 10}
REJECT_PROFILE = POS_PROFILE_2
OPENING_QTY = 50
RATE = 100


def _complete_setup():
	if frappe.is_setup_complete():
		return
	from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

	year = getdate(nowdate()).year
	setup_complete(
		{
			"language": "English",
			"country": "Nigeria",
			"timezone": "Africa/Lagos",
			"currency": "NGN",
			"full_name": "Test Admin",
			"email": "rt-admin@example.com",
			"password": "rt-admin-password",
			"company_name": COMPANY,
			"company_abbr": ABBR,
			"chart_of_accounts": "Standard",
			"fy_start_date": f"{year}-01-01",
			"fy_end_date": f"{year}-12-31",
			"setup_demo": 0,
		}
	)


def _ensure(doctype, name, values):
	if frappe.db.exists(doctype, name):
		return frappe.get_doc(doctype, name)
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True)
	return doc


def _ensure_user(email):
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": email.split("@")[0],
				"send_welcome_email": 0,
				"roles": [{"role": "Sales User"}],
			}
		).insert(ignore_permissions=True)


def _keys_for(user):
	from frappe.core.doctype.user.user import generate_keys

	secret = generate_keys(user)["api_secret"]
	return {"api_key": frappe.db.get_value("User", user, "api_key"), "api_secret": secret}


def setup(out="/tmp/xpos-rt.json"):
	_complete_setup()

	company = frappe.get_doc("Company", COMPANY)
	warehouse = frappe.db.get_value("Warehouse", {"company": COMPANY, "warehouse_name": "Stores"}, "name")
	cash_account = company.default_cash_account or frappe.db.get_value(
		"Account", {"company": COMPANY, "account_type": "Cash", "is_group": 0}, "name"
	)

	mop = frappe.get_doc("Mode of Payment", "Cash")
	if not any(row.company == COMPANY for row in mop.accounts):
		mop.append("accounts", {"company": COMPANY, "default_account": cash_account})
		mop.save(ignore_permissions=True)

	_ensure(
		"Item",
		ITEM,
		{
			"item_code": ITEM,
			"item_name": "Round-trip Item",
			"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups",
			"stock_uom": "Nos",
			"is_stock_item": 1,
		},
	)
	if not frappe.db.exists("Item Price", {"item_code": ITEM, "price_list": "Standard Selling"}):
		frappe.get_doc(
			{
				"doctype": "Item Price",
				"item_code": ITEM,
				"price_list": "Standard Selling",
				"price_list_rate": RATE,
			}
		).insert(ignore_permissions=True)

	if not frappe.db.get_value("Bin", {"item_code": ITEM, "warehouse": warehouse}, "actual_qty"):
		entry = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Receipt",
				"company": COMPANY,
				"posting_date": add_days(nowdate(), -1),
				"set_posting_time": 1,
				"items": [
					{"item_code": ITEM, "qty": OPENING_QTY, "t_warehouse": warehouse, "basic_rate": 60}
				],
			}
		)
		entry.insert(ignore_permissions=True)
		entry.submit()

	_ensure(
		"Customer",
		CUSTOMER,
		{
			"customer_name": CUSTOMER,
			"customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
			or "All Customer Groups",
			"territory": frappe.db.get_value("Territory", {"is_group": 0}, "name") or "All Territories",
		},
	)

	for email in CASHIERS:
		_ensure_user(email)

	for profile_name, extra_users in (
		(POS_PROFILE, ["Administrator"]),
		(POS_PROFILE_2, []),
	):
		if frappe.db.exists("POS Profile", profile_name):
			continue
		users = extra_users + [u for u, profiles in CASHIERS.items() if profile_name in profiles]
		profile = frappe.get_doc(
			{
				"doctype": "POS Profile",
				"name": profile_name,
				"company": COMPANY,
				"warehouse": warehouse,
				"customer": CUSTOMER,
				"currency": company.default_currency,
				"selling_price_list": "Standard Selling",
				"update_stock": 1,
				"write_off_account": company.write_off_account or company.round_off_account,
				"write_off_cost_center": company.cost_center,
				"payments": [{"mode_of_payment": "Cash", "default": 1}],
				# A user may have only one default POS Profile: their first.
				"applicable_for_users": [
					{"user": u, "default": int(CASHIERS.get(u, [profile_name])[0] == profile_name)}
					for u in users
				],
				"use_offline_mode": 1,
			}
		)
		profile.insert(ignore_permissions=True)

	for (user, profile_name), limit in CASHIER_DISCOUNT_LIMIT.items():
		frappe.db.set_value(
			"POS Profile User", {"parent": profile_name, "user": user}, "discount_limit", limit
		)
	frappe.db.set_value("POS Profile", REJECT_PROFILE, "xpos_out_of_policy_action", "Reject")

	from frappe.core.doctype.user.user import generate_keys

	api_secret = generate_keys("Administrator")["api_secret"]
	api_key = frappe.db.get_value("User", "Administrator", "api_key")

	tills = {
		POS_PROFILE: _keys_for("rt-till@example.com"),
		POS_PROFILE_2: _keys_for("rt-till-2@example.com"),
	}
	# A user on no POS Profile, like an admin or integration key.
	_ensure_user("rt-admin@example.com")
	unassigned = _keys_for("rt-admin@example.com")

	result = {
		"company": COMPANY,
		"warehouse": warehouse,
		"item": ITEM,
		"rate": RATE,
		"opening_qty": OPENING_QTY,
		"customer": CUSTOMER,
		"pos_profile": POS_PROFILE,
		"user": "Administrator",
		"api_key": api_key,
		"api_secret": api_secret,
		"pos_profile_2": POS_PROFILE_2,
		"cashiers": CASHIERS,
		"tills": tills,
		"unassigned": unassigned,
		"discount_limits": {f"{u}|{p}": v for (u, p), v in CASHIER_DISCOUNT_LIMIT.items()},
		"reject_profile": REJECT_PROFILE,
	}
	# A CI-only seed: `out` is the path the workflow passes. The secret goes to a
	# file rather than the return value, which bench prints to the job log.
	with open(out, "w") as f:  # nosemgrep
		json.dump(result, f, indent=1)
	return {"company": COMPANY, "pos_profiles": [POS_PROFILE, POS_PROFILE_2]}
