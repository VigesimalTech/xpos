import unittest
from unittest.mock import patch

from xpos.api.audit import EVENT_TYPES, audit_event_doc

CASHIER = "cashier@example.com"
MANAGER = "manager@example.com"
TILL = "till@example.com"


class Refused(Exception):
	pass


def _throw(message, exc=None):
	raise Refused(message)


def doc(event=None, **checks):
	checks = {
		"till_user": TILL,
		"cashier_on_profile": True,
		"pin_user_on_profile": True,
		"shift_exists": True,
		"approval_problems": [],
		**checks,
	}
	return audit_event_doc(
		{
			"local_id": "0b6e-uuid",
			"event_type": "line_removed",
			"event_time": "2026-09-21 10:15:00",
			"pos_profile": "Shop 1",
			"cashier": CASHIER,
			"pos_opening_shift": "POS-OPEN-0001",
			"item_code": "ITEM-1",
			"item_name": "Item 1",
			"qty": 2,
			"amount": 20,
			**(event or {}),
		},
		**checks,
	)


class TestAuditEventDoc(unittest.TestCase):
	"""K20: what the server keeps of an event a till logged."""

	def test_an_event_is_kept_as_the_till_logged_it(self):
		d = doc()
		self.assertEqual(d["doctype"], "POS Audit Event")
		self.assertEqual(d["event_type"], "Line Removed")
		self.assertEqual(d["event_time"], "2026-09-21 10:15:00")
		self.assertEqual(d["cashier"], CASHIER)
		self.assertEqual(d["pos_opening_shift"], "POS-OPEN-0001")
		self.assertEqual((d["item_code"], d["qty"], d["amount"]), ("ITEM-1", 2, 20))
		self.assertEqual(d["till_user"], TILL)
		self.assertEqual(d["client_request_id"], "till:0b6e-uuid")
		self.assertEqual(d["checks"], "")

	def test_every_till_event_type_has_a_name(self):
		for key in (
			"line_removed",
			"qty_lowered",
			"sale_cleared",
			"held_order_discarded",
			"reprint",
			"approval",
			"pin_failed",
		):
			self.assertIn(key, EVENT_TYPES)

	def test_an_event_type_this_server_does_not_know_is_kept_not_lost(self):
		# A newer till may log what an older server has no name for yet.
		d = doc({"event_type": "drawer_opened_no_sale_v2"})
		self.assertEqual(d["event_type"], "Other")
		self.assertIn("drawer_opened_no_sale_v2", d["checks"])

	def test_a_cashier_not_on_the_pos_profile_is_kept_and_noted(self):
		d = doc(cashier_on_profile=False)
		self.assertEqual(d["cashier"], CASHIER)
		self.assertIn(CASHIER, d["checks"])

	def test_a_failed_pin_names_whose_pin_it_was(self):
		d = doc({"event_type": "pin_failed", "cashier": None, "pin_user": MANAGER})
		self.assertEqual(d["event_type"], "PIN Failed")
		self.assertEqual(d["pin_user"], MANAGER)
		self.assertEqual(d["checks"], "")

	def test_a_pin_user_not_on_the_pos_profile_is_noted(self):
		d = doc({"event_type": "pin_failed", "pin_user": "stranger@example.com"}, pin_user_on_profile=False)
		self.assertIn("stranger@example.com", d["checks"])

	def test_an_approval_that_does_not_stand_is_kept_with_why(self):
		d = doc(
			{"event_type": "approval", "approved_by": MANAGER},
			approval_problems=["Approver does not have the Approve Exceptions permission."],
		)
		self.assertEqual(d["approved_by"], MANAGER)
		self.assertIn("Approve Exceptions", d["checks"])

	def test_a_shift_the_server_does_not_have_is_left_out_and_noted(self):
		d = doc(shift_exists=False)
		self.assertIsNone(d["pos_opening_shift"])
		self.assertIn("POS-OPEN-0001", d["checks"])

	def test_details_are_kept_as_json(self):
		d = doc({"details": {"lines": [{"item_code": "A", "qty": 1}]}})
		self.assertIn('"item_code": "A"', d["details"])

	def test_long_text_from_a_till_is_cut_to_fit(self):
		d = doc({"description": "x" * 5000, "reference": "r" * 500})
		self.assertLessEqual(len(d["description"]), 1000)
		self.assertLessEqual(len(d["reference"]), 140)


class SyncCase(unittest.TestCase):
	def setUp(self):
		from xpos.api import audit

		self.audit = audit
		self.frappe = patch.object(audit, "frappe").start()
		self.sent_by_till = patch.object(audit, "sent_by_till", return_value=True).start()
		self.check_approver = patch.object(audit, "check_approver", return_value=[]).start()
		self.addCleanup(patch.stopall)
		self.frappe.session.user = TILL
		self.frappe.throw.side_effect = _throw
		self.frappe.PermissionError = Refused
		self.stored = {}
		self.on_profile = {("Shop 1", CASHIER), ("Shop 1", MANAGER)}

		def exists(doctype, filters=None):
			if doctype == "POS Audit Event":
				return filters["client_request_id"] in self.stored
			if doctype == "POS Profile User":
				return (filters["parent"], filters["user"]) in self.on_profile
			if doctype == "POS Opening Shift":
				return filters == "POS-OPEN-0001"
			if doctype == "POS Profile":
				return filters == "Shop 1"
			return False

		self.frappe.db.exists.side_effect = exists
		self.frappe.get_cached_doc.return_value = {"name": "Shop 1"}

		def get_doc(d):
			class Doc(dict):
				flags = type("F", (), {})()

				def insert(inner, ignore_permissions=False):
					self.stored[inner["client_request_id"]] = dict(inner)
					return inner

			return Doc(d)

		self.frappe.get_doc.side_effect = get_doc

	def event(self, local_id="e1", **data):
		return {
			"local_id": local_id,
			"event_type": "reprint",
			"event_time": "2026-09-21 10:15:00",
			"pos_profile": "Shop 1",
			"cashier": CASHIER,
			"reference": "ACC-SINV-0001",
			**data,
		}


class TestSyncAuditEvents(SyncCase):
	"""K20: a till's audit log reaches ERPNext, each event once."""

	def test_events_are_stored_and_their_ids_returned(self):
		result = self.audit.sync_audit_events([self.event("e1"), self.event("e2")])
		self.assertEqual(result, {"accepted": ["e1", "e2"]})
		self.assertEqual(set(self.stored), {"till:e1", "till:e2"})

	def test_the_events_may_arrive_as_json(self):
		import json

		self.assertEqual(self.audit.sync_audit_events(json.dumps([self.event()])), {"accepted": ["e1"]})

	def test_a_resend_after_a_lost_reply_is_accepted_but_not_stored_twice(self):
		self.audit.sync_audit_events([self.event()])
		self.frappe.get_doc.reset_mock()
		self.assertEqual(self.audit.sync_audit_events([self.event()]), {"accepted": ["e1"]})
		self.frappe.get_doc.assert_not_called()

	def test_only_a_till_may_send_them(self):
		self.sent_by_till.return_value = False
		with self.assertRaises(Refused):
			self.audit.sync_audit_events([self.event()])
		self.assertEqual(self.stored, {})

	def test_an_event_without_an_id_is_skipped(self):
		result = self.audit.sync_audit_events([self.event(local_id=None), self.event("e2")])
		self.assertEqual(result, {"accepted": ["e2"]})

	def test_a_cashier_of_another_shop_is_stored_and_noted(self):
		self.audit.sync_audit_events([self.event(cashier="other@example.com")])
		self.assertIn("other@example.com", self.stored["till:e1"]["checks"])

	def test_an_approval_is_checked_against_erpnext(self):
		self.check_approver.return_value = ["not on the profile"]
		self.audit.sync_audit_events([self.event(event_type="approval", approved_by=MANAGER)])
		self.check_approver.assert_called_once()
		self.assertEqual(self.check_approver.call_args.args[:2], (MANAGER, CASHIER))
		self.assertIn("not on the profile", self.stored["till:e1"]["checks"])

	def test_an_approval_on_a_pos_profile_the_server_no_longer_has_is_stored_and_noted(self):
		self.frappe.get_cached_doc.side_effect = LookupError("POS Profile Gone not found")
		result = self.audit.sync_audit_events(
			[self.event(event_type="approval", approved_by=MANAGER, pos_profile="Gone")]
		)
		self.assertEqual(result, {"accepted": ["e1"]})
		self.check_approver.assert_not_called()
		self.assertIn("POS Profile Gone is not on this server", self.stored["till:e1"]["checks"])

	def test_one_event_that_cannot_be_stored_does_not_hold_back_the_rest(self):
		original = self.frappe.get_doc.side_effect

		def get_doc(d):
			if d["client_request_id"] == "till:bad":
				raise ValueError("broken")
			return original(d)

		self.frappe.get_doc.side_effect = get_doc
		result = self.audit.sync_audit_events([self.event("bad"), self.event("e2")])
		self.assertEqual(result, {"accepted": ["e2"]})

	def test_a_batch_is_capped(self):
		events = [self.event(f"e{i}") for i in range(self.audit.MAX_BATCH + 5)]
		self.assertEqual(len(self.audit.sync_audit_events(events)["accepted"]), self.audit.MAX_BATCH)
