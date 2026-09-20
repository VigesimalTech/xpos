/**
 * Who is signed in on the till, and its POS Profile.
 *
 * The till signs in to ERPNext as its own API user; api.ts sends these with every request
 * so ERPNext checks the cashier's rights, not the till's (xpos/api/till.py). ERPNext accepts
 * them only for a cashier of that POS Profile.
 */
let identity: { cashier?: string; posProfile?: string } = {};

export function setTillIdentity(update: { cashier?: string; posProfile?: string }): void {
	identity = { ...identity, ...update };
}

/** The headers naming them, percent-encoded: a header carries Latin-1 only, and a name may not be. */
export function tillIdentityHeaders(): Record<string, string> {
	const headers: Record<string, string> = {};
	if (identity.cashier) headers["X-XPOS-Cashier"] = encodeURIComponent(identity.cashier);
	if (identity.posProfile) headers["X-XPOS-POS-Profile"] = encodeURIComponent(identity.posProfile);
	return headers;
}
