#!/usr/bin/env python3
"""Check the settings tables in docs/features/24-pos-profile-config.md against the real fields.

Run from the repository root. Every row's first column must be a field label as ERPNext
shows it: an X POS custom field (xpos/x_pos/custom/*.json) or one of ERPNext's own POS
Profile, POS Profile User or POS Settings fields (listed below, from ERPNext v16).
A row that paraphrases a label, or names a field that no longer exists, is reported.

Also lists X POS fields on the POS Profile that no row documents, as a reminder; those do
not fail the check. Exits 1 when any row does not match.
"""

import json
import re
import sys
from pathlib import Path

PAGE = Path("docs/features/24-pos-profile-config.md")
CUSTOM = Path("xpos/x_pos/custom")

# ERPNext v16's own labels (erpnext/accounts/doctype/pos_profile*, pos_settings). Update
# when the ERPNext pin moves and a label changes.
ERPNEXT_LABELS = {
	"POS Profile": """Account for Change Amount|Action on New Invoice|Allow Partial Payment|
		Allow User to Edit Discount|Allow User to Edit Rate|Applicable for Users|Apply Discount On|
		Automatically Add Filtered Item To Cart|Campaign|Company|Company Address|Cost Center|Country|
		Currency|Customer|Customer Groups|Disable Rounded Total|Disabled|Expense Account|Hide Images|
		Hide Unavailable Items|Ignore Pricing Rule|Income Account|Item Groups|Letter Head|Medium|
		Payment Methods|Price List|Print Format|Print Heading|Print Receipt on Order Complete|Project|
		Set Grand Total to Default Payment Method|Source|Tax Category|Taxes and Charges|
		Terms and Conditions|Update Stock|Validate Stock on Save|Warehouse|Write Off Account|
		Write Off Cost Center|Write Off Limit""",
	"POS Profile User": "Default|User",
	"POS Settings": "Invoice Type Created via POS Screen|Create Ledger Entries for Change Amount|POS Additional Fields",
}
LAYOUT = {"Section Break", "Column Break", "Tab Break"}
USER_SECTION = "User Access"


def custom_labels(doctype_file: str) -> dict[str, str]:
	path = CUSTOM / doctype_file
	if not path.exists():
		return {}
	fields = json.loads(path.read_text()).get("custom_fields", [])
	return {
		f["label"].lower(): f["fieldname"]
		for f in fields
		if f.get("label") and f.get("fieldtype") not in LAYOUT and not f.get("hidden")
	}


def erpnext(doctype: str) -> set[str]:
	return {label.strip().lower() for label in ERPNEXT_LABELS[doctype].split("|") if label.strip()}


def main() -> int:
	if not PAGE.exists():
		print(f"Run from the repository root: {PAGE} not found")
		return 2
	profile = custom_labels("pos_profile.json")
	known = (
		set(profile)
		| erpnext("POS Profile")
		| set(custom_labels("pos_settings.json"))
		| erpnext("POS Settings")
	)
	user_known = set(custom_labels("pos_profile_user.json")) | erpnext("POS Profile User")

	bad, seen = [], set()
	section = ""
	for n, line in enumerate(PAGE.read_text().splitlines(), 1):
		if line.startswith("## "):
			section = line[3:].strip()
			continue
		cell = re.match(r"^\|\s*([^|]+?)\s*\|", line)
		if not cell or line.startswith("|---"):
			continue
		label = re.sub(r"[*`]", "", cell.group(1)).strip()
		if label in ("Setting", "Field", "") or set(label) <= {"-", " "}:
			continue
		seen.add(label.lower())
		allowed = user_known if section.startswith(USER_SECTION) else known
		if label.lower() not in allowed:
			bad.append(f"{PAGE.name}:{n} [{section}] '{label}' is not a field label")

	for line in bad:
		print(line)
	undocumented = sorted(label for label in profile if label not in seen)
	if undocumented:
		print(f"\nX POS POS Profile fields with no row ({len(undocumented)}), for information:")
		for label in undocumented:
			print(f"  {label} ({profile[label]})")
	print(
		f"\n{len(bad)} row(s) do not match a field label"
		if bad
		else "\nEvery settings row matches a field label"
	)
	return 1 if bad else 0


if __name__ == "__main__":
	sys.exit(main())
