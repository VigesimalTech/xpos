<template>
	<div
		class="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background to-muted p-4"
	>
		<div class="text-center max-w-sm">
			<div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary flex items-center justify-center">
				<Loader2 class="w-8 h-8 text-primary-foreground animate-spin" />
			</div>
			<h1 class="text-2xl font-bold text-foreground">X POS</h1>
			<p class="text-foreground mt-4">Waiting for the local database…</p>
			<p class="text-muted-foreground text-sm mt-2">
				This till is set up. It carries on by itself once the database has started, usually within a
				minute of switching on.
			</p>
			<p v-if="waitedLong" class="text-muted-foreground text-sm mt-4">
				Still waiting. Restart the till; if that does not help, call your manager.
			</p>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Shown when the till has been set up but its local MariaDB is not answering
 * yet (after a power cut, or opening at login). It never offers setup: the
 * till's settings are in that database and are fine.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Loader2 } from "lucide-vue-next";
import { resetSetupState } from "@/router/setupGuard";

const POLL_MS = 2000;
const LONG_WAIT_MS = 3 * 60 * 1000;

const router = useRouter();
const waitedLong = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;
const started = Date.now();

async function check(): Promise<void> {
	if (stopped) return;
	let state = "waiting-for-database";
	try {
		state = await window.electronAPI!.getSetupState();
	} catch {
		/* ask again */
	}
	if (stopped) return;
	if (state !== "waiting-for-database") {
		resetSetupState();
		await router.replace({ name: "login" });
		return;
	}
	waitedLong.value = Date.now() - started > LONG_WAIT_MS;
	timer = setTimeout(check, POLL_MS);
}

onMounted(() => {
	void check();
});

onBeforeUnmount(() => {
	stopped = true;
	if (timer) clearTimeout(timer);
});
</script>
