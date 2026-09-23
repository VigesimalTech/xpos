import { describe, expect, it } from "vitest";
import {
	getPage,
	hasPage,
	headingsOf,
	isVisible,
	pageFor,
	pageIds,
	sectionAsPage,
	type Audience,
} from "@/help/guide";
import { renderPage, SECTION_PREFIX } from "@/help/render";
import { buildIndex, search } from "@/help/search";
import { HELP_TOPICS, PUBLIC_SECTIONS, splitTarget, TOPIC_AUDIENCE } from "@/help/helpLinks";
import { slugify, slugifyAll } from "@/help/slug";

const hrefFor = (page: string, section?: string) => `#/help/${page}${section ? `?section=${section}` : ""}`;

describe("the guide's pages", () => {
	it("holds every feature page in order, then the install guide", () => {
		expect(pageIds[0]).toBe("00-overview");
		expect(pageIds).toContain("29-desktop-till");
		expect(pageIds.at(-1)).toBe("desktop-install");
	});

	it("titles a page by its first heading", () => {
		expect(getPage("14-cash-movements")?.title).toBe("Cash Movements");
	});

	it("gives sections GitHub's anchors, repeats numbered", () => {
		expect(slugify("Cashier Rights & Manager Approval")).toBe("cashier-rights--manager-approval");
		expect(slugify("Profile Switches That Override the Role")).toBe(
			"profile-switches-that-override-the-role",
		);
		expect(slugifyAll(["Tips", "Tips", "Tips"])).toEqual(["tips", "tips-1", "tips-2"]);
	});

	it("does not take a heading inside a code block for a section", () => {
		expect(headingsOf("# Title\n```\n# not a heading\n```\n## Real")).toEqual([
			{ level: 1, title: "Title" },
			{ level: 2, title: "Real" },
		]);
	});

	it("cuts a section at the next heading of its own level", () => {
		const page = getPage("14-cash-movements")!;
		const part = sectionAsPage(page, "limits")!;
		expect(part.markdown.startsWith("## Limits")).toBe(true);
		expect(part.markdown).not.toContain("## Permissions and Approval");
		expect(part.sections[0].id).toBe("limits");
	});
});

describe("every link into the guide", () => {
	// Renaming a heading in docs/features must not quietly break a "?" in the app.
	it.each(Object.entries(HELP_TOPICS))("%s points to a page and section that exist", (_topic, target) => {
		const { page, section } = splitTarget(target);
		expect(hasPage(page), `page ${page}`).toBe(true);
		expect(
			getPage(page)!.sections.map((s) => s.id),
			`section ${section}`,
		).toContain(section);
	});

	it.each(PUBLIC_SECTIONS)("public section %s exists", (target) => {
		const { page, section } = splitTarget(target);
		expect(getPage(page)?.sections.map((s) => s.id)).toContain(section);
	});

	it("every link between pages in the docs finds its page and section", () => {
		const broken: string[] = [];
		for (const id of pageIds) {
			const page = getPage(id)!;
			for (const [, target, section] of page.markdown.matchAll(
				/\]\((?:\.\.\/)?([\w-]+)\.md(?:#([^)\s]+))?\)/g,
			)) {
				const to = getPage(target);
				if (!to) broken.push(`${id} → ${target}`);
				else if (section && !to.sections.some((s) => s.id === section))
					broken.push(`${id} → ${target}#${section}`);
			}
		}
		expect(broken).toEqual([]);
	});
});

describe("rendering a page", () => {
	it("anchors headings and turns links between pages into in-app links", () => {
		const page = getPage("29-desktop-till")!;
		const html = renderPage(page.markdown, { sections: page.sections, hrefFor });
		expect(html).toContain(`id="${SECTION_PREFIX}signing-in-with-a-pin"`);
		expect(html).toMatch(
			/<a href="#\/help\/30-cashier-rights-approval" data-help-page="30-cashier-rights-approval">/,
		);
		expect(html).toContain('data-help-page="desktop-install"');
	});

	it("opens web links outside the app", () => {
		const html = renderPage("See [the site](https://example.com).", { sections: [], hrefFor });
		expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
	});

	it("shows a refused link as plain text", () => {
		const html = renderPage("[Rights](30-cashier-rights-approval.md)", {
			sections: [],
			hrefFor,
			allowPage: () => false,
		});
		expect(html).not.toContain("<a");
		expect(html).toContain("Rights");
	});

	it("never lets script through", () => {
		const html = renderPage(
			'# T\n<img src=x onerror="alert(1)"><script>alert(2)</script>[x](javascript:alert(3))',
			{
				sections: [{ id: "t", title: "T", level: 1 }],
				hrefFor,
			},
		);
		expect(html).not.toMatch(/onerror|<script|javascript:/i);
	});
});

describe("searching the guide", () => {
	const index = buildIndex();

	it("finds a section by words in its text", () => {
		const hits = search(index, "wrong PINs");
		expect(hits[0]).toBeDefined();
		expect(hits.some((h) => h.page === "29-desktop-till" && h.section === "lockout")).toBe(true);
	});

	it("ranks a section whose title matches first", () => {
		expect(search(index, "audit log")[0].page).toBe("31-audit-log");
	});

	it("needs every word to match", () => {
		expect(search(index, "PIN zzzznotaword")).toEqual([]);
	});
});

describe("translations", () => {
	it("falls back to English for a language with no translation", () => {
		const page = getPage("29-desktop-till", "yo")!;
		expect(page.lang).toBe("en");
		expect(page.title).toBe("Desktop Till");
	});
});

describe("who sees what (K39)", () => {
	const view = (id: string, audience: Audience) => pageFor(getPage(id)!, audience);

	it("reads a section's audience from its marker, and inherits it below", () => {
		const rights = getPage("30-cashier-rights-approval")!;
		const of = (id: string) => rights.sections.find((s) => s.id === id)!.audience;
		expect(of("cashier-rights--manager-approval")).toBe("supervisor");
		expect(of("discount-limits")).toBe("supervisor");
		expect(of("manager-approval-on-the-till")).toBe("cashier");
		expect(of("who-may-approve")).toBe("cashier");
	});

	it("keeps a page for administrators from a cashier and a supervisor", () => {
		expect(view("24-pos-profile-config", "cashier")).toBeNull();
		expect(view("24-pos-profile-config", "supervisor")).toBeNull();
		expect(view("24-pos-profile-config", "administrator")).not.toBeNull();
	});

	it("shows a cashier only their part of a supervisor's page, under its title", () => {
		const page = view("30-cashier-rights-approval", "cashier")!;
		expect(page.markdown.startsWith("# Cashier Rights & Manager Approval")).toBe(true);
		expect(page.markdown).toContain("## Manager Approval on the Till");
		expect(page.markdown).not.toContain("## Discount Limits");
		expect(page.markdown).not.toContain("X POS decides what each cashier may do");
	});

	it("never shows the markers themselves", () => {
		for (const id of pageIds) {
			const page = view(id, "administrator");
			if (page) expect(page.markdown, id).not.toMatch(/<!--\s*audience/);
		}
	});

	it("lets every '?' open a section the people on that screen can read", () => {
		for (const [topic, target] of Object.entries(HELP_TOPICS)) {
			const { page, section } = splitTarget(target);
			const audience = TOPIC_AUDIENCE[topic as keyof typeof HELP_TOPICS];
			expect(isVisible(page, section, audience), `${topic} for ${audience}`).toBe(true);
		}
	});

	it("shows the public sign-in sections to anyone", () => {
		for (const target of PUBLIC_SECTIONS) {
			const { page, section } = splitTarget(target);
			expect(isVisible(page, section, "cashier"), target).toBe(true);
		}
	});

	it("leaves setup out of a cashier's search", () => {
		const cashier = buildIndex("en", "cashier");
		const admin = buildIndex("en", "administrator");
		expect(search(admin, "Letter Head").length).toBeGreaterThan(0);
		expect(search(cashier, "Letter Head")).toEqual([]);
		expect(search(cashier, "API key")).toEqual([]);
		expect(search(cashier, "wrong PINs").length).toBeGreaterThan(0);
	});

	it("gives each level more, never less", () => {
		const count = (a: Audience) => pageIds.filter((id) => view(id, a)).length;
		expect(count("cashier")).toBeLessThan(count("supervisor"));
		expect(count("supervisor")).toBeLessThan(count("administrator"));
		expect(count("administrator")).toBe(pageIds.length);
	});
});
