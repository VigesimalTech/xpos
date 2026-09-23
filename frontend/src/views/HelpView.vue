<script setup lang="ts">
/**
 * The user guide (Help → User Guide, F1): docs/features built into the app, so it opens
 * offline and matches the installed version. The route `help-sign-in` shows only the
 * sign-in sections, before anyone has signed in.
 *
 * Sections are addressed with ?section= rather than a #fragment: the desktop till routes
 * by the URL's hash, so a fragment would be taken for a route.
 */
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, BookOpen, Search, X } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import __ from "@/lib/translate";
import { useSettingsStore } from "@/stores/settingsStore";
import { getPage, hasPage, isVisible, pageFor, pageIds, sectionAsPage } from "@/help/guide";
import { renderPage, SECTION_PREFIX } from "@/help/render";
import { buildIndex, search, type SearchEntry } from "@/help/search";
import { helpAudience, helpRoute, isPublic, PUBLIC_SECTIONS, splitTarget } from "@/help/helpLinks";
import "@/help/help-doc.css";

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();

const beforeSignIn = computed(() => route.name === "help-sign-in");
const lang = computed(() => (settingsStore.language || "en").split("-")[0]);

// K39: each person sees the sections their role reaches.
const audience = computed(() => helpAudience(!beforeSignIn.value));

const pages = computed(() =>
	pageIds
		.map((id) => {
			const full = getPage(id, lang.value);
			const view = full && pageFor(full, audience.value);
			return view ? { id, title: view.title } : null;
		})
		.filter((p): p is { id: string; title: string } => p !== null),
);

const pageId = computed(() => {
	const asked = String(route.params.page || "");
	return hasPage(asked) && pages.value.some((p) => p.id === asked) ? asked : pages.value[0]?.id;
});
const sectionId = computed(() => (route.query.section ? String(route.query.section) : ""));

const page = computed(() => {
	const full = pageId.value ? getPage(pageId.value, lang.value) : null;
	return full ? pageFor(full, audience.value) : null;
});

const canOpen = (to: string, section?: string) => isVisible(to, section, audience.value, lang.value);

function hrefFor(target: string, section?: string): string {
	return router.resolve(helpRoute(target, section)).href;
}

const html = computed(() => {
	if (beforeSignIn.value) {
		return PUBLIC_SECTIONS.map((target) => {
			const { page: id, section } = splitTarget(target);
			const full = getPage(id, lang.value);
			const p = full && pageFor(full, "cashier");
			const part = p && section ? sectionAsPage(p, section) : null;
			if (!part) return "";
			return renderPage(part.markdown, {
				sections: part.sections,
				hrefFor,
				allowPage: (to, s) => isPublic(to, s) && canOpen(to, s),
			});
		}).join("\n<hr />\n");
	}
	if (!page.value) return "";
	return renderPage(page.value.markdown, { sections: page.value.sections, hrefFor, allowPage: canOpen });
});

const outline = computed(() => (page.value?.sections ?? []).filter((s) => s.level === 2));

// Search
const query = ref("");
let index: SearchEntry[] | null = null;
const hits = computed(() => {
	if (!query.value.trim()) return [];
	index ??= buildIndex(lang.value, audience.value);
	return search(index, query.value);
});
watch([lang, audience], () => (index = null));

const content = ref<HTMLElement | null>(null);

async function scrollToSection() {
	await nextTick();
	const target = sectionId.value
		? document.getElementById(SECTION_PREFIX + sectionId.value)
		: content.value;
	if (target === content.value) {
		content.value?.scrollTo({ top: 0 });
		// Before sign-in the whole app scrolls, and keeps where the sign-in screen left it.
		document.getElementById("xpos-app")?.scrollTo({ top: 0 });
	} else target?.scrollIntoView({ block: "start" });
}
watch([pageId, sectionId, html], scrollToSection, { immediate: true });

function open(target: string, section?: string) {
	query.value = "";
	router.push(helpRoute(target, section));
}

function onContentClick(event: MouseEvent) {
	const link = (event.target as HTMLElement).closest("a[data-help-page]") as HTMLAnchorElement | null;
	if (!link) return;
	event.preventDefault();
	open(link.dataset.helpPage!, link.dataset.helpSection);
}
</script>

<template>
	<div class="flex h-full overflow-hidden bg-background">
		<!-- Pages and search (after sign-in only) -->
		<aside
			v-if="!beforeSignIn"
			class="w-72 shrink-0 border-e border-border flex flex-col"
			data-testid="help-nav"
		>
			<div class="p-3 border-b border-border space-y-2">
				<div class="flex items-center gap-2 font-semibold text-foreground">
					<BookOpen class="h-4 w-4" />
					{{ __("User Guide") }}
				</div>
				<div class="relative">
					<Search
						class="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
					/>
					<Input
						v-model="query"
						:placeholder="__('Search the guide')"
						class="ps-8 pe-8 h-9"
						data-testid="help-search"
					/>
					<button
						v-if="query"
						type="button"
						class="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						:aria-label="__('Clear search')"
						@click="query = ''"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>
			<nav class="flex-1 overflow-y-auto p-2 text-sm">
				<template v-if="query.trim()">
					<p v-if="!hits.length" class="px-2 py-3 text-muted-foreground">
						{{ __("Nothing found") }}
					</p>
					<button
						v-for="hit in hits"
						:key="hit.page + hit.section"
						type="button"
						class="w-full text-start rounded-md px-2 py-2 hover:bg-muted"
						data-testid="help-hit"
						@click="open(hit.page, hit.section)"
					>
						<div class="font-medium text-foreground">{{ hit.sectionTitle }}</div>
						<div class="text-xs text-muted-foreground">{{ hit.pageTitle }}</div>
						<div class="text-xs text-muted-foreground line-clamp-2 mt-0.5">{{ hit.snippet }}</div>
					</button>
				</template>
				<template v-else>
					<button
						v-for="p in pages"
						:key="p.id"
						type="button"
						class="w-full text-start rounded-md px-2 py-1.5"
						:class="
							p.id === pageId
								? 'bg-primary/10 text-primary font-medium'
								: 'hover:bg-muted text-foreground'
						"
						@click="open(p.id)"
					>
						{{ p.title }}
					</button>
				</template>
			</nav>
		</aside>

		<!-- The page -->
		<main ref="content" class="flex-1 overflow-y-auto" @click="onContentClick">
			<div class="max-w-3xl mx-auto px-6 py-6">
				<div v-if="beforeSignIn" class="mb-4 flex items-center justify-between gap-3">
					<div class="flex items-center gap-2 font-semibold text-foreground">
						<BookOpen class="h-4 w-4" />
						{{ __("Help with signing in") }}
					</div>
					<Button variant="outline" size="sm" @click="router.push({ name: 'login' })">
						<ArrowLeft class="h-4 w-4 me-1" />
						{{ __("Back to sign-in") }}
					</Button>
				</div>

				<div v-if="!beforeSignIn && outline.length > 2" class="mb-6 flex flex-wrap gap-1.5 text-xs">
					<button
						v-for="s in outline"
						:key="s.id"
						type="button"
						class="rounded-full border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-muted"
						@click="open(pageId, s.id)"
					>
						{{ s.title }}
					</button>
				</div>

				<p
					v-if="!beforeSignIn && page && page.lang !== lang && lang !== 'en'"
					class="mb-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
				>
					{{ __("This page is not translated yet, so it is shown in English.") }}
				</p>

				<!-- eslint-disable-next-line vue/no-v-html -- sanitised by DOMPurify in renderPage -->
				<article class="help-doc" data-testid="help-page" v-html="html" />
			</div>
		</main>
	</div>
</template>
