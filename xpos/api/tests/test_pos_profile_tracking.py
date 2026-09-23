import json
import unittest
from pathlib import Path

CUSTOM = Path(__file__).resolve().parents[2] / "x_pos" / "custom" / "pos_profile.json"
POS_ROLE = Path(__file__).resolve().parents[2] / "x_pos" / "doctype" / "pos_role" / "pos_role.json"


class TestControlsAreTracked(unittest.TestCase):
	"""K48: every change to where the controls live is recorded, with who, when and the old value.

	The POS Profile holds the rules (limits, rate and discount switches, Sale Outside Policy,
	self-approval, the users' discount limits and PINs); the POS Role holds the permissions.
	Child rows (the users, the permissions) are tracked through their parent.
	"""

	def test_pos_profile_changes_are_tracked(self):
		setters = json.loads(CUSTOM.read_text())["property_setters"]
		tracking = [s for s in setters if s["doc_type"] == "POS Profile" and s["property"] == "track_changes"]
		self.assertEqual([s["value"] for s in tracking], ["1"])

	def test_pos_role_changes_are_tracked(self):
		self.assertEqual(json.loads(POS_ROLE.read_text()).get("track_changes"), 1)
