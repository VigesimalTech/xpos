import unittest

from xpos.patches.add_approval_permissions import NEW_PERMISSIONS, new_permission_defaults


class TestApprovalPermissionDefaults(unittest.TestCase):
	"""K19: the new permissions on POS Roles that already exist. Silence would either widen
	every cashier's rights or leave a shop with nobody able to approve."""

	def test_the_manager_role_approves_and_may_do_the_new_actions(self):
		self.assertEqual(new_permission_defaults("Manager", set()), dict.fromkeys(NEW_PERMISSIONS, 1))

	def test_the_administrator_role_approves_and_may_do_the_new_actions(self):
		self.assertEqual(new_permission_defaults("Administrator", set()), dict.fromkeys(NEW_PERMISSIONS, 1))

	def test_a_role_that_manages_role_permissions_approves(self):
		self.assertEqual(
			new_permission_defaults("Shop Lead", {"manage_role_permissions"}),
			dict.fromkeys(NEW_PERMISSIONS, 1),
		)

	def test_every_other_role_gets_none_of_them(self):
		self.assertEqual(new_permission_defaults("Cashier", set()), dict.fromkeys(NEW_PERMISSIONS, 0))
		self.assertEqual(
			new_permission_defaults("Senior Cashier", {"sale_return", "allow_change_price"}),
			dict.fromkeys(NEW_PERMISSIONS, 0),
		)

	def test_the_new_permissions(self):
		self.assertEqual(
			set(NEW_PERMISSIONS),
			{
				"approve_exceptions",
				"void_after_payment",
				"no_sale_drawer",
				"return_without_receipt",
				"remove_cart_items",
			},
		)

	def test_a_cashier_may_not_remove_items_from_the_cart_alone(self):
		# Off for cashiers straight away (the user's call, 21 Sep): a manager approves.
		self.assertEqual(new_permission_defaults("Cashier", set())["remove_cart_items"], 0)
		self.assertEqual(new_permission_defaults("Manager", set())["remove_cart_items"], 1)
