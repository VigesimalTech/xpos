import unittest

from xpos.api.approval import apply_approval, approval_problems, permission_by_approval

CASHIER = "cashier@example.com"
MANAGER = "manager@example.com"


def problems(approver=MANAGER, *, cashier=CASHIER, on_profile=True, can_approve=True, self_approval=False):
	return approval_problems(
		cashier=cashier,
		approver=approver,
		pos_profile="Shop 1",
		approver_on_profile=on_profile,
		approver_can_approve=can_approve,
		allow_self_approval=self_approval,
	)


class TestApprover(unittest.TestCase):
	"""K19: who may approve what a cashier may not do alone."""

	def test_a_manager_of_the_shop_with_approve_exceptions_may_approve(self):
		self.assertEqual(problems(), [])

	def test_an_approver_needs_approve_exceptions(self):
		self.assertEqual(len(problems(can_approve=False)), 1)

	def test_an_approver_from_another_shop_may_not_approve(self):
		# A till cannot use the PIN of someone who does not work that shop.
		self.assertEqual(len(problems(on_profile=False)), 1)

	def test_a_cashier_may_not_approve_their_own_sale(self):
		self.assertEqual(len(problems(CASHIER)), 1)

	def test_self_approval_only_when_the_pos_profile_allows_it(self):
		self.assertEqual(problems(CASHIER, self_approval=True), [])

	def test_every_problem_is_named(self):
		self.assertEqual(len(problems(CASHIER, on_profile=False, can_approve=False)), 3)


class TestApplyApproval(unittest.TestCase):
	"""An approved sale is held to the approver's rights, and records what was approved."""

	def test_without_exceptions_there_is_nothing_to_approve(self):
		self.assertEqual(apply_approval([], MANAGER, [], []), ([], None, None))

	def test_without_an_approver_the_cashiers_exceptions_stand(self):
		self.assertEqual(apply_approval(["over limit"], None, [], []), (["over limit"], None, None))

	def test_a_valid_approval_clears_what_the_approver_may_do(self):
		flags, approved_by, approved = apply_approval(["25% off, over 10%"], MANAGER, [], [])
		self.assertEqual(flags, [])
		self.assertEqual(approved_by, MANAGER)
		self.assertEqual(approved, "25% off, over 10%")

	def test_what_the_approver_may_not_do_either_still_stands(self):
		# A manager with a 20% limit approving 50% off: the sale is still out of policy.
		flags, approved_by, approved = apply_approval(
			["50% off, over the cashier's 10%"], MANAGER, [], ["50% off, over the manager's 20%"]
		)
		self.assertEqual(flags, ["50% off, over the manager's 20%"])
		self.assertEqual(approved_by, MANAGER)
		self.assertEqual(approved, "50% off, over the cashier's 10%")

	def test_an_invalid_approval_approves_nothing_and_says_why(self):
		flags, approved_by, approved = apply_approval(
			["over limit"], CASHIER, ["cannot approve their own sale"], []
		)
		self.assertEqual(flags, ["over limit", "cannot approve their own sale"])
		self.assertIsNone(approved_by)
		self.assertIsNone(approved)


class TestPermissionByApproval(unittest.TestCase):
	"""An action the cashier's role lacks (an expense, a bank drop) is allowed only with a
	valid approval by someone whose own role allows it."""

	def test_a_cashier_with_the_permission_needs_no_approval(self):
		self.assertEqual(permission_by_approval(True, MANAGER, [], True), (True, None, []))

	def test_without_the_permission_or_an_approver_it_is_refused(self):
		allowed, approved_by, reasons = permission_by_approval(False, None, [], False)
		self.assertFalse(allowed)
		self.assertIsNone(approved_by)

	def test_a_valid_approver_who_holds_the_permission_allows_it(self):
		self.assertEqual(permission_by_approval(False, MANAGER, [], True), (True, MANAGER, []))

	def test_an_approver_who_lacks_the_permission_too_cannot_allow_it(self):
		allowed, approved_by, reasons = permission_by_approval(False, MANAGER, [], False)
		self.assertFalse(allowed)
		self.assertIsNone(approved_by)
		self.assertEqual(len(reasons), 1)

	def test_an_invalid_approval_allows_nothing_and_says_why(self):
		self.assertEqual(
			permission_by_approval(False, CASHIER, ["cannot approve their own"], True),
			(False, None, ["cannot approve their own"]),
		)
