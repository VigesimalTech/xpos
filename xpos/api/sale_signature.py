"""Signed sales (K43): a sale changed on the till after payment is seen when it arrives.

A till takes payment and keeps the sale in its local database until ERPNext has it,
sometimes for hours. Anyone with that database's password could take lines out of a
paid sale before it syncs: the sale would book smaller and the drawer would still
match. So at payment the till signs what the sale is worth (its lines, payments,
discounts, cashier and approver) with a key only that till holds, kept in the PC's
own secure store, and numbers its sales one after another.

ERPNext knows each till's public key (`POS Till Key`, one per till API user, kept
from the first signed sale that till sends). A sale whose signature does not match, or that
arrives unsigned from a till that signs, is still booked, since the money was
taken, and is flagged for review like a sale outside policy. A number that never
arrives is a sale that never reached ERPNext; the Missing Till Sales report lists
them.

`canonical_sale` must build exactly the string the till builds
(`frontend/electron/security/saleSignature.ts`); both are tested against
`xpos/tests/fixtures/sale_signature_vectors.json`.
"""

import base64
import hashlib
import json
import math

import frappe
from frappe import _
from frappe.utils import now_datetime

from xpos.api.till import sent_by_till

VERSION = 1

HEADER_TEXT = (
	"pos_profile",
	"xpos_cashier",
	"xpos_approved_by",
	"return_against",
	"currency",
	"pos_delivery_charges",
)
HEADER_NUMBERS = (
	"is_return",
	"additional_discount_percentage",
	"discount_amount",
	"loyalty_points",
	"redeem_loyalty_points",
	"write_off_amount",
	"change_amount",
	"pos_delivery_charges_rate",
	"conversion_rate",
	"is_credit_sale",
)
ITEM_TEXT = ("item_code", "uom", "serial_no", "batch_no")
ITEM_NUMBERS = ("qty", "rate", "discount_percentage", "discount_amount", "is_free_item")
PAYMENT_TEXT = ("mode_of_payment",)
PAYMENT_NUMBERS = ("amount",)


def _number(value) -> int:
	"""A number as millionths, rounded half up: the same integer in Python and JavaScript."""
	try:
		number = float(value or 0)
	except (TypeError, ValueError):
		return 0
	if not math.isfinite(number):
		return 0
	return math.floor(number * 1_000_000 + 0.5)


def _text(value) -> str:
	if value is None:
		return ""
	if isinstance(value, (dict, list)):
		return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
	return str(value)


def _row(source: dict, texts: tuple, numbers: tuple) -> list:
	return [_text(source.get(k)) for k in texts] + [_number(source.get(k)) for k in numbers]


def _rows(data: dict, key: str, texts: tuple, numbers: tuple) -> list:
	return [_row(row or {}, texts, numbers) for row in (data.get(key) or [])]


def canonical_sale(data: dict, local_id: str, sequence: int) -> str:
	"""What the till signs: the parts of a sale that decide what it is worth."""
	body = [
		VERSION,
		_text(local_id),
		int(sequence),
		_row(data, HEADER_TEXT, HEADER_NUMBERS),
		_rows(data, "items", ITEM_TEXT, ITEM_NUMBERS),
		_rows(data, "payments", PAYMENT_TEXT, PAYMENT_NUMBERS),
		_rows(data, "pos_change_legs", PAYMENT_TEXT, PAYMENT_NUMBERS),
	]
	return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


def _raw_key(public_key: str) -> bytes:
	padded = public_key + "=" * (-len(public_key) % 4)
	raw = base64.urlsafe_b64decode(padded)
	if len(raw) != 32:
		raise ValueError("not an Ed25519 public key")
	return raw


def key_id_of(public_key: str) -> str:
	"""A short name for a public key, shown on the invoice and the till's key record."""
	return hashlib.sha256(_raw_key(public_key)).hexdigest()[:16]


def signature_valid(public_key: str, canonical: str, signature: str) -> bool:
	from cryptography.exceptions import InvalidSignature
	from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

	try:
		key = Ed25519PublicKey.from_public_bytes(_raw_key(public_key))
		key.verify(base64.b64decode(signature), canonical.encode("utf-8"))
		return True
	except (InvalidSignature, ValueError, TypeError):
		return False


def signature_of(data: dict) -> dict:
	signed = data.get("xpos_signature") or {}
	if isinstance(signed, str):
		try:
			signed = json.loads(signed)
		except ValueError:
			return {}
	return signed if isinstance(signed, dict) else {}


def check_signature(data: dict, local_id: str | None, public_key: str | None) -> tuple[list[str], dict]:
	"""The flags for a till's sale, and what to record on the invoice. No database.

	`public_key` is the key ERPNext holds for the till that sent it, None if it has none
	(a till from before signing): then an unsigned sale is not flagged.
	"""
	signed = signature_of(data)
	if not signed.get("sig"):
		if public_key:
			return [
				_(
					"The sale reached ERPNext without the till's signature: it may have been changed on the till after payment."
				)
			], {}
		return [], {}

	record = {"xpos_till_key": _text(signed.get("key_id"))[:16], "xpos_till_sequence": 0}
	try:
		sequence = int(signed.get("seq"))
		record["xpos_till_sequence"] = sequence
	except (TypeError, ValueError):
		sequence = None

	if not public_key:
		return [_("The sale is signed with a till key ERPNext does not hold.")], record
	if signed.get("key_id") != key_id_of(public_key):
		return [
			_("The sale is signed with a different key from the one ERPNext holds for this till.")
		], record
	if sequence is None or not signature_valid(
		public_key, canonical_sale(data, local_id or "", sequence), _text(signed.get("sig"))
	):
		return [
			_(
				"The sale was changed on the till after payment: its lines, payments or discounts do not match what the till signed."
			)
		], record
	return [], record


def till_public_key(till_user: str) -> str | None:
	return frappe.db.get_value("POS Till Key", {"till_user": till_user}, "public_key")


def check_till_signature(data: dict, local_id: str | None) -> tuple[list[str], dict]:
	"""`check_signature` for a sale as it arrives, against the sending till's key.

	Call it before anything reads the sale, so it sees what the till signed. A person's
	own sign-in (the web POS) has no till key: nothing to check.

	ERPNext keeps the first key a till user's sales carry. Another key after that is
	refused, and recorded, until an administrator deletes the till's POS Till Key (after
	reinstalling the till, say): otherwise anyone at the PC could make a new key and sign
	whatever they liked with it.
	"""
	if not sent_by_till() or not local_id:
		return [], {}
	till_user = frappe.session.user
	signed = signature_of(data)
	offered = _text(signed.get("public_key"))
	registered = till_public_key(till_user)
	if not registered and offered:
		registered = _register_key(till_user, offered, signed.get("device"))
	elif registered and offered and offered != registered:
		_record_refused_key(till_user, offered, registered, signed.get("device"))
	return check_signature(data, local_id, registered)


def record_till_signature(invoice_doc, record: dict) -> None:
	for fieldname, value in record.items():
		if invoice_doc.meta.has_field(fieldname):
			invoice_doc.set(fieldname, value)


def _register_key(till_user: str, public_key: str, device) -> str | None:
	"""Keep a till user's first key. The key ERPNext then holds, None if it is not a key."""
	try:
		key_id = key_id_of(public_key)
	except (ValueError, TypeError):
		return None
	try:
		frappe.get_doc(
			{
				"doctype": "POS Till Key",
				"till_user": till_user,
				"public_key": public_key,
				"key_id": key_id,
				"device_name": _text(device)[:140],
				"registered_on": now_datetime(),
			}
		).insert(ignore_permissions=True)
	except frappe.DuplicateEntryError:
		# Another sale from the same till user got there first.
		pass
	return till_public_key(till_user)


def _record_refused_key(till_user: str, offered: str, registered: str, device) -> None:
	"""One audit event per refused key, however many sales carry it."""
	try:
		offered_id = key_id_of(offered)
	except (ValueError, TypeError):
		offered_id = "?"
	registered_id = key_id_of(registered)
	request_id = f"till-key-refused:{till_user}:{offered_id}"[:140]
	if frappe.db.exists("POS Audit Event", {"client_request_id": request_id}):
		return
	frappe.get_doc(
		{
			"doctype": "POS Audit Event",
			"event_type": "Till Key Refused",
			"event_time": now_datetime(),
			"till_user": till_user,
			"description": _(
				"The till's sales carry signing key {0}, but ERPNext holds key {1} for it. They are flagged until an administrator deletes the till's POS Till Key."
			).format(offered_id, registered_id),
			"details": json.dumps(
				{"key_id": offered_id, "registered_key_id": registered_id, "device": device}
			),
			"client_request_id": request_id,
		}
	).insert(ignore_permissions=True)
