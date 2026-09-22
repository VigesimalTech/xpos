/**
 * The POS Profiles a user may open a shift on at this till: only those they are on in
 * ERPNext. ERPNext refuses a shift on any other, and every sale made in it would never
 * sync (found by the bug hunt: a manager on one profile could open a shift on another).
 */
export interface PosUserProfiles {
	pos_profile?: string | null;
	/** JSON list of every profile the user is on, from ERPNext. */
	pos_profiles?: string | null;
}

export function allowedProfiles(user: PosUserProfiles | null | undefined): Set<string> {
	if (!user) return new Set();
	try {
		const list = JSON.parse(user.pos_profiles || "null");
		if (Array.isArray(list) && list.length) return new Set(list.map(String));
	} catch {
		// A till that has not pulled the list yet: fall back to the user's first profile.
	}
	return new Set(user.pos_profile ? [user.pos_profile] : []);
}

export function profilesForUser<T extends { name?: unknown }>(
	profiles: T[],
	user: PosUserProfiles | null | undefined,
): T[] {
	const allowed = allowedProfiles(user);
	return profiles.filter((p) => allowed.has(String(p.name)));
}
