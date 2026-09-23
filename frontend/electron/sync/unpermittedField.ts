/**
 * K41: the field an error says the server does not know, if it is one the till asked for.
 * Frappe answers a query for a field its doctype lacks with HTTP 417 "Field not permitted
 * in query: <field>"; a till newer than its server meets it for every new setting.
 */
export function unpermittedField(message: string, fields: readonly string[]): string | null {
	const match = /Field not permitted in query:\s*([^\n]+)/i.exec(message || "");
	if (!match) return null;
	// Plain (xpos_x) or qualified with its table (`tabPOS Profile`.`xpos_x`): the last name.
	const field = (match[1].split(".").pop() || "").replace(/[^\w]/g, "");
	return fields.includes(field) ? field : null;
}
