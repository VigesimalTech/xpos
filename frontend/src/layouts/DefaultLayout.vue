<template>
	<div class="flex flex-col h-dvh overflow-hidden">
		<MenuBar v-if="isElectron()" />
		<Navbar v-else />
		<div class="flex-1 relative overflow-hidden">
			<Sidebar />
			<main class="h-full overflow-hidden">
				<slot />
			</main>
		</div>

		<nav
			v-if="!isElectron()"
			class="md:hidden shrink-0 bg-background/95 backdrop-blur-md border-t border-border z-40 safe-bottom"
		>
			<div class="flex items-center justify-around h-14">
				<router-link
					to="/pos"
					:class="[
						'flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors no-underline min-w-[4rem]',
						route.path === '/pos'
							? 'text-primary bg-primary/10'
							: 'text-muted-foreground active:bg-muted',
					]"
				>
					<LayoutGrid class="w-5 h-5" />
					<span class="text-[10px] font-medium">{{ __("POS") }}</span>
				</router-link>
				<router-link
					to="/orders"
					:class="[
						'flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors no-underline min-w-[4rem]',
						route.path === '/orders'
							? 'text-primary bg-primary/10'
							: 'text-muted-foreground active:bg-muted',
					]"
				>
					<FileText class="w-5 h-5" />
					<span class="text-[10px] font-medium">{{ __("Orders") }}</span>
				</router-link>
				<router-link
					v-if="canOpenScreen('reports')"
					to="/reports"
					:class="[
						'flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors no-underline min-w-[4rem]',
						route.path.startsWith('/reports')
							? 'text-primary bg-primary/10'
							: 'text-muted-foreground active:bg-muted',
					]"
				>
					<BarChart3 class="w-5 h-5" />
					<span class="text-[10px] font-medium">{{ __("Reports") }}</span>
				</router-link>
				<button
					@click="openSidebar"
					class="flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 rounded-xl text-muted-foreground active:bg-muted transition-colors min-w-[4rem]"
				>
					<AlignJustify class="w-5 h-5" />
					<span class="text-[10px] font-medium">{{ __("Menu") }}</span>
				</button>
			</div>
		</nav>
	</div>
</template>

<script setup lang="ts">
import Navbar from "@/components/Navbar.vue";
import { canOpenScreen } from "@/services/screenAccess";
import Sidebar from "@/components/Sidebar.vue";
import MenuBar from "@/components/MenuBar.vue";
import { isElectron } from "@/services/electronBridge";
import { useRoute } from "vue-router";
import { LayoutGrid, FileText, BarChart3, AlignJustify } from "lucide-vue-next";
import __ from "@/lib/translate";

const route = useRoute();

function openSidebar() {
	window.dispatchEvent(new CustomEvent("xpos:toggle-sidebar"));
}
</script>
