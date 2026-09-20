import unittest
from unittest.mock import MagicMock, patch


class Refused(Exception):
	pass


def _throw(message, exc=None):
	raise Refused(message)


class TillCase(unittest.TestCase):
	def setUp(self):
		from xpos.api import till

		self.till = till
		self.frappe = patch.object(till, "frappe").start()
		self.addCleanup(patch.stopall)
		self.frappe.session.user = "till@example.com"
		self.frappe.throw.side_effect = _throw
		self.on_profile = {("Shop 1", "cashier@example.com")}
		self.frappe.db.exists.side_effect = lambda doctype, filters: (
			(
				filters["parent"],
				filters["user"],
			)
			in self.on_profile
		)

	def signed_in_with(self, authorization):
		self.frappe.get_request_header.return_value = authorization


class TestActingUser(TillCase):
	"""K27: a till acts for the cashier signed in on it, never for anyone else."""

	def test_a_person_signed_in_acts_as_themselves_whatever_the_request_says(self):
		self.signed_in_with(None)
		self.frappe.session.user = "person@example.com"
		self.assertEqual(self.till.acting_user("manager@example.com", "Shop 1"), "person@example.com")

	def test_a_till_acts_for_a_cashier_of_its_pos_profile(self):
		self.signed_in_with("token key:secret")
		self.assertEqual(self.till.acting_user("cashier@example.com", "Shop 1"), "cashier@example.com")

	def test_a_till_cannot_act_for_someone_not_on_the_pos_profile(self):
		self.signed_in_with("token key:secret")
		with self.assertRaises(Refused):
			self.till.acting_user("manager@example.com", "Shop 1")

	def test_a_till_cannot_act_for_a_cashier_of_another_pos_profile(self):
		self.signed_in_with("token key:secret")
		with self.assertRaises(Refused):
			self.till.acting_user("cashier@example.com", "Shop 2")

	def test_a_till_that_names_no_one_acts_as_itself(self):
		self.signed_in_with("token key:secret")
		self.assertEqual(self.till.acting_user(None, "Shop 1"), "till@example.com")


class TestTillCashier(TillCase):
	"""K27: checks that ask who is doing something see the till's cashier, not its API user."""

	def setUp(self):
		super().setUp()
		self.frappe.flags = {}
		self.headers = {}
		self.frappe.get_request_header.side_effect = lambda key, default=None: self.headers.get(key, default)

	def till_sends(self, **headers):
		self.headers = {"Authorization": "token key:secret", **headers}

	def test_a_person_signed_in_has_no_till_cashier(self):
		self.headers = {self.till.CASHIER_HEADER: "cashier@example.com", self.till.PROFILE_HEADER: "Shop 1"}
		self.assertIsNone(self.till.till_cashier())

	def test_a_till_names_its_cashier_and_pos_profile(self):
		self.till_sends(
			**{self.till.CASHIER_HEADER: "cashier@example.com", self.till.PROFILE_HEADER: "Shop 1"}
		)
		self.assertEqual(self.till.till_cashier(), "cashier@example.com")

	def test_the_names_are_percent_decoded(self):
		self.on_profile.add(("Café Floor", "cashier@example.com"))
		self.till_sends(
			**{
				self.till.CASHIER_HEADER: "cashier%40example.com",
				self.till.PROFILE_HEADER: "Caf%C3%A9%20Floor",
			}
		)
		self.assertEqual(self.till.till_cashier(), "cashier@example.com")

	def test_a_till_cannot_name_someone_off_its_pos_profile(self):
		self.till_sends(
			**{self.till.CASHIER_HEADER: "manager@example.com", self.till.PROFILE_HEADER: "Shop 1"}
		)
		with self.assertRaises(Refused):
			self.till.till_cashier()

	def test_a_till_that_has_not_said_which_pos_profile_acts_as_itself(self):
		self.till_sends(**{self.till.CASHIER_HEADER: "cashier@example.com"})
		self.assertIsNone(self.till.till_cashier())

	def test_outside_a_request_there_is_no_till(self):
		self.frappe.local.request = None
		self.assertIsNone(self.till.till_cashier())


class TestSyncCashMovement(unittest.TestCase):
	"""Expenses and bank drops taken on a till reach ERPNext once, for the cashier."""

	def setUp(self):
		from xpos.api import cash_movements

		self.cm = cash_movements
		self.frappe = patch.object(cash_movements, "frappe").start()
		self.addCleanup(patch.stopall)
		self.frappe.throw.side_effect = _throw
		self.sent_by_till = patch.object(cash_movements, "sent_by_till", return_value=True).start()
		self.acting_user = patch.object(
			cash_movements, "acting_user", side_effect=lambda cashier, profile: cashier
		).start()
		self.is_manager = patch.object(cash_movements, "is_pos_manager", return_value=False).start()
		self.post = patch.object(cash_movements, "_post_cash_movement", return_value={"name": "CM-1"}).start()
		self.frappe.db.get_value.return_value = None
		shift = MagicMock(user="cashier@example.com", pos_profile="Shop 1")
		shift.name = "SHIFT-1"
		self.frappe.get_doc.return_value = shift

	def sync(self, local_id="0b6e-uuid", **data):
		record = {
			"movement_type": "Expense",
			"pos_opening_shift": "SHIFT-1",
			"account": "Travel - S",
			"amount": 25,
			"cashier": "cashier@example.com",
			"posting_date": "2026-09-19",
			**data,
		}
		return self.cm.sync_cash_movement(record, local_id)

	def test_an_expense_is_posted_for_the_cashier_on_the_tills_date(self):
		self.assertEqual(self.sync(), {"name": "CM-1"})
		kwargs = self.post.call_args.kwargs
		self.assertEqual(kwargs["user"], "cashier@example.com")
		self.assertEqual(kwargs["movement_type"], "Expense")
		self.assertEqual(kwargs["posting_date"], "2026-09-19")
		self.assertEqual(kwargs["client_request_id"], "till:0b6e-uuid")

	def test_a_retry_returns_the_record_already_posted(self):
		self.frappe.db.get_value.return_value = "CM-1"
		self.assertEqual(self.sync(), {"name": "CM-1", "duplicate": True})
		self.post.assert_not_called()

	def test_only_a_till_may_sync(self):
		self.sent_by_till.return_value = False
		with self.assertRaises(Refused):
			self.sync()
		self.post.assert_not_called()

	def test_a_record_without_a_local_id_is_refused(self):
		with self.assertRaises(Refused):
			self.sync(local_id=None)

	def test_an_unknown_movement_type_is_refused(self):
		with self.assertRaises(Refused):
			self.sync(movement_type="Withdrawal")

	def test_a_cashier_cannot_record_on_someone_elses_shift(self):
		with self.assertRaises(Refused):
			self.sync(cashier="other@example.com")
		self.post.assert_not_called()

	def test_a_manager_may_record_on_a_cashiers_shift(self):
		self.is_manager.return_value = True
		self.sync(cashier="manager@example.com")
		self.assertEqual(self.post.call_args.kwargs["user"], "manager@example.com")

	def test_without_a_cashier_it_is_the_shifts_cashier(self):
		self.sync(cashier=None)
		self.assertEqual(self.post.call_args.kwargs["user"], "cashier@example.com")
