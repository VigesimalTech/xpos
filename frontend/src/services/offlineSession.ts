import type { UserSession } from "@/types/pos.types";

/**
 * The last user the server confirmed as signed in, kept so the web POS can
 * start while offline. After a reload with no connection, the check that asks
 * Frappe who is signed in cannot answer; without this the cashier lands on a
 * login page that also needs the server, and cannot sell until it is back.
 *
 * Only a confirmed session is remembered, and it is forgotten on logout or as
 * soon as the server says the session has ended. The Frappe session cookie is
 * still what authorises every request once the connection returns.
 */
const KEY = "xpos_offline_session_v1";

export function rememberSession(user: UserSession): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(user));
	} catch {
		/* storage full or blocked: offline start just won't be available */
	}
}

export function recallSession(): UserSession | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;
		const session = JSON.parse(raw) as UserSession;
		return session?.user && session.user !== "Guest" ? session : null;
	} catch {
		return null;
	}
}

export function forgetSession(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		/* nothing to forget */
	}
}
