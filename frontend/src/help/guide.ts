/**
 * The user guide: the pages of `docs/features/` (and the desktop install guide), built
 * into the app so they open offline and always match the installed version.
 *
 * This module is only imported by the Help screen, which is loaded when opened, so the
 * pages never weigh on the POS itself.
 *
 * Translations live beside the English, in `docs/features/translations/<lang>/`, under the
 * same file names. A translation keeps the English page's headings in the same order and
 * at the same levels; each heading then takes its English anchor, so a link into a section
 * works in every language. A page with no translation, or one whose headings no longer
 * match, is shown in English.
 */

import { slugifyAll } from "./slug";

const english = import.meta.glob("../../../docs/features/*.md", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

const installGuide = import.meta.glob("../../../docs/desktop-install.md", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

const translated = import.meta.glob("../../../docs/features/translations/*/*.md", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

export type Audience = "cashier" | "supervisor" | "administrator";

export const AUDIENCE_RANK: Record<Audience, number> = { cashier: 0, supervisor: 1, administrator: 2 };

export interface Section {
	id: string;
	title: string;
	level: number;
	/** Who the section is for, after inheritance from the sections above it. */
	audience: Audience;
}

export interface Page {
	id: string;
	title: string;
	markdown: string;
	sections: Section[];
	/** The language shown: the one asked for, or "en" when the page has no translation. */
	lang: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const MARKER = /^<!--\s*audience:\s*(cashier|supervisor|administrator)\s*-->\s*$/;

interface Heading {
	level: number;
	title: string;
	/** The section's own marker, if it has one. */
	marker?: Audience;
}

/** The page's headings with their audience markers, skipping fenced code blocks. */
export function headingsOf(markdown: string): Heading[] {
	const out: Heading[] = [];
	let inCode = false;
	let awaitingMarker = false;
	for (const line of markdown.split("\n")) {
		if (line.startsWith("```")) inCode = !inCode;
		const match = !inCode && HEADING.exec(line);
		if (match) {
			out.push({ level: match[1].length, title: match[2] });
			awaitingMarker = true;
			continue;
		}
		if (!awaitingMarker || !line.trim()) continue;
		const marker = MARKER.exec(line.trim());
		if (marker) out[out.length - 1].marker = marker[1] as Audience;
		awaitingMarker = false;
	}
	return out;
}

/** Each heading's audience: its own marker, else the nearest one above it at a higher level. */
function audiences(headings: Heading[]): Audience[] {
	const stack: { level: number; audience: Audience }[] = [];
	return headings.map((h) => {
		while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
		const audience = h.marker ?? stack[stack.length - 1]?.audience ?? "cashier";
		stack.push({ level: h.level, audience });
		return audience;
	});
}

function pageId(path: string): string {
	return path.split("/").pop()!.replace(/\.md$/, "");
}

const englishPages: Record<string, string> = {};
for (const [path, markdown] of Object.entries(english)) englishPages[pageId(path)] = markdown;
for (const [path, markdown] of Object.entries(installGuide)) englishPages[pageId(path)] = markdown;

const translations: Record<string, Record<string, string>> = {};
for (const [path, markdown] of Object.entries(translated)) {
	const lang = path.split("/").slice(-2)[0];
	(translations[lang] ??= {})[pageId(path)] = markdown;
}

/** Page ids in reading order: the numbered feature pages, then the install guide. */
export const pageIds: string[] = Object.keys(englishPages).sort((a, b) => {
	const na = /^\d+/.test(a);
	const nb = /^\d+/.test(b);
	if (na !== nb) return na ? -1 : 1;
	return a.localeCompare(b);
});

export function hasPage(id: string): boolean {
	return id in englishPages;
}

/** Whether a translation's headings match the English page's, level for level. */
function sameStructure(a: string, b: string): boolean {
	const ha = headingsOf(a);
	const hb = headingsOf(b);
	return ha.length === hb.length && ha.every((h, i) => h.level === hb[i].level);
}

export function getPage(id: string, lang = "en"): Page | null {
	const source = englishPages[id];
	if (source === undefined) return null;

	const englishHeadings = headingsOf(source);
	const ids = slugifyAll(englishHeadings.map((h) => h.title));
	// Who a section is for is decided on the English page, so a translation cannot widen it.
	const forWhom = audiences(englishHeadings);

	const candidate = lang && lang !== "en" ? translations[lang]?.[id] : undefined;
	const useTranslation = candidate !== undefined && sameStructure(source, candidate);
	if (candidate !== undefined && !useTranslation) {
		console.warn(`[help] ${lang}/${id}.md does not match the English headings; showing English`);
	}
	const markdown = useTranslation ? candidate : source;
	const shown = headingsOf(markdown);

	return {
		id,
		title: shown[0]?.title ?? id,
		markdown,
		sections: shown.map((h, i) => ({ id: ids[i], title: h.title, level: h.level, audience: forWhom[i] })),
		lang: useTranslation ? lang : "en",
	};
}

/**
 * The markdown of one section: its heading and everything up to the next heading of the
 * same or a higher level. Used before sign-in, where only the sign-in sections are shown.
 */
export function sectionMarkdown(page: Page, sectionId: string): string | null {
	const index = page.sections.findIndex((s) => s.id === sectionId);
	if (index < 0) return null;
	const { level } = page.sections[index];

	const lines = page.markdown.split("\n");
	let seen = -1;
	let start = -1;
	let end = lines.length;
	let inCode = false;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith("```")) inCode = !inCode;
		const match = !inCode && HEADING.exec(lines[i]);
		if (!match) continue;
		seen++;
		if (seen === index) start = i;
		else if (start >= 0 && match[1].length <= level) {
			end = i;
			break;
		}
	}
	return start < 0 ? null : lines.slice(start, end).join("\n").trim();
}

/** One section as a page of its own: its markdown and the anchors of the headings in it. */
export function sectionAsPage(
	page: Page,
	sectionId: string,
): { markdown: string; sections: Section[] } | null {
	const markdown = sectionMarkdown(page, sectionId);
	if (markdown === null) return null;
	const start = page.sections.findIndex((s) => s.id === sectionId);
	const count = headingsOf(markdown).length;
	return { markdown, sections: page.sections.slice(start, start + count) };
}

/** Whether someone at `audience` may read a section of this audience. */
export function reaches(audience: Audience, section: Audience): boolean {
	return AUDIENCE_RANK[section] <= AUDIENCE_RANK[audience];
}

/**
 * The page as someone at `audience` sees it: the sections their role reaches, with the
 * audience markers taken out. The title stays while anything on the page is shown. Null
 * when nothing on the page is for them.
 */
export function pageFor(page: Page, audience: Audience): Page | null {
	const shown = page.sections.map((s) => reaches(audience, s.audience));
	if (!shown.some(Boolean)) return null;
	const keep = (i: number) => shown[i] || (i === 0 && page.sections[0].level === 1);

	const out: string[] = [];
	let index = -1;
	let inCode = false;
	for (const line of page.markdown.split("\n")) {
		if (line.startsWith("```")) inCode = !inCode;
		const isHeading = !inCode && HEADING.test(line);
		if (isHeading) index++;
		if (!inCode && MARKER.test(line.trim())) continue;
		// A title kept only for the sections under it keeps its heading, not its intro.
		if (index < 0 || shown[index] || (isHeading && keep(index))) out.push(line);
	}
	return {
		...page,
		markdown: out.join("\n").replace(/\n{3,}/g, "\n\n"),
		sections: page.sections.filter((_, i) => keep(i)),
	};
}

/** Whether a link to this page (and section) leads somewhere someone at `audience` can read. */
export function isVisible(id: string, section: string | undefined, audience: Audience, lang = "en"): boolean {
	const page = getPage(id, lang);
	const view = page && pageFor(page, audience);
	if (!view) return false;
	return !section || view.sections.some((s) => s.id === section);
}
