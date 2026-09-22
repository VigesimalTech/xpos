/**
 * What a user may do on one POS Profile. A user on two profiles may be a cashier on one and
 * a supervisor on the other, but the till keeps one row per user, and ERPNext fills it
 * from the first of their profiles by name: on the other profile's shift they had that
 * profile's role, discount limit and PIN, not their own (bug hunt, 22 Sep 2026).
 *
 * ERPNext now also sends `profile_access` (xpos.api.auth.profile_access_by_user): per
 * profile, the role, discount limit, PIN and permission flags. Where there is an entry for
 * the profile asked for, it replaces the row's; otherwise the row stands as it was.
 */
type Row = Record<string, unknown>;

export function profileAccessOf(row: Row | null | undefined): Record<string, Row> {
	const raw = row?.profile_access;
	if (!raw) return {};
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, Row>)
			: {};
	} catch {
		return {};
	}
}

/** The user's row as it stands on `profile`: its entry laid over the row, where there is one. */
export function onProfile<T extends Row>(row: T, profile: string | null | undefined): T {
	const entry = profile ? profileAccessOf(row)[profile] : undefined;
	if (!entry) return row;
	return { ...row, ...entry, pos_profile: profile };
}

/**
 * Every PIN the user has on this till, each as a hash and its salt: the row's own and those
 * of each profile, once each. A user who set a PIN on one profile signs in with it on any.
 */
export function pinsOf(row: Row): { hash: string; salt: string }[] {
	const pins: { hash: string; salt: string }[] = [];
	const add = (hash: unknown, salt: unknown) => {
		if (!hash || !salt) return;
		if (pins.some((p) => p.hash === hash && p.salt === salt)) return;
		pins.push({ hash: String(hash), salt: String(salt) });
	};
	add(row.pin_hash, row.pin_salt);
	for (const entry of Object.values(profileAccessOf(row))) add(entry.pin_hash, entry.pin_salt);
	return pins;
}
