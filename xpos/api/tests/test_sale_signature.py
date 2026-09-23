"""K43: signed sales. A sale changed on the till after payment is flagged when it arrives."""

import base64
import json
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import load_der_private_key

from xpos.api.sale_signature import canonical_sale, check_signature, key_id_of, signature_valid
from xpos.x_pos.report.missing_till_sales.missing_till_sales import find_gaps

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "sale_signature_vectors.json").read_text())
PUBLIC_KEY = FIXTURE["public_key"]
PRIVATE_KEY = load_der_private_key(bytes.fromhex(FIXTURE["private_key_pkcs8_hex"]), password=None)


def signed(sale: dict, local_id: str, seq: int, key=PRIVATE_KEY, public_key=PUBLIC_KEY) -> dict:
	sig = key.sign(canonical_sale(sale, local_id, seq).encode("utf-8"))
	return {
		**sale,
		"xpos_signature": {
			"v": 1,
			"key_id": key_id_of(public_key),
			"seq": seq,
			"sig": base64.b64encode(sig).decode(),
			"public_key": public_key,
		},
	}


class TestWhatTheTillSigns(unittest.TestCase):
	"""The string must be the one the till builds (frontend/tests/saleSignature.spec.ts)."""

	def test_the_same_string_as_the_till(self):
		for case in FIXTURE["cases"]:
			with self.subTest(case["name"]):
				self.assertEqual(
					canonical_sale(case["sale"], case["local_id"], case["sequence"]), case["canonical"]
				)

	def test_the_tills_signatures_check_out(self):
		for case in FIXTURE["cases"]:
			with self.subTest(case["name"]):
				self.assertTrue(signature_valid(PUBLIC_KEY, case["canonical"], case["signature"]))
				self.assertFalse(signature_valid(PUBLIC_KEY, case["canonical"] + " ", case["signature"]))


class TestCheckingASale(unittest.TestCase):
	def setUp(self):
		case = FIXTURE["cases"][0]
		self.local_id = case["local_id"]
		self.sale = signed(case["sale"], self.local_id, 5)

	def test_an_untouched_sale_passes_and_records_its_number(self):
		flags, record = check_signature(self.sale, self.local_id, PUBLIC_KEY)
		self.assertEqual(flags, [])
		self.assertEqual(record, {"xpos_till_key": key_id_of(PUBLIC_KEY), "xpos_till_sequence": 5})

	def test_a_line_taken_out_after_payment_is_flagged(self):
		tampered = {**self.sale, "items": self.sale["items"][1:]}
		flags, record = check_signature(tampered, self.local_id, PUBLIC_KEY)
		self.assertEqual(len(flags), 1)
		self.assertIn("changed on the till after payment", flags[0])
		self.assertEqual(record["xpos_till_sequence"], 5)

	def test_a_signature_moved_to_another_sale_is_flagged(self):
		flags, _ = check_signature(self.sale, "inv_other", PUBLIC_KEY)
		self.assertIn("changed on the till after payment", flags[0])

	def test_a_signature_stripped_from_a_signing_till_is_flagged(self):
		unsigned = {k: v for k, v in self.sale.items() if k != "xpos_signature"}
		flags, record = check_signature(unsigned, self.local_id, PUBLIC_KEY)
		self.assertIn("without the till's signature", flags[0])
		self.assertEqual(record, {})

	def test_an_unsigned_sale_from_a_till_before_signing_is_not_flagged(self):
		unsigned = {k: v for k, v in self.sale.items() if k != "xpos_signature"}
		self.assertEqual(check_signature(unsigned, self.local_id, None), ([], {}))

	def test_a_new_key_made_at_the_pc_is_not_trusted(self):
		other = Ed25519PrivateKey.generate()
		other_public = base64.urlsafe_b64encode(other.public_key().public_bytes_raw()).decode().rstrip("=")
		resigned = signed({**self.sale, "items": []}, self.local_id, 5, key=other, public_key=other_public)
		flags, _ = check_signature(resigned, self.local_id, PUBLIC_KEY)
		self.assertIn("different key", flags[0])

	def test_a_key_id_copied_onto_another_keys_signature_fails(self):
		other = Ed25519PrivateKey.generate()
		resigned = signed({**self.sale, "items": []}, self.local_id, 5, key=other)
		flags, _ = check_signature(resigned, self.local_id, PUBLIC_KEY)
		self.assertIn("changed on the till after payment", flags[0])


class TestTillFlagsAreNeverApprovedOrRejected(unittest.TestCase):
	def test_flagged_even_where_the_profile_says_reject(self):
		from unittest.mock import patch

		from xpos.api import sale_policy

		class Doc(dict):
			def get(self, key, default=None):
				return dict.get(self, key, default)

			def __setattr__(self, key, value):
				self[key] = value

		invoice = Doc({"xpos_local_id": "inv_1"})
		with (
			patch.object(sale_policy, "resolve_cashier", return_value="cashier@example.com"),
			patch.object(sale_policy, "check_sale_policy", return_value=[]),
			patch("xpos.api.approval.resolve_approver", return_value=None),
		):
			sale_policy.apply_sale_policy(
				invoice, {}, {"xpos_out_of_policy_action": "Reject"}, ["Changed after payment."]
			)
		self.assertEqual(invoice["xpos_policy_flags"], "Changed after payment.")


class TestMissingTillSales(unittest.TestCase):
	def sale(self, seq, name=None):
		return {"xpos_till_sequence": seq, "name": name or f"SINV-{seq}", "posting_date": "2026-09-24"}

	def test_no_gap(self):
		self.assertEqual(find_gaps([self.sale(1), self.sale(2), self.sale(3)]), [])

	def test_a_run_of_missing_numbers_between_the_sales_around_it(self):
		gaps = find_gaps([self.sale(9), self.sale(3), self.sale(4)])
		self.assertEqual(len(gaps), 1)
		self.assertEqual(
			(gaps[0]["missing_from"], gaps[0]["missing_to"], gaps[0]["missing_count"]), (5, 8, 4)
		)
		self.assertEqual((gaps[0]["before_invoice"], gaps[0]["after_invoice"]), ("SINV-4", "SINV-9"))

	def test_a_number_received_twice_is_not_a_gap(self):
		self.assertEqual(find_gaps([self.sale(1), self.sale(1, "SINV-1b"), self.sale(2)]), [])

	def test_unsigned_sales_are_left_out(self):
		self.assertEqual(find_gaps([self.sale(0), self.sale(None), self.sale(1)]), [])
