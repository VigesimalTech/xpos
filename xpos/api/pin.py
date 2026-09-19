"""Till PINs for signing in on the desktop app.

A manager sets a cashier's PIN on the cashier's row in the POS Profile's
user table. It is hashed here, on save, and only the hash and its salt are
kept; the PIN field is cleared before the row is written. Tills pull the
hash with the POS users and check a PIN offline with the same scrypt
settings (electron/database/passwordHash.ts), so the two must not drift.
"""

import hashlib
import re
import secrets

import frappe
from frappe import _

# Node's crypto.scrypt defaults, which the till uses: N=16384, r=8, p=1, 64 bytes.
SCRYPT = {"n": 16384, "r": 8, "p": 1, "dklen": 64}
PIN_PATTERN = re.compile(r"\d{4,6}")


def hash_pin(pin: str, salt: str) -> str:
	"""Hex scrypt hash of a PIN, as the till computes it (the salt is used as text)."""
	return hashlib.scrypt(pin.encode(), salt=salt.encode(), **SCRYPT).hex()


def _is_masked(value: str) -> bool:
	# Frappe shows a saved Password field as asterisks; that is not a new PIN.
	return set(value) == {"*"}


def hash_new_pins(doc, method=None):
	"""POS Profile validate hook: hash any PIN typed into a user row, then clear it."""
	for row in getattr(doc, "applicable_for_users", None) or []:
		pin = row.xpos_pin
		if not pin or _is_masked(pin):
			continue
		if not PIN_PATTERN.fullmatch(pin):
			frappe.throw(_("The till PIN for {0} must be 4 to 6 digits.").format(row.user))
		salt = secrets.token_hex(16)
		row.xpos_pin_hash = hash_pin(pin, salt)
		row.xpos_pin_salt = salt
		row.xpos_pin_set = 1
		row.xpos_pin = None
