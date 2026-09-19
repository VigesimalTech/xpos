import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from xpos.x_pos.api import purchase_orders

MODULE = "xpos.x_pos.api.purchase_orders"


class FakeDoc(SimpleNamespace):
	"""Answers doc.get/set/append/save/submit as Frappe documents do."""

	def get(self, key, default=None):
		return getattr(self, key, default)

	def set(self, key, value):
		setattr(self, key, value)

	def append(self, table, row):
		getattr(self, table).append(row)

	def save(self):
		self.name = self.name or "PUR-ORD-NEW"

	def submit(self):
		self.docstatus = 1


def order_payload(**extra):
	return {
		"pos_profile": "Test POS Profile",
		"supplier": "Test Supplier",
		"company": "Test Company",
		"warehouse": "Stores - TC",
		"items": [{"item_code": "ITEM-001", "qty": 2, "rate": 5}],
		**extra,
	}


class TestPurchaseOrderDedupe(unittest.TestCase):
	"""O2: a purchase order sent twice (reply lost, till retries) is created once."""

	def setUp(self):
		self.frappe = patch(f"{MODULE}.frappe").start()
		self.addCleanup(patch.stopall)
		patch(
			f"{MODULE}.resolve_pos_profile",
			return_value=MagicMock(as_dict=lambda: {"company": "Test Company"}),
		).start()
		patch(f"{MODULE}.ensure_allowed").start()
		patch(f"{MODULE}._resolve_supplier", return_value="Test Supplier").start()
		patch(f"{MODULE}._build_purchase_taxes", return_value=[]).start()
		patch(f"{MODULE}.get", return_value="Standard Buying").start()
		self.frappe.throw.side_effect = Exception
		self.frappe.get_all.return_value = []
		self.frappe.get_value.return_value = "USD"
		self.new_order = FakeDoc(name=None, items=[], taxes=[], docstatus=0)

		def get_doc(arg, *rest):
			if isinstance(arg, dict):
				return self.new_order
			return FakeDoc(default_currency="USD")

		self.frappe.get_doc.side_effect = get_doc

	def test_returns_the_existing_order_for_a_local_id_it_already_has(self):
		self.frappe.db.get_value.return_value = "PUR-ORD-0001"

		result = purchase_orders.create_purchase_order(json.dumps(order_payload()), local_id="po_123")

		self.assertEqual(result["purchase_order"], "PUR-ORD-0001")
		self.assertEqual(result["name"], "PUR-ORD-0001")
		self.assertTrue(result["duplicate"])
		self.assertIsNone(self.new_order.name, "a second order was created")

	def test_records_the_local_id_on_a_new_order(self):
		self.frappe.db.get_value.return_value = None

		result = purchase_orders.create_purchase_order(json.dumps(order_payload()), local_id="po_123")

		self.assertEqual(self.new_order.xpos_local_id, "po_123")
		self.assertEqual(result["purchase_order"], "PUR-ORD-NEW")
		# The sync engine records the server name from `name`.
		self.assertEqual(result["name"], "PUR-ORD-NEW")

	def test_takes_the_local_id_from_the_payload_too(self):
		self.frappe.db.get_value.return_value = "PUR-ORD-0001"

		result = purchase_orders.create_purchase_order(json.dumps(order_payload(local_id="po_456")))

		self.assertEqual(result["purchase_order"], "PUR-ORD-0001")
		self.frappe.db.get_value.assert_called_with(
			"Purchase Order", {"xpos_local_id": "po_456", "docstatus": ["<", 2]}, "name"
		)

	def test_an_order_without_a_local_id_is_created_as_before(self):
		result = purchase_orders.create_purchase_order(json.dumps(order_payload()))

		self.assertEqual(result["purchase_order"], "PUR-ORD-NEW")
		self.frappe.db.get_value.assert_not_called()


class TestPurchaseOrderLocalIdField(unittest.TestCase):
	"""Purchase Order carries the till's local id, like Sales Invoice does."""

	def test_custom_field_exists_and_is_not_copied(self):
		path = os.path.join(os.path.dirname(purchase_orders.__file__), "..", "custom", "purchase_order.json")
		with open(path) as f:
			custom = json.load(f)
		fields = {f["fieldname"]: f for f in custom["custom_fields"]}
		self.assertIn("xpos_local_id", fields)
		field = fields["xpos_local_id"]
		self.assertEqual(field["dt"], "Purchase Order")
		# Duplicating an order must not copy the id, or the copy would dedupe to the original.
		self.assertEqual(field["no_copy"], 1)
		self.assertEqual(custom["doctype"], "Purchase Order")
		self.assertEqual(custom["sync_on_migrate"], 1)


if __name__ == "__main__":
	unittest.main()
