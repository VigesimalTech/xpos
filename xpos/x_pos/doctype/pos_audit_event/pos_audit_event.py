# Copyright (c) 2026, Ali Raza and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class POSAuditEvent(Document):
	"""An event a till logged that leaves no sale behind (K20). Written by
	`xpos.api.audit.sync_audit_events` only, and never changed after."""

	def validate(self):
		if not self.is_new():
			frappe.throw(_("A POS Audit Event cannot be changed."), frappe.PermissionError)
