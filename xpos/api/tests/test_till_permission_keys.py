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
