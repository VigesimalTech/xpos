<script setup lang="ts">
/**
 * K44: the till locked itself after being left idle. The signed-in cashier's PIN (or their
 * password, if they have no PIN) opens it again; the sale in progress is still there.
 * Sign Out hands the till to someone else. Nothing behind it can be reached meanwhile.
 */
import { onMounted, onUnmounted, ref, watch } from "vue";
import { Lock, LogOut, Loader2 } from "lucide-vue-next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PinPad from "@/components/auth/PinPad.vue";
import { useAuthStore } from "@/stores/authStore";

const auth = useAuthStore();
const pin = ref("");
const password = ref("");
const checking = ref(false);

async function tryPin() {
	if (pin.value.length < 4 || checking.value) return;
	checking.value = true;
	try {
		if (!(await auth.unlockWithPin(pin.value))) pin.value = "";
	} finally {
		checking.value = false;
	}
}

async function tryPassword() {
	if (!password.value || checking.value) return;
	checking.value = true;
	try {
		if (!(await auth.unlockWithPassword(password.value))) password.value = "";
	} finally {
		checking.value = false;
	}
}

// A full PIN is tried at once, as at sign-in.
watch(pin, (value) => {
	if (value.length === 6) void tryPin();
});

// The number keys work too, and nothing behind the lock hears them.
function onKey(event: KeyboardEvent) {
	if (!auth.lockUsesPin) return;
	if (/^[0-9]$/.test(event.key) && pin.value.length < 6) pin.value += event.key;
	else if (event.key === "Backspace") pin.value = pin.value.slice(0, -1);
	else if (event.key === "Enter") void tryPin();
	else return;
	event.preventDefault();
	event.stopPropagation();
}
onMounted(() => window.addEventListener("keydown", onKey, { capture: true }));
onUnmounted(() => window.removeEventListener("keydown", onKey, { capture: true }));
</script>

<template>
	<div
		class="fixed inset-0 z-[1000] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4"
		role="dialog"
		aria-modal="true"
		data-testid="lock-screen"
	>
		<Card class="w-full max-w-sm">
			<CardHeader class="text-center">
				<div
					class="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"
				>
					<Lock class="h-5 w-5" />
				</div>
				<CardTitle class="text-xl">{{ auth.userFullName || auth.userName }}</CardTitle>
				<CardDescription>
					{{
						auth.lockUsesPin
							? "The till locked while no one was using it. Enter your PIN to carry on."
							: "The till locked while no one was using it. Enter your password to carry on."
					}}
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<template v-if="auth.lockUsesPin">
					<PinPad v-model="pin" :disabled="checking" />
					<Button class="w-full" :disabled="pin.length < 4 || checking" @click="tryPin">
						<Loader2 v-if="checking" class="me-2 h-4 w-4 animate-spin" />
						Unlock
					</Button>
				</template>
				<form v-else class="space-y-3" @submit.prevent="tryPassword">
					<Input
						v-model="password"
						type="password"
						placeholder="Password"
						autofocus
						data-testid="lock-password"
					/>
					<Button type="submit" class="w-full" :disabled="!password || checking">
						<Loader2 v-if="checking" class="me-2 h-4 w-4 animate-spin" />
						Unlock
					</Button>
				</form>
				<p v-if="auth.error" class="text-sm text-destructive text-center" data-testid="lock-error">
					{{ auth.error }}
				</p>
				<Button variant="ghost" class="w-full text-muted-foreground" @click="auth.logout()">
					<LogOut class="me-2 h-4 w-4" />
					Sign out, for someone else to use the till
				</Button>
			</CardContent>
		</Card>
	</div>
</template>
