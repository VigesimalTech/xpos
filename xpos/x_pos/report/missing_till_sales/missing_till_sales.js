// Copyright (c) 2026, Ali Raza and contributors
// For license information, please see license.txt

frappe.query_reports["Missing Till Sales"] = {
	filters: [
		{
			fieldname: "till_user",
			label: __("Till User"),
			fieldtype: "Link",
			options: "User",
		},
		{
			fieldname: "from_date",
			label: __("Gaps Found Since"),
			fieldtype: "Date",
		},
	],
};
