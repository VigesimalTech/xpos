/**
 * Markdown to safe HTML for the Help screen.
 *
 * - Every heading gets its section's anchor as `id="help-<anchor>"` (prefixed so it can
 *   never clash with the rest of the page), in the order the page lists them.
 * - A link to another page (`14-cash-movements.md#limits`, `../desktop-install.md`) becomes
 *   an in-app link carrying data-help-page / data-help-section; the Help screen routes it.
 *   Where `allowPage` refuses a page (before sign-in), the link is shown as plain text.
 * - A web link opens outside the app (the desktop till hands it to the system browser).
 * - The result is sanitised: the pages come from this repository, but a bad edit must never
 *   become script running on a till.
 */

import { Marked, type Tokens } from "marked";
import DOMPurify from "dompurify";
import type { Section } from "./guide";

export const SECTION_PREFIX = "help-";

const PAGE_LINK = /^(?:\.\.\/|\.\/)?(?:features\/)?([\w-]+)\.md(?:#([^\s)]+))?$/;

export interface RenderOptions {
	/** The section anchors of the page being rendered, in heading order. */
	sections: Section[];
	/** The href to show for a link to another page (the router's own link). */
	hrefFor: (page: string, section?: string) => string;
	/** Whether a link to this page may be followed. Refused links render as text. */
	allowPage?: (page: string, section?: string) => boolean;
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderPage(markdown: string, options: RenderOptions): string {
	let headingIndex = 0;
	const marked = new Marked({ gfm: true });

	marked.use({
		renderer: {
			heading(
				this: { parser: { parseInline: (t: Tokens.Heading["tokens"]) => string } },
				token: Tokens.Heading,
			) {
				const section = options.sections[headingIndex++];
				const id = section ? ` id="${SECTION_PREFIX}${escapeHtml(section.id)}"` : "";
				return `<h${token.depth}${id}>${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
			},
			link(
				this: { parser: { parseInline: (t: Tokens.Link["tokens"]) => string } },
				token: Tokens.Link,
			) {
				const text = this.parser.parseInline(token.tokens);
				const page = PAGE_LINK.exec(token.href);
				if (page) {
					const [, id, section] = page;
					if (options.allowPage && !options.allowPage(id, section)) return `<span>${text}</span>`;
					const attrs = [
						`href="${escapeHtml(options.hrefFor(id, section))}"`,
						`data-help-page="${escapeHtml(id)}"`,
						section ? `data-help-section="${escapeHtml(section)}"` : "",
					];
					return `<a ${attrs.filter(Boolean).join(" ")}>${text}</a>`;
				}
				if (/^https?:\/\//i.test(token.href)) {
					return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
				}
				return `<span>${text}</span>`;
			},
		},
	});

	const html = marked.parse(markdown, { async: false }) as string;
	return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}

/** Plain text of a piece of markdown, for search. */
export function plainText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_>#|]/g, " ")
		.replace(/-{3,}/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
