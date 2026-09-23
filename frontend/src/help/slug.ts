/**
 * Section anchors, worked out as GitHub does, so a link written in the docs
 * (`30-cashier-rights-approval.md#manager-approval-on-the-till`) finds the same
 * section in the app. Keep in step with `.claude/skills/feature-docs/scripts/check_links.py`.
 */

export function slugify(heading: string): string {
	return heading
		.replace(/[`*_]|<[^>]+>/g, "")
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}_\- ]/gu, "")
		.replace(/ /g, "-");
}

/** Anchors for a page's headings, in order; a repeated heading gets -1, -2 as on GitHub. */
export function slugifyAll(headings: string[]): string[] {
	const seen = new Map<string, number>();
	return headings.map((heading) => {
		const base = slugify(heading);
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return n === 0 ? base : `${base}-${n}`;
	});
}
