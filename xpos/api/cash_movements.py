# Copyright (c) 2026, Ali Raza and contributors
# For license information, please see license.txt


import json

import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import (
	get_bank_cash_account,
)
from frappe import _
from frappe.utils import cint, flt, now_datetime, nowdate

from xpos.api.approval import check_approver, permission_by_approval, resolve_approver
from xpos.api.auth import is_pos_manager, user_has_pos_permission
from xpos.api.profiles import resolve_pos_profile
from xpos.api.till import acting_user, sent_by_till, till_cashier

MOVEMENT_PERMISSION_KEYS = {"Expense": "expense", "Deposit": "bank_drop"}


def ensure_cash_movement_allowed(
	profile, movement_type: str, user: str | None = None, approver: str | None = None
) -> str | None:
	"""Raise unless this profile and `user` (the session's by default) may record `movement_type`.

	A cashier whose role lacks the permission may still record it with a manager's approval
	on the till (`approval.py`). Returns who approved it, or None when no approval was needed.
	"""
	if not cint(profile.get("enable_cash_movement")):
		frappe.throw(
			_("Cash Movement is disabled for POS Profile {0}.").format(profile.name),
			frappe.PermissionError,
		)

	if movement_type == "Expense" and not cint(profile.get("allow_pos_expense")):
		frappe.throw(
			_("POS Expense is disabled for POS Profile {0}.").format(profile.name),
			frappe.PermissionError,
		)

	if movement_type == "Deposit" and not cint(profile.get("allow_cash_deposit")):
		frappe.throw(
			_("Cash Deposit is disabled for POS Profile {0}.").format(profile.name),
			frappe.PermissionError,
		)

	permission_key = MOVEMENT_PERMISSION_KEYS.get(movement_type)
	if not permission_key:
		return None
	cashier = user or till_cashier() or frappe.session.user
	cashier_has = user_has_pos_permission(permission_key, cashier, pos_profile=profile.name)
	problems: list[str] = []
	approver_has = False
	if not cashier_has and approver:
		problems = check_approver(approver, cashier, profile)
		approver_has = user_has_pos_permission(permission_key, approver, pos_profile=profile.name)
	allowed, approved_by, reasons = permission_by_approval(cashier_has, approver, problems, approver_has)
	if not allowed:
		frappe.throw(
			" ".join([_("You are not permitted to record a {0}.").format(movement_type.lower()), *reasons]),
			frappe.PermissionError,
		)
	return approved_by


def validate_cash_movement_amount(profile, amount: float) -> float:
	"""Return `amount` after checking it against the profile's ceiling."""
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Amount must be greater than zero"))

	max_amount = flt(profile.get("cash_movement_max_amount"))
	if max_amount and amount > max_amount:
		frappe.throw(
			_("Amount {0} exceeds the {1} cash movement limit for POS Profile {2}.").format(
				amount, max_amount, profile.name
			),
			frappe.PermissionError,
		)

	return amount


def allowed_accounts(profile, table_fieldname: str) -> set[str]:
	"""Return the account names listed in one of the profile's allowlist tables."""
	return {row.account for row in (profile.get(table_fieldname) or []) if row.account}


def ensure_account_allowed(profile, account: str, table_fieldname: str, label: str) -> None:
	"""Raise unless `account` appears in the profile's allowlist for `label`."""
	allowed = allowed_accounts(profile, table_fieldname)
	if account not in allowed:
		frappe.throw(
			_("{0} {1} is not permitted for POS Profile {2}.").format(label, account, profile.name),
			frappe.PermissionError,
		)


def ensure_deposit_target_allowed(account: str, company: str) -> None:
	"""Raise unless `account` is a postable Bank account of `company`."""
	details = frappe.db.get_value(
		"Account", account, ["company", "account_type", "is_group", "disabled"], as_dict=True
	)
	if (
		not details
		or details.company != company
		or details.account_type != "Bank"
		or cint(details.is_group)
		or cint(details.disabled)
	):
		frappe.throw(
			_("{0} is not a deposit account available to {1}.").format(account, company),
			frappe.PermissionError,
		)


def ensure_account_company(account: str, company: str, label: str) -> None:
	"""Raise unless `account` belongs to `company`."""
	account_company = frappe.db.get_value("Account", account, "company")
	if account_company != company:
		frappe.throw(
			_("{0} {1} does not belong to {2}.").format(label, account, company),
			frappe.PermissionError,
		)


@frappe.whitelist()
def get_cash_movement_context(pos_profile: str):
	"""Returns configuration context for cash movement dialogs."""
	pos = frappe.get_cached_doc("POS Profile", pos_profile)

	enable_cash_movement = cint(pos.get("enable_cash_movement"))
	allow_pos_expense = cint(pos.get("allow_pos_expense"))
	allow_cash_deposit = cint(pos.get("allow_cash_deposit"))

	expense_accounts = frappe.get_all(
		"POS Allowed Expense Account",
		filters={"parent": pos_profile},
		fields=["account"],
		order_by="idx",
	)

	deposit_accounts = frappe.get_all(
		"Account",
		filters={"disabled": 0, "is_group": 0, "account_type": "Bank", "company": pos.company},
		fields=["name"],
		order_by="idx",
	)

	source_accounts = frappe.get_all(
		"POS Allowed Source Account",
		filters={"parent": pos_profile},
		fields=["account"],
		order_by="idx",
	)
	cash_account = None
	cash_mop = pos.get("cash_mode_of_payment") or "Cash"
	account_info = get_bank_cash_account(cash_mop, pos.company)
	cash_account = account_info.get("account")

	return {
		"enable_cash_movement": enable_cash_movement,
		"allow_pos_expense": allow_pos_expense,
		"allow_cash_deposit": allow_cash_deposit,
		"deposit_accounts": deposit_accounts,
		"expense_accounts": expense_accounts,
		"source_accounts": source_accounts,
		"cash_account": cash_account,
		"company": pos.company,
		"cost_center": pos.get("cost_center") or frappe.db.get_value("Company", pos.company, "cost_center"),
	}


@frappe.whitelist()
def create_pos_expense(payload: str | dict):
	"""Creates a POS Expense cash movement with journal entry."""

	if isinstance(payload, str):
		payload = json.loads(payload)

	pos_opening_shift = payload.get("pos_opening_shift")
	if not pos_opening_shift:
		frappe.throw(_("POS Opening Shift is required"))
	if not payload.get("expense_account"):
		frappe.throw(_("Expense account is required"))

	opening = frappe.get_doc("POS Opening Shift", pos_opening_shift)
	user = acting_user(payload.get("cashier"), opening.pos_profile)
	if opening.user != user and not is_pos_manager(user):
		frappe.throw(
			_("{0} can only create expenses for their own shift").format(user),
			frappe.PermissionError,
		)

	return _post_cash_movement(
		movement_type="Expense",
		opening=opening,
		user=user,
		amount=payload.get("amount"),
		account=payload.get("expense_account"),
		cash_account=payload.get("cash_account"),
		remarks=payload.get("reason", ""),
	)


@frappe.whitelist()
def create_cash_deposit(payload: str | dict):
	"""Creates a Cash Deposit movement with journal entry."""

	if isinstance(payload, str):
		payload = json.loads(payload)

	pos_opening_shift = payload.get("pos_opening_shift")
	if not pos_opening_shift:
		frappe.throw(_("POS Opening Shift is required"))
	if not payload.get("target_account"):
		frappe.throw(_("Target account is required"))

	opening = frappe.get_doc("POS Opening Shift", pos_opening_shift)
	user = acting_user(payload.get("cashier"), opening.pos_profile)
	if opening.user != user and not is_pos_manager(user):
		frappe.throw(
			_("{0} can only create deposits for their own shift").format(user),
			frappe.PermissionError,
		)

	return _post_cash_movement(
		movement_type="Deposit",
		opening=opening,
		user=user,
		amount=payload.get("amount"),
		account=payload.get("target_account"),
		cash_account=payload.get("cash_account"),
		remarks=payload.get("reason", ""),
	)


@frappe.whitelist(methods=["POST"])
def sync_cash_movement(data: str | dict, local_id: str | None = None):
	"""Record an expense or bank drop a till took, perhaps offline, when it syncs.

	The till sends the cashier who recorded it, the shift's name on the server and
	its own id for the record, so a retry after a lost reply does not post it twice.
	The shift may have closed since: the money left the drawer either way, so it is
	still recorded, on the day the till took it.
	"""
	if not sent_by_till():
		frappe.throw(_("Only a till can sync cash movements."), frappe.PermissionError)

	data = json.loads(data) if isinstance(data, str) else (data or {})
	movement_type = data.get("movement_type")
	if movement_type not in MOVEMENT_PERMISSION_KEYS:
		frappe.throw(_("Unknown cash movement type {0}.").format(movement_type))
	if not local_id:
		frappe.throw(_("A till's cash movement needs its local id."))
	if not data.get("pos_opening_shift"):
		frappe.throw(_("POS Opening Shift is required"))
	if not data.get("account"):
		frappe.throw(_("Target account is required"))

	client_request_id = till_request_id(local_id)
	existing = frappe.db.get_value("POS Cash Movement", {"client_request_id": client_request_id}, "name")
	if existing:
		return {"name": existing, "duplicate": True}

	opening = frappe.get_doc("POS Opening Shift", data.get("pos_opening_shift"))
	user = acting_user(data.get("cashier") or opening.user, opening.pos_profile)
	if opening.user != user and not is_pos_manager(user):
		frappe.throw(
			_("{0} can only record cash movements for their own shift").format(user),
			frappe.PermissionError,
		)

	movement = _post_cash_movement(
		movement_type=movement_type,
		opening=opening,
		user=user,
		amount=data.get("amount"),
		account=data.get("account"),
		cash_account=None,
		remarks=data.get("remarks") or "",
		posting_date=data.get("posting_date"),
		client_request_id=client_request_id,
		approver=resolve_approver(data),
	)
	return {"name": movement.get("name")}


def till_request_id(local_id: str) -> str:
	"""The client request id a till's record is stored under. Tills send UUIDs."""
	return f"till:{local_id}"


def _post_cash_movement(
	*,
	movement_type: str,
	opening,
	user: str,
	amount,
	account: str,
	cash_account: str | None,
	remarks: str,
	posting_date: str | None = None,
	client_request_id: str | None = None,
	approver: str | None = None,
):
	"""Check an expense or deposit against the POS Profile, post its journal entry and record it."""
	profile = resolve_pos_profile(opening.pos_profile)
	approved_by = ensure_cash_movement_allowed(profile, movement_type, user, approver)
	amount = validate_cash_movement_amount(profile, amount)

	company = opening.company
	cost_center = profile.get("cost_center") or frappe.db.get_value("Company", company, "cost_center")

	if movement_type == "Expense":
		ensure_account_allowed(profile, account, "allowed_expense_accounts", _("Expense account"))
		ensure_account_company(account, company, _("Expense account"))
	else:
		ensure_deposit_target_allowed(account, company)

	if cash_account:
		ensure_account_allowed(profile, cash_account, "allowed_source_accounts", _("Source account"))
		ensure_account_company(cash_account, company, _("Source account"))
	else:
		cash_account = profile.get("default_source_account")

	if not cash_account:
		cash_mop = profile.get("cash_mode_of_payment") or "Cash"
		account_info = get_bank_cash_account(cash_mop, company)
		cash_account = account_info.get("account")

	if not cash_account:
		frappe.throw(_("No source cash account is configured for POS Profile {0}.").format(profile.name))

	label = "POS Expense" if movement_type == "Expense" else "POS Cash Deposit"
	je = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"posting_date": posting_date or nowdate(),
			"company": company,
			"user_remark": f"{label}: {remarks}" if remarks else label,
			"accounts": [
				{
					"account": account,
					"debit_in_account_currency": amount,
					"cost_center": cost_center,
					"user_remark": remarks,
				},
				{
					"account": cash_account,
					"credit_in_account_currency": amount,
					"cost_center": cost_center,
					"user_remark": remarks,
				},
			],
		}
	)
	je.insert(ignore_permissions=True)
	je.submit()

	return _create_cash_movement_record(
		pos_profile=opening.pos_profile,
		pos_opening_shift=opening.name,
		user=user,
		source_account=cash_account,
		target_account=account,
		expense_account=account if movement_type == "Expense" else "",
		movement_type=movement_type,
		amount=amount,
		remarks=remarks,
		journal_entry=je.name,
		company=company,
		posting_date=posting_date,
		client_request_id=client_request_id,
		approved_by=approved_by,
	)


@frappe.whitelist()
def get_shift_cash_movements(
	pos_opening_shift: str,
	movement_type: str | None = None,
	status: str | None = None,
	search_text: str | None = None,
	from_date: str | None = None,
	to_date: str | None = None,
	limit_start: int = 0,
	limit_page_length: int = 20,
):
	"""
	Lists cash movements for a shift with search and pagination.
	"""
	filters = {"pos_opening_shift": pos_opening_shift}

	if movement_type:
		filters["movement_type"] = movement_type

	if from_date and to_date:
		filters["posting_date"] = ["between", [from_date, to_date]]
	elif from_date:
		filters["posting_date"] = [">=", from_date]
	elif to_date:
		filters["posting_date"] = ["<=", to_date]

	fields = [
		"name",
		"docstatus",
		"movement_type",
		"amount",
		"remarks",
		"posting_date",
		"posting_time",
		"journal_entry",
		"expense_account",
		"target_account",
		"source_account",
	]

	total = frappe.db.count("POS Cash Movement", filters=filters)
	data = frappe.get_list(
		"POS Cash Movement",
		filters=filters,
		fields=fields,
		limit_start=cint(limit_start),
		limit_page_length=cint(limit_page_length),
		order_by="creation desc",
	)

	return {"data": data, "total": total}


def _create_cash_movement_record(**kwargs):
	"""Create a POS Cash Movement record if the doctype exists."""
	movement = frappe.get_doc(
		{
			"doctype": "POS Cash Movement",
			"docstatus": 1,
			"pos_profile": kwargs.get("pos_profile"),
			"pos_opening_shift": kwargs.get("pos_opening_shift"),
			"user": kwargs.get("user") or (till_cashier() or frappe.session.user),
			"journal_entry": kwargs.get("journal_entry"),
			"movement_type": kwargs.get("movement_type"),
			"amount": kwargs.get("amount"),
			"source_account": kwargs.get("source_account"),
			"target_account": kwargs.get("target_account"),
			"expense_account": kwargs.get("expense_account"),
			"remarks": kwargs.get("remarks"),
			"company": kwargs.get("company"),
			"posting_date": kwargs.get("posting_date") or nowdate(),
			"posting_time": now_datetime().strftime("%H:%M:%S"),
			"status": "Submitted",
			"client_request_id": kwargs.get("client_request_id"),
			"approved_by": kwargs.get("approved_by"),
		}
	)
	movement.insert(ignore_permissions=True)
	return movement.as_dict()
