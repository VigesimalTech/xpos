"""Seed a test site for the desktop round-trip tests.

Run once on a fresh site in CI:

    bench --site test_site execute xpos.tests.round_trip.setup --kwargs '{"out": "/tmp/xpos-rt.json"}'

It completes the setup wizard for one company, then adds what a till needs:
a stocked item with a price, a customer, a POS Profile with Cash, and API
keys for the till to sync with. The names it created are written to `out`
for the tests. Safe to run twice.
"""

import json

import frappe
from frappe.utils import add_days, getdate, nowdate

COMPANY = "Test Shop"
ABBR = "TS"
ITEM = "RT-ITEM"
CUSTOMER = "RT Customer"
POS_PROFILE = "RT POS"
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
	frappe.db.commit()


def _ensure(doctype, name, values):
	if frappe.db.exists(doctype, name):
		return frappe.get_doc(doctype, name)
	doc = frappe.get_doc({"doctype": doctype, **values})
	doc.insert(ignore_permissions=True)
	return doc


def setup(out="/tmp/xpos-rt.json"):
	frappe.set_user("Administrator")
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

	if not frappe.db.exists("POS Profile", POS_PROFILE):
		profile = frappe.get_doc(
			{
				"doctype": "POS Profile",
				"name": POS_PROFILE,
				"company": COMPANY,
				"warehouse": warehouse,
				"customer": CUSTOMER,
				"currency": company.default_currency,
				"selling_price_list": "Standard Selling",
				"update_stock": 1,
				"write_off_account": company.write_off_account or company.round_off_account,
				"write_off_cost_center": company.cost_center,
				"payments": [{"mode_of_payment": "Cash", "default": 1}],
				"applicable_for_users": [{"user": "Administrator", "default": 1}],
				"use_offline_mode": 1,
			}
		)
		profile.insert(ignore_permissions=True)

	from frappe.core.doctype.user.user import generate_keys

	api_secret = generate_keys("Administrator")["api_secret"]
	api_key = frappe.db.get_value("User", "Administrator", "api_key")
	frappe.db.commit()

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
	}
	with open(out, "w") as f:
		json.dump(result, f, indent=1)
	return {k: v for k, v in result.items() if k != "api_secret"}
