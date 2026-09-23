# Copyright (c) 2026, Ali Raza and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class POSTillKey(Document):
	"""The public half of a till's signing key (K43). Kept from the first signed sale the
	till sends (`xpos.api.sale_signature.check_till_signature`), never changed after.
	Deleting it lets that till register a new key: after reinstalling the till, say."""

	def validate(self):
		if not self.is_new():
			frappe.throw(
				_("A POS Till Key cannot be changed. Delete it to let the till register a new one."),
				frappe.PermissionError,
			)
