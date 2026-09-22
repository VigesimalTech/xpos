import unittest

import frappe  # noqa: F401  (the stub or the bench)

from xpos.api.auth import ALL_PERMISSION_KEYS, TILL_BASE_PERMISSION_KEYS, till_permission_keys


class TestTillPermissionKeys(unittest.TestCase):
	"""A till writes every field of a pulled cashier into a column of its own; a field it
	has no column for fails the whole pull. So a till gets the permission keys it had
	before K19, plus the newer ones only when it asks for them by name."""

	def test_an_older_till_gets_the_keys_it_knows(self):
		self.assertEqual(till_permission_keys(["*"]), TILL_BASE_PERMISSION_KEYS)
		self.assertEqual(till_permission_keys(None), TILL_BASE_PERMISSION_KEYS)
		self.assertNotIn("approve_exceptions", till_permission_keys(["*"]))

	def test_a_till_that_asks_gets_the_newer_keys(self):
		keys = till_permission_keys(["*", "approve_exceptions", "no_sale_drawer", "remove_cart_items"])
		self.assertIn("approve_exceptions", keys)
		self.assertIn("no_sale_drawer", keys)
		self.assertIn("remove_cart_items", keys)
		self.assertNotIn("void_after_payment", keys)
		self.assertTrue(set(TILL_BASE_PERMISSION_KEYS) <= set(keys))

	def test_a_till_cannot_ask_for_what_is_not_a_permission(self):
		self.assertNotIn("password", till_permission_keys(["*", "password"]))

	def test_the_base_keys_are_those_before_k19(self):
		self.assertEqual(len(TILL_BASE_PERMISSION_KEYS), 15)
		self.assertTrue(set(TILL_BASE_PERMISSION_KEYS) < set(ALL_PERMISSION_KEYS))

	def test_a_till_that_asks_gets_the_screen_keys(self):
		keys = till_permission_keys(["*", "view_reports", "barcode_printer", "price_checker", "purchasing"])
		self.assertTrue({"view_reports", "barcode_printer", "price_checker", "purchasing"} <= set(keys))
		self.assertNotIn("purchasing", till_permission_keys(["*"]))


class TestProfilesByUser(unittest.TestCase):
	"""A till offers a cashier only the POS Profiles they are on when a shift opens:
	ERPNext refuses a shift on any other, and every sale in it would be stranded."""

	def test_every_profile_of_each_user_once_in_name_order(self):
		from xpos.api.auth import profiles_by_user

		rows = [
			{"user": "both@x", "pos_profile": "Shop B"},
			{"user": "both@x", "pos_profile": "Shop A"},
			{"user": "both@x", "pos_profile": "Shop A"},
			{"user": "one@x", "pos_profile": "Shop A"},
		]
		self.assertEqual(profiles_by_user(rows), {"both@x": ["Shop A", "Shop B"], "one@x": ["Shop A"]})

	def test_only_a_till_that_asks_gets_the_list(self):
		from xpos.api.auth import asked_fields

		self.assertIn("pos_profiles", asked_fields('["*", "pos_profiles"]'))
		self.assertNotIn("pos_profiles", asked_fields(["*"]))


class TestProfileAccessByUser(unittest.TestCase):
	"""A user on two POS Profiles may be a cashier on one and a supervisor on the other. The
	till's cashier row carries the first profile's role, limit and PIN only, so it also
	gets this, per profile, and uses the entry for the profile its shift is open on."""

	def access(self, rows):
		from unittest.mock import patch

		from xpos.api.auth import profile_access_by_user

		roles = {"Supervisor": {"close_shift": True, "expense": True}, "Cashier": {"close_shift": False}}
		with patch("xpos.api.auth.get_role_permissions", side_effect=lambda r: roles.get(r, {})):
			return profile_access_by_user(rows, ("close_shift", "expense"))

	def test_each_profile_has_its_own_role_limit_and_pin(self):
		access = self.access(
			[
				{"user": "u@x", "pos_profile": "Shop A", "pos_role": "Cashier", "discount_limit": 5},
				{
					"user": "u@x",
					"pos_profile": "Shop B",
					"pos_role": "Supervisor",
					"discount_limit": 30,
					"xpos_pin_hash": "h",
					"xpos_pin_salt": "s",
				},
			]
		)
		self.assertEqual(access["u@x"]["Shop A"]["role"], "Cashier")
		self.assertEqual(access["u@x"]["Shop A"]["close_shift"], 0)
		self.assertEqual(access["u@x"]["Shop A"]["discount_limit"], 5)
		self.assertEqual(access["u@x"]["Shop B"]["role"], "Supervisor")
		self.assertEqual(access["u@x"]["Shop B"]["close_shift"], 1)
		self.assertEqual(access["u@x"]["Shop B"]["expense"], 1)
		self.assertEqual(access["u@x"]["Shop B"]["discount_limit"], 30)
		self.assertEqual(
			(access["u@x"]["Shop B"]["pin_hash"], access["u@x"]["Shop B"]["pin_salt"]), ("h", "s")
		)

	def test_no_role_is_a_cashier_and_no_limit_is_none(self):
		entry = self.access(
			[{"user": "u@x", "pos_profile": "Shop A", "pos_role": None, "discount_limit": None}]
		)["u@x"]["Shop A"]
		self.assertEqual(entry["role"], "Cashier")
		self.assertEqual(entry["discount_limit"], 0)
		self.assertEqual(entry["pin_hash"], "")

	def test_the_first_row_of_a_user_on_a_profile_wins(self):
		access = self.access(
			[
				{"user": "u@x", "pos_profile": "Shop A", "pos_role": "Supervisor"},
				{"user": "u@x", "pos_profile": "Shop A", "pos_role": "Cashier"},
			]
		)
		self.assertEqual(access["u@x"]["Shop A"]["role"], "Supervisor")

	def test_only_a_till_that_asks_gets_it(self):
		from xpos.api.auth import asked_fields

		self.assertIn("profile_access", asked_fields('["*", "profile_access"]'))
		self.assertNotIn("profile_access", asked_fields(["*"]))
