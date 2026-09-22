import unittest

from xpos.api.sale_policy import effective_discount_limit, policy_exceptions

NO_RIGHTS = {
	"allow_change_price": False,
	"show_edit_discount_field": False,
	"apply_additional_discount": False,
	"sale_return": False,
}
ALL_RIGHTS = {key: True for key in NO_RIGHTS}
PRICES = {("ITEM-A", "Nos"): 100.0, ("ITEM-B", "Nos"): 50.0}


def sale(items, **extra):
	return {"items": items, **extra}


def line(item_code="ITEM-A", qty=1, rate=100.0, **extra):
	return {"item_code": item_code, "uom": "Nos", "qty": qty, "rate": rate, **extra}


def check(data, rights=NO_RIGHTS, limit=0, profile_max=100, on_profile=True):
	return policy_exceptions(
		data,
		cashier="cashier@example.com",
		pos_profile="Shop 1",
		on_profile=on_profile,
		rights=rights,
		discount_limit=effective_discount_limit(limit, profile_max),
		list_prices=PRICES,
	)


class TestDiscountLimit(unittest.TestCase):
	"""The discount rule: 0 means none, 100 means no cap, the lower of the two wins."""

	def test_zero_means_no_discount(self):
		self.assertEqual(effective_discount_limit(0, 100), 0)
		self.assertEqual(effective_discount_limit(20, 0), 0)

	def test_the_lower_limit_wins(self):
		self.assertEqual(effective_discount_limit(20, 15), 15)
		self.assertEqual(effective_discount_limit(10, 50), 10)

	def test_limits_stay_between_0_and_100(self):
		self.assertEqual(effective_discount_limit(150, 100), 100)
		self.assertEqual(effective_discount_limit(-5, 100), 0)
		self.assertEqual(effective_discount_limit(None, None), 0)


class TestSalePolicy(unittest.TestCase):
	"""K18: every synced sale is checked against the cashier's rights in ERPNext."""

	def test_a_plain_sale_at_list_price_is_in_policy(self):
		self.assertEqual(check(sale([line(), line("ITEM-B", rate=50.0)])), [])

	def test_a_cashier_not_on_the_pos_profile_is_an_exception(self):
		flags = check(sale([line()]), on_profile=False)
		self.assertEqual(len(flags), 1)
		self.assertIn("not on POS Profile Shop 1", flags[0])

	def test_changing_a_price_without_the_right_is_an_exception(self):
		flags = check(sale([line(rate=80.0)]), limit=100)
		self.assertTrue(any("price" in f and "ITEM-A" in f for f in flags), flags)

	def test_a_price_cut_counts_against_the_discount_limit(self):
		rights = {**NO_RIGHTS, "allow_change_price": True}
		self.assertEqual(check(sale([line(rate=95.0)]), rights=rights, limit=10), [])
		flags = check(sale([line(rate=80.0)]), rights=rights, limit=10)
		self.assertTrue(any("20%" in f and "10%" in f for f in flags), flags)

	def test_a_line_discount_without_the_right_is_an_exception(self):
		flags = check(sale([line(discount_percentage=5)]), limit=100)
		self.assertTrue(any("discount" in f and "permission" in f for f in flags), flags)

	def test_a_line_discount_over_the_limit_is_an_exception(self):
		rights = {**NO_RIGHTS, "show_edit_discount_field": True}
		self.assertEqual(check(sale([line(discount_percentage=10)]), rights=rights, limit=10), [])
		flags = check(sale([line(discount_percentage=15)]), rights=rights, limit=10)
		self.assertTrue(any("15%" in f and "10%" in f for f in flags), flags)

	def test_a_discount_amount_is_measured_as_a_percentage(self):
		rights = {**NO_RIGHTS, "show_edit_discount_field": True}
		flags = check(sale([line(discount_amount=30)]), rights=rights, limit=10)
		self.assertTrue(any("30%" in f for f in flags), flags)

	def test_with_a_zero_limit_any_discount_is_an_exception(self):
		flags = check(sale([line(discount_percentage=1)]), rights=ALL_RIGHTS, limit=0)
		self.assertTrue(any("1%" in f and "0%" in f for f in flags), flags)

	def test_a_cart_discount_without_the_right_is_an_exception(self):
		flags = check(sale([line()], additional_discount_percentage=5), limit=100)
		self.assertTrue(any("cart discount" in f and "permission" in f for f in flags), flags)

	def test_a_cart_discount_over_the_limit_is_an_exception(self):
		rights = {**NO_RIGHTS, "apply_additional_discount": True}
		self.assertEqual(
			check(sale([line()], additional_discount_percentage=10), rights=rights, limit=10), []
		)
		flags = check(sale([line(), line()], discount_amount=50), rights=rights, limit=10)
		self.assertTrue(any("cart discount" in f and "25%" in f for f in flags), flags)

	def test_a_return_without_the_right_is_an_exception(self):
		flags = check(sale([line(qty=-1)], is_return=1), limit=100)
		self.assertTrue(any("return" in f.lower() for f in flags), flags)
		self.assertEqual(check(sale([line(qty=-1)], is_return=1), rights=ALL_RIGHTS, limit=100), [])

	def test_free_items_from_offers_are_not_discounts(self):
		self.assertEqual(check(sale([line(rate=0, is_free_item=1)])), [])

	def test_an_item_with_no_list_price_is_not_a_price_change(self):
		self.assertEqual(check(sale([line("ITEM-Z", rate=10.0)])), [])

	def test_everything_allowed_within_the_limit_is_in_policy(self):
		data = sale([line(rate=95.0)], additional_discount_percentage=5)
		self.assertEqual(check(data, rights=ALL_RIGHTS, limit=10), [])

	def test_line_and_cart_discounts_together_count_against_the_limit(self):
		# 10% off the price, then 5% off the cart: 14.5% off in total.
		data = sale([line(rate=90.0)], additional_discount_percentage=5)
		flags = check(data, rights=ALL_RIGHTS, limit=10)
		self.assertTrue(any("in total" in f and "14.5%" in f for f in flags), flags)


if __name__ == "__main__":
	unittest.main()


class TestResolveCashier(unittest.TestCase):
	"""Only a till's API key may say who the cashier was."""

	def setUp(self):
		from unittest.mock import patch

		from xpos.api import sale_policy, till

		self.sale_policy = sale_policy
		self.frappe = patch.object(sale_policy, "frappe").start()
		patch.object(till, "frappe", self.frappe).start()
		self.addCleanup(patch.stopall)
		self.frappe.session.user = "person@example.com"
		self.frappe.db.get_value.return_value = "shift-cashier@example.com"

	def signed_in_with(self, authorization):
		self.frappe.get_request_header.return_value = authorization

	def test_a_person_signed_in_is_the_cashier_whatever_the_sale_says(self):
		self.signed_in_with(None)
		cashier = self.sale_policy.resolve_cashier({"xpos_cashier": "manager@example.com"})
		self.assertEqual(cashier, "person@example.com")

	def test_a_till_names_its_cashier(self):
		self.signed_in_with("token key:secret")
		cashier = self.sale_policy.resolve_cashier({"xpos_cashier": "cashier@example.com"})
		self.assertEqual(cashier, "cashier@example.com")

	def test_a_till_that_does_not_say_falls_back_to_the_shift_cashier(self):
		self.signed_in_with("token key:secret")
		cashier = self.sale_policy.resolve_cashier({"pos_opening_shift": "SHIFT-1"})
		self.assertEqual(cashier, "shift-cashier@example.com")


class TestRejectOnlyWhatIsNotPaidYet(unittest.TestCase):
	"""Reject stops a sale being made on the web POS. A sale with a till's local id was paid
	at the till before ERPNext saw it: it is booked and flagged, not refused (21 Sep 2026)."""

	def run_policy(self, local_id):
		from unittest.mock import patch

		from xpos.api import sale_policy

		doc = {"xpos_local_id": local_id}

		class Doc(dict):
			def get(self, key, default=None):
				return dict.get(self, key, default)

			def __setattr__(self, key, value):
				self[key] = value

		invoice = Doc(doc)
		pos = {"xpos_out_of_policy_action": "Reject"}
		with (
			patch.object(sale_policy, "resolve_cashier", return_value="cashier@example.com"),
			patch.object(sale_policy, "check_sale_policy", return_value=["Discount 5% is over the limit."]),
			patch("xpos.api.approval.resolve_approver", return_value=None),
		):
			sale_policy.apply_sale_policy(invoice, {}, pos)
		return invoice

	def test_a_web_sale_being_made_is_refused(self):
		from unittest.mock import patch

		import frappe

		with patch.object(frappe, "throw", side_effect=RuntimeError("refused"), create=True):
			with self.assertRaises(RuntimeError):
				self.run_policy(None)

	def test_a_sale_paid_at_the_till_is_booked_and_flagged(self):
		invoice = self.run_policy("inv_1")
		self.assertIn("Discount 5% is over the limit.", invoice["xpos_policy_flags"])
		self.assertIn("already paid at the till", invoice["xpos_policy_flags"])


class TestTheProfileRulesPriceChanges(unittest.TestCase):
	"""The POS Profile's Allow Rate Change rules: off, a changed price is flagged whatever
	the role allows; on, the Change Price permission decides (22 Sep 2026)."""

	def flags(self, rights, allows):
		return policy_exceptions(
			sale([line(rate=80.0)]),
			cashier="cashier@example.com",
			pos_profile="Shop 1",
			on_profile=True,
			rights=rights,
			discount_limit=100,
			list_prices=PRICES,
			profile_allows_rate_change=allows,
		)

	def test_off_flags_even_with_the_permission(self):
		self.assertTrue(any("does not allow rate changes" in f for f in self.flags(ALL_RIGHTS, False)))

	def test_on_the_permission_decides(self):
		self.assertFalse(any("price changed" in f for f in self.flags(ALL_RIGHTS, True)))
		self.assertTrue(any("Change Price permission" in f for f in self.flags(NO_RIGHTS, True)))
