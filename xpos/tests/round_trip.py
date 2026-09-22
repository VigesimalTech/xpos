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
	"rt-supervisor@example.com": [POS_PROFILE],
}
# The till's cash and close tests: a cashier whose POS Role may record expenses and
# bank drops and close a shift (the installed Manager role).
# The cashier in both shops is a Manager in the second only: a till takes their role and
# limit from the profile of its open shift, not from their first profile.
POS_ROLES = {
	("rt-supervisor@example.com", POS_PROFILE): "Manager",
	("rt-both@example.com", POS_PROFILE_2): "Manager",
}
BANK_ACCOUNT = "RT Bank"
# The sale-policy tests: this cashier may give up to 10% alone; the second shop
# rejects out-of-policy sales rather than flagging them. The supervisor (Manager, so
# Approve Exceptions) approves on the till up to their own 30%.
CASHIER_DISCOUNT_LIMIT = {
	("rt-cashier@example.com", POS_PROFILE): 10,
	("rt-supervisor@example.com", POS_PROFILE): 30,
	("rt-both@example.com", POS_PROFILE_2): 25,
}
REJECT_PROFILE = POS_PROFILE_2
# What a till's API user needs to read everything the till pulls with frappe.client.get_list.
TILLS = {"rt-till@example.com", "rt-till-2@example.com"}
TILL_ROLES = ["Accounts User", "Sales User", "Sales Manager", "Stock User"]
# The desktop tests sign cashiers in on the till, and a cashier's first sign-in on a
# till is checked against ERPNext. Test users on a throwaway site only.
CASHIER_PASSWORD = "rt-cashier-password"
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


def _ensure_user(email, roles=("Sales User",)):
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": email.split("@")[0],
				"send_welcome_email": 0,
				"roles": [{"role": role} for role in roles],
			}
		).insert(ignore_permissions=True)


def _keys_for(user):
	"""The user's API key and secret, made once: running the seed again keeps them."""
	from frappe.core.doctype.user.user import generate_keys
	from frappe.utils.password import get_decrypted_password

	api_key = frappe.db.get_value("User", user, "api_key")
	secret = api_key and get_decrypted_password("User", user, "api_secret", raise_exception=False)
	if not secret:
		secret = generate_keys(user)["api_secret"]
		api_key = frappe.db.get_value("User", user, "api_key")
	return {"api_key": api_key, "api_secret": secret}


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

	from frappe.utils.password import update_password

	for email in CASHIERS:
		_ensure_user(email, TILL_ROLES if email in TILLS else ("Sales User",))
		if email not in TILLS:
			update_password(email, CASHIER_PASSWORD)

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
				"allow_discount_change": 1,
			}
		)
		profile.insert(ignore_permissions=True)

	for (user, profile_name), limit in CASHIER_DISCOUNT_LIMIT.items():
		frappe.db.set_value(
			"POS Profile User", {"parent": profile_name, "user": user}, "discount_limit", limit
		)
	frappe.db.set_value("POS Profile", REJECT_PROFILE, "xpos_out_of_policy_action", "Reject")

	from xpos.install import seed_default_roles, seed_pos_permissions

	seed_pos_permissions()
	seed_default_roles()
	for (user, profile_name), role in POS_ROLES.items():
		frappe.db.set_value("POS Profile User", {"parent": profile_name, "user": user}, "pos_role", role)

	# Expenses and bank drops on the first shop.
	expense_account = frappe.db.get_value(
		"Account", {"company": COMPANY, "root_type": "Expense", "is_group": 0, "account_type": ""}, "name"
	) or frappe.db.get_value("Account", {"company": COMPANY, "root_type": "Expense", "is_group": 0}, "name")
	bank_parent = frappe.db.get_value(
		"Account", {"company": COMPANY, "account_type": "Bank", "is_group": 1}, "name"
	)
	deposit_account = _ensure(
		"Account",
		f"{BANK_ACCOUNT} - {ABBR}",
		{
			"account_name": BANK_ACCOUNT,
			"company": COMPANY,
			"parent_account": bank_parent,
			"account_type": "Bank",
			"is_group": 0,
		},
	).name
	cash_profile = frappe.get_doc("POS Profile", POS_PROFILE)
	cash_profile.enable_cash_movement = 1
	cash_profile.allow_pos_expense = 1
	cash_profile.allow_cash_deposit = 1
	if not any(row.account == expense_account for row in cash_profile.get("allowed_expense_accounts") or []):
		cash_profile.append("allowed_expense_accounts", {"account": expense_account})
	cash_profile.save(ignore_permissions=True)

	admin = _keys_for("Administrator")

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
		"api_key": admin["api_key"],
		"api_secret": admin["api_secret"],
		"pos_profile_2": POS_PROFILE_2,
		"cashiers": CASHIERS,
		"tills": tills,
		"unassigned": unassigned,
		"discount_limits": {f"{u}|{p}": v for (u, p), v in CASHIER_DISCOUNT_LIMIT.items()},
		"reject_profile": REJECT_PROFILE,
		"supervisor": "rt-supervisor@example.com",
		"expense_account": expense_account,
		"deposit_account": deposit_account,
		"cashier_password": CASHIER_PASSWORD,
	}
	# A CI-only seed: `out` is the path the workflow passes. The secret goes to a
	# file rather than the return value, which bench prints to the job log.
	with open(out, "w") as f:  # nosemgrep
		json.dump(result, f, indent=1)
	return {"company": COMPANY, "pos_profiles": [POS_PROFILE, POS_PROFILE_2]}
