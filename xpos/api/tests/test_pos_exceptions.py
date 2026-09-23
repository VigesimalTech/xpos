import unittest
from datetime import date, datetime

from xpos.x_pos.report.pos_exceptions.pos_exceptions import build_rows, get_summary

SHOP = "Shop 1"
ANN = "ann@example.com"
BEN = "ben@example.com"
MON = date(2026, 9, 21)
TUE = date(2026, 9, 22)


def sale(user=ANN, day=MON, total=100.0, discount=0.0, flags="", is_return=0):
	return {
		"posting_date": day,
		"pos_profile": SHOP,
		"cashier": user,
		"is_return": is_return,
		"base_grand_total": total,
		"discount": discount,
		"xpos_policy_flags": flags,
	}


def event(kind, user=ANN, day=MON, amount=0.0, pin_user=None):
	return {
		"event_type": kind,
		"event_time": datetime(day.year, day.month, day.day, 10, 15),
		"pos_profile": SHOP,
		"cashier": user,
		"pin_user": pin_user,
		"amount": amount,
	}


def rows(invoices=(), events=(), closings=(), **kw):
	return build_rows(list(invoices), list(events), list(closings), **kw)


class TestPosExceptions(unittest.TestCase):
	"""K21: what each cashier did outside a plain sale, by shop and day."""

	def test_sales_returns_discounts_and_policy_are_counted_per_cashier_and_day(self):
		(ann,) = rows(
			[
				sale(total=100, discount=10),
				sale(total=50, flags="Price below the price list"),
				sale(total=-20, is_return=1),
			]
		)
		self.assertEqual((ann["period"], ann["pos_profile"], ann["cashier"]), (MON, SHOP, ANN))
		self.assertEqual((ann["sales"], ann["sales_value"]), (2, 150))
		self.assertEqual((ann["returns"], ann["returns_value"]), (1, 20))
		self.assertEqual(ann["discounts_value"], 10)
		self.assertEqual(ann["outside_policy"], 1)

	def test_what_was_taken_out_before_payment_is_summed_and_set_against_sales(self):
		(ann,) = rows(
			[sale(total=200)],
			[
				event("Line Removed", amount=10),
				event("Quantity Lowered", amount=5),
				event("Sale Cleared", amount=30),
				event("Held Order Discarded", amount=5),
			],
		)
		self.assertEqual((ann["lines_removed"], ann["lines_removed_value"]), (1, 10))
		self.assertEqual((ann["qty_lowered"], ann["qty_lowered_value"]), (1, 5))
		self.assertEqual(ann["taken_out_value"], 50)
		self.assertEqual(ann["taken_out_pct"], 25)

	def test_a_wrong_pin_counts_against_whose_pin_was_tried(self):
		result = rows(events=[event("PIN Failed", user=ANN, pin_user=BEN)])
		self.assertEqual([(r["cashier"], r["wrong_pins"]) for r in result], [(BEN, 1)])

	def test_reprints_and_approvals_are_counted(self):
		(ann,) = rows(events=[event("Reprint"), event("Reprint"), event("Approval")])
		self.assertEqual((ann["reprints"], ann["approvals"]), (2, 1))

	def test_a_closing_shifts_count_difference_goes_to_its_cashier(self):
		(ann,) = rows(closings=[{"posting_date": MON, "pos_profile": SHOP, "user": ANN, "difference": -12.5}])
		self.assertEqual(ann["count_difference"], -12.5)

	def test_each_cashier_and_day_is_a_row_of_its_own(self):
		result = rows([sale(ANN, MON), sale(BEN, MON), sale(ANN, TUE)])
		self.assertEqual([(r["period"], r["cashier"]) for r in result], [(MON, ANN), (MON, BEN), (TUE, ANN)])

	def test_by_week_the_days_of_a_week_are_one_row_from_its_monday(self):
		(ann,) = rows([sale(day=MON), sale(day=TUE)], group_by="Week")
		self.assertEqual((ann["period"], ann["sales"]), (MON, 2))

	def test_within_a_day_the_most_taken_out_comes_first(self):
		result = rows(events=[event("Line Removed", ANN, amount=5), event("Line Removed", BEN, amount=40)])
		self.assertEqual([r["cashier"] for r in result], [BEN, ANN])

	def test_a_cashier_filter_leaves_only_that_cashier(self):
		result = rows([sale(ANN), sale(BEN)], cashier=BEN)
		self.assertEqual([r["cashier"] for r in result], [BEN])

	def test_no_sales_means_no_percentage_rather_than_a_division_by_zero(self):
		(ann,) = rows(events=[event("Line Removed", amount=10)])
		self.assertEqual(ann["taken_out_pct"], 0)

	def test_the_summary_totals_the_rows(self):
		result = rows(
			[sale(ANN, discount=3), sale(BEN, discount=2)],
			[event("Line Removed", ANN, amount=7), event("PIN Failed", ANN, pin_user=ANN)],
			[{"posting_date": MON, "pos_profile": SHOP, "user": BEN, "difference": 4}],
		)
		summary = {s["label"]: s["value"] for s in get_summary(result)}
		self.assertEqual(summary["Taken Out Before Payment"], 7)
		self.assertEqual(summary["Discounts Given"], 5)
		self.assertEqual(summary["Count Difference"], 4)
		self.assertEqual(summary["Wrong PINs"], 1)

	def test_changes_to_a_tills_settings_are_counted_against_who_made_them(self):
		(ann,) = rows(events=[event("Settings Changed"), event("Local Data Cleared")])
		self.assertEqual(ann["settings_changes"], 2)
