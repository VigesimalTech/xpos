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


class _Site:
	"""Just enough of a site for the permission patches: the POS Permission catalog, and
	POS Roles whose save fills in every catalog permission they lack as disabled, as
	POSRole.validate does."""

	def __init__(self, catalog, roles):
		self.catalog = set(catalog)
		self.roles = {name: dict(perms) for name, perms in roles.items()}

	def get_all(self, doctype, pluck=None, **_):
		return sorted(self.catalog) if doctype == "POS Permission" else sorted(self.roles)

	def exists(self, doctype, name):
		return name in self.catalog

	def get_doc(self, doctype_or_dict, name=None):
		from types import SimpleNamespace

		site = self
		if isinstance(doctype_or_dict, dict):
			return SimpleNamespace(insert=lambda **_: site.catalog.add(doctype_or_dict["permission_name"]))
		rows = [SimpleNamespace(permission=k, enabled=v) for k, v in self.roles[name].items()]

		def append(_field, row):
			rows.append(SimpleNamespace(**row))

		def save(**_):
			perms = {row.permission: row.enabled for row in rows}
			for missing in site.catalog - set(perms):
				perms[missing] = 0
			site.roles[name] = perms

		return SimpleNamespace(permissions=rows, append=append, save=save)


class TestUpgradeAcrossSeveralPatches(unittest.TestCase):
	"""A site upgraded from before K19 runs the K19 patch and then this one in one migrate.
	The K19 patch saves every role; if it had seeded the whole catalog, that save would
	add the screen permissions disabled, and this patch would skip them."""

	def test_managers_get_every_screen_after_the_k19_patch_has_run_first(self):
		from unittest import mock

		import frappe

		from xpos.install import ALL_PERMISSION_NAMES
		from xpos.patches import add_approval_permissions, add_screen_permissions
		from xpos.patches.add_approval_permissions import NEW_PERMISSIONS as K19

		before_k19 = set(ALL_PERMISSION_NAMES) - set(K19) - set(NEW_PERMISSIONS)
		site = _Site(before_k19, {"Manager": dict.fromkeys(before_k19, 1), "Cashier": {}})
		db = mock.Mock(exists=site.exists)
		with (
			mock.patch.object(frappe, "db", db, create=True),
			mock.patch.object(frappe, "get_all", site.get_all, create=True),
			mock.patch.object(frappe, "get_doc", site.get_doc, create=True),
			mock.patch("xpos.api.auth.clear_role_permission_cache"),
		):
			add_approval_permissions.execute()
			add_screen_permissions.execute()

		self.assertEqual(
			{k: site.roles["Manager"][k] for k in NEW_PERMISSIONS}, dict.fromkeys(NEW_PERMISSIONS, 1)
		)
		self.assertEqual(site.roles["Cashier"]["price_checker"], 1)
		self.assertEqual(site.roles["Cashier"]["view_reports"], 0)
		self.assertEqual(site.roles["Manager"]["approve_exceptions"], 1)


class TestChangeLedgerSetting(unittest.TestCase):
	"""A cash sale that gives change needs POS Settings' change ledger entries on. A fresh
	install marks its patches done without running them, so after_install sets it too."""

	def test_switched_on_when_off_and_left_alone_when_on(self):
		from unittest import mock

		import frappe

		from xpos import install

		store = {"post_change_gl_entries": 0}
		db = mock.Mock(
			get_single_value=lambda dt, f: store[f],
			set_single_value=lambda dt, f, v: store.__setitem__(f, v),
		)
		with mock.patch.object(frappe, "db", db, create=True):
			self.assertTrue(install.enable_change_gl_entries())
			self.assertEqual(store["post_change_gl_entries"], 1)
			self.assertFalse(install.enable_change_gl_entries())

	def test_a_fresh_install_sets_it(self):
		from unittest import mock

		from xpos import install

		with (
			mock.patch.object(install, "seed_pos_permissions"),
			mock.patch.object(install, "seed_default_roles"),
			mock.patch.object(install, "enable_change_gl_entries") as enable,
		):
			install.after_install()
		enable.assert_called_once()
