import unittest

from xpos.patches.add_screen_permissions import NEW_PERMISSIONS, new_permission_defaults


class TestScreenPermissionDefaults(unittest.TestCase):
	"""K27: the screen permissions on POS Roles that already exist."""

	def test_the_manager_role_gets_every_screen(self):
		self.assertEqual(new_permission_defaults("Manager", set()), dict.fromkeys(NEW_PERMISSIONS, 1))

	def test_the_administrator_role_gets_every_screen(self):
		self.assertEqual(new_permission_defaults("Administrator", set()), dict.fromkeys(NEW_PERMISSIONS, 1))

	def test_a_role_that_manages_role_permissions_gets_every_screen(self):
		self.assertEqual(
			new_permission_defaults("Shop Lead", {"manage_role_permissions"}),
			dict.fromkeys(NEW_PERMISSIONS, 1),
		)

	def test_every_other_role_keeps_the_price_checker_only(self):
		expected = {"view_reports": 0, "barcode_printer": 0, "price_checker": 1, "purchasing": 0}
		self.assertEqual(new_permission_defaults("Cashier", set()), expected)
		self.assertEqual(new_permission_defaults("Senior Cashier", {"sale_return"}), expected)

	def test_the_new_permissions_are_in_the_catalog_and_the_server_keys(self):
		from xpos.api.auth import ALL_PERMISSION_KEYS
		from xpos.install import ALL_PERMISSION_NAMES

		self.assertTrue(set(NEW_PERMISSIONS) <= set(ALL_PERMISSION_NAMES))
		self.assertTrue(set(NEW_PERMISSIONS) <= set(ALL_PERMISSION_KEYS))


class TestPosRoleFormFollowsTheCatalog(unittest.TestCase):
	"""The POS Role form in ERPNext is the only place a manager ticks these outside the
	web POS. It listed retired keys and none of K19's until K27; keep it to the catalog."""

	def test_the_form_lists_every_catalog_permission_and_nothing_else(self):
		import re
		from pathlib import Path

		from xpos.install import ALL_PERMISSION_NAMES

		form = Path(__file__).parents[2] / "x_pos" / "doctype" / "pos_role" / "pos_role.js"
		keys = re.findall(r'\{ key: "(\w+)"', form.read_text())
		self.assertEqual(sorted(keys), sorted(ALL_PERMISSION_NAMES))
