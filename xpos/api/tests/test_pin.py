import hashlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from xpos.api import pin

# Node's crypto.scryptSync("1234", "0123456789abcdef0123456789abcdef", 64): the
# till verifies PINs with that call (electron/database/passwordHash.ts), so the
# server's hash must match it byte for byte.
NODE_SALT = "0123456789abcdef0123456789abcdef"
NODE_HASH_1234 = (
	"d0caf5e9d4e56daa5b37a77f8f8379c934032d6f50cacd5fd8ad8d32f6aff2c8"
	"7a8ef1f5ae092f3a044ff09853d642e92791797b903e76a6b9e3cd0699b7fbdf"
)


def user_row(**values):
	row = {
		"user": "cashier@example.com",
		"xpos_pin": None,
		"xpos_pin_hash": None,
		"xpos_pin_salt": None,
		"xpos_pin_set": 0,
	}
	row.update(values)
	return SimpleNamespace(**row)


class TestPinHash(unittest.TestCase):
	"""K6: a till PIN is stored only as a hash the till can check offline."""

	def test_hash_matches_what_the_till_computes(self):
		self.assertEqual(pin.hash_pin("1234", NODE_SALT), NODE_HASH_1234)

	def test_a_new_pin_is_hashed_and_not_stored(self):
		row = user_row(xpos_pin="4821")
		pin.hash_new_pins(SimpleNamespace(applicable_for_users=[row]))

		self.assertIsNone(row.xpos_pin)
		self.assertEqual(row.xpos_pin_set, 1)
		self.assertEqual(len(row.xpos_pin_salt), 32)
		self.assertEqual(row.xpos_pin_hash, pin.hash_pin("4821", row.xpos_pin_salt))

	def test_each_pin_gets_its_own_salt(self):
		a, b = user_row(xpos_pin="4821"), user_row(xpos_pin="4821")
		pin.hash_new_pins(SimpleNamespace(applicable_for_users=[a, b]))
		self.assertNotEqual(a.xpos_pin_salt, b.xpos_pin_salt)
		self.assertNotEqual(a.xpos_pin_hash, b.xpos_pin_hash)

	def test_an_unchanged_pin_is_left_alone(self):
		row = user_row(xpos_pin="*****", xpos_pin_hash="old", xpos_pin_salt="salt", xpos_pin_set=1)
		pin.hash_new_pins(SimpleNamespace(applicable_for_users=[row]))
		self.assertEqual((row.xpos_pin_hash, row.xpos_pin_salt), ("old", "salt"))

	@patch("xpos.api.pin.frappe")
	def test_rejects_a_pin_that_is_not_4_to_6_digits(self, mock_frappe):
		mock_frappe.throw.side_effect = ValueError
		for bad in ("123", "1234567", "12a4", " 1234"):
			with self.subTest(pin=bad), self.assertRaises(ValueError):
				pin.hash_new_pins(SimpleNamespace(applicable_for_users=[user_row(xpos_pin=bad)]))

	def test_uses_scrypt(self):
		expected = hashlib.scrypt(b"1234", salt=NODE_SALT.encode(), n=16384, r=8, p=1, dklen=64).hex()
		self.assertEqual(pin.hash_pin("1234", NODE_SALT), expected)


if __name__ == "__main__":
	unittest.main()
