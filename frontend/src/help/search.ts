/**
 * Search over the guide: page titles, section titles and the text under each section.
 * Thirty-odd pages need no search library: an index of sections, built once when Help
 * opens, and a match on every word typed.
 */

import { getPage, pageFor, pageIds, sectionMarkdown, type Audience } from "./guide";
import { plainText } from "./render";

export interface SearchEntry {
	page: string;
	pageTitle: string;
	section: string;
	sectionTitle: string;
	text: string;
}

export interface SearchHit extends SearchEntry {
	snippet: string;
	score: number;
}

function ownText(markdown: string): string {
	const lines = markdown.split("\n");
	const next = lines.findIndex((line, i) => i > 0 && /^#{1,6}\s/.test(line));
	return (next < 0 ? lines : lines.slice(0, next)).join("\n");
}

export function buildIndex(lang = "en", audience: Audience = "administrator"): SearchEntry[] {
	const entries: SearchEntry[] = [];
	for (const id of pageIds) {
		const full = getPage(id, lang);
		const page = full && pageFor(full, audience);
		if (!page) continue;
		for (const section of page.sections) {
			// A section's own text, up to the next heading: a title shown only for the sections
			// under it has none, and a match is found where it is written.
			const body = ownText(sectionMarkdown(page, section.id) ?? "");
			entries.push({
				page: id,
				pageTitle: page.title,
				section: section.id,
				sectionTitle: section.title,
				text: plainText(body.split("\n").slice(1).join("\n")),
			});
		}
	}
	return entries;
}

function snippetAround(text: string, word: string): string {
	const at = text.toLowerCase().indexOf(word);
	if (at < 0) return text.slice(0, 140);
	const start = Math.max(0, at - 50);
	return (start > 0 ? "…" : "") + text.slice(start, start + 150) + (start + 150 < text.length ? "…" : "");
}

export function search(index: SearchEntry[], query: string, limit = 25): SearchHit[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];

	const hits: SearchHit[] = [];
	for (const entry of index) {
		const title = `${entry.pageTitle} ${entry.sectionTitle}`.toLowerCase();
		const text = entry.text.toLowerCase();
		if (!words.every((w) => title.includes(w) || text.includes(w))) continue;
		const score = words.reduce(
			(sum, w) =>
				sum +
				(entry.sectionTitle.toLowerCase().includes(w) ? 10 : 0) +
				(entry.pageTitle.toLowerCase().includes(w) ? 3 : 0) +
				(text.includes(w) ? 1 : 0),
			0,
		);
		hits.push({ ...entry, score, snippet: snippetAround(entry.text, words[0]) });
	}
	return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
