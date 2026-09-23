<script setup lang="ts">
/**
 * A "?" that opens the guide's section for this screen in a window over it, so a dialog
 * waiting on the cashier (an approval, a payment) is never left behind. "Open in User
 * Guide" goes to the full page once they are done.
 *
 * The guide is loaded only when the "?" is first pressed.
 */
import { ref } from "vue";
import { useRouter } from "vue-router";
import { CircleHelp, BookOpen, Loader2 } from "lucide-vue-next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import __ from "@/lib/translate";
import { useAuthStore } from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
	HELP_TOPICS,
	helpAudience,
	helpRoute,
	isPublic,
	splitTarget,
	type HelpTopic,
} from "@/help/helpLinks";

const props = defineProps<{ topic: HelpTopic; label?: string }>();

const router = useRouter();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();

const open = ref(false);
const loading = ref(false);
const title = ref("");
const html = ref("");

async function show() {
	open.value = true;
	if (html.value) return;
	loading.value = true;
	try {
		const [{ getPage, isVisible, pageFor, sectionAsPage }, { renderPage }] = await Promise.all([
			import("@/help/guide"),
			import("@/help/render"),
			import("@/help/help-doc.css"),
		]);
		const { page: id, section } = splitTarget(HELP_TOPICS[props.topic]);
		const lang = (settingsStore.language || "en").split("-")[0];
		const audience = helpAudience(authStore.isAuthenticated);
		const full = getPage(id, lang);
		const page = full && pageFor(full, audience);
		const part = page && section ? sectionAsPage(page, section) : null;
		if (!page || !part) return;
		title.value = part.sections[0]?.title ?? page.title;
		const body = part.markdown.split("\n").slice(1).join("\n");
		html.value = renderPage(body, {
			sections: part.sections.slice(1),
			hrefFor: (to, s) => router.resolve(helpRoute(to, s)).href,
			// Links lead out of this window: offer them only where the guide can be opened.
			allowPage: (to, s) =>
				isVisible(to, s, audience, lang) && (authStore.isAuthenticated || isPublic(to, s)),
		});
	} finally {
		loading.value = false;
	}
}

function openFullGuide() {
	open.value = false;
	if (!authStore.isAuthenticated) {
		router.push({ name: "help-sign-in" });
		return;
	}
	const { page, section } = splitTarget(HELP_TOPICS[props.topic]);
	router.push(helpRoute(page, section));
}

function onContentClick(event: MouseEvent) {
	const link = (event.target as HTMLElement).closest("a[data-help-page]") as HTMLAnchorElement | null;
	if (!link) return;
	event.preventDefault();
	open.value = false;
	router.push(helpRoute(link.dataset.helpPage, link.dataset.helpSection));
}
</script>

<template>
	<button
		type="button"
		class="inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		:aria-label="label || __('Help')"
		:title="label || __('Help')"
		data-testid="help-link"
		@click.stop="show"
	>
		<CircleHelp class="h-4 w-4" />
	</button>

	<Dialog v-model:open="open">
		<DialogContent class="max-w-xl max-h-[80vh] flex flex-col" data-testid="help-link-dialog">
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<BookOpen class="h-4 w-4" />
					{{ title || __("Help") }}
				</DialogTitle>
			</DialogHeader>
			<div class="flex-1 overflow-y-auto pe-1" @click="onContentClick">
				<div v-if="loading" class="flex justify-center py-6">
					<Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
				<!-- eslint-disable-next-line vue/no-v-html -- sanitised by DOMPurify in renderPage -->
				<div v-else class="help-doc" v-html="html" />
			</div>
			<div class="flex justify-end pt-2">
				<Button variant="outline" size="sm" @click="openFullGuide">
					{{
						authStore.isAuthenticated ? __("Open in User Guide") : __("More help with signing in")
					}}
				</Button>
			</div>
		</DialogContent>
	</Dialog>
</template>
