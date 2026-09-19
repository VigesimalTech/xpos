<template>
	<div
		class="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background to-muted p-4"
	>
		<div class="mb-8 text-center">
			<img
				:src="isDark ? logoLight : logoDark"
				alt="X POS Logo"
				class="w-16 h-16 mx-auto mb-4 rounded-2xl text-primary-foreground flex items-center justify-center"
			/>
			<h1 class="text-2xl font-bold text-foreground">X POS</h1>
			<p class="text-muted-foreground text-sm mt-1">Point of Sale System</p>
		</div>

		<Card v-if="mode === 'pin'" class="w-full max-w-md">
			<CardHeader class="text-center">
				<CardTitle class="text-xl">
					{{ selectedUser ? selectedUser.full_name : "Who is signing in?" }}
				</CardTitle>
				<CardDescription>
					{{ selectedUser ? "Enter your PIN" : "Tap your name" }}
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div
					v-if="authStore.error"
					class="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2"
				>
					<AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
					<span>{{ authStore.error }}</span>
				</div>

				<div v-if="!selectedUser" class="grid grid-cols-2 gap-3">
					<button
						v-for="u in pinUsers"
						:key="u.name"
						type="button"
						:data-pin-user="u.name"
						class="flex flex-col items-center gap-2 rounded-xl border border-border p-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						@click="chooseUser(u)"
					>
						<span
							class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary"
						>
							{{ initials(u.full_name) }}
						</span>
						<span class="text-sm font-medium text-foreground text-center">{{ u.full_name }}</span>
					</button>
				</div>

				<template v-else>
					<div
						class="flex justify-center gap-3"
						aria-live="polite"
						:aria-label="`${pin.length} digits entered`"
					>
						<span
							v-for="i in PIN_MAX"
							:key="i"
							class="h-3.5 w-3.5 rounded-full border border-primary"
							:class="
								i <= pin.length ? 'bg-primary' : i > PIN_MIN ? 'border-dashed opacity-50' : ''
							"
						/>
					</div>
					<div class="grid grid-cols-3 gap-3">
						<button
							v-for="key in ['1', '2', '3', '4', '5', '6', '7', '8', '9']"
							:key="key"
							type="button"
							:data-pin-key="key"
							class="h-14 rounded-xl border border-border text-xl font-semibold hover:bg-muted"
							:disabled="authStore.isLoading"
							@click="pressDigit(key)"
						>
							{{ key }}
						</button>
						<button
							type="button"
							class="h-14 rounded-xl text-sm text-muted-foreground hover:bg-muted"
							@click="pin = ''"
						>
							Clear
						</button>
						<button
							type="button"
							data-pin-key="0"
							class="h-14 rounded-xl border border-border text-xl font-semibold hover:bg-muted"
							:disabled="authStore.isLoading"
							@click="pressDigit('0')"
						>
							0
						</button>
						<button
							type="button"
							aria-label="Delete last digit"
							class="h-14 rounded-xl text-muted-foreground hover:bg-muted flex items-center justify-center"
							@click="pin = pin.slice(0, -1)"
						>
							<Delete class="w-5 h-5" />
						</button>
					</div>
					<Button
						data-pin-submit
						class="w-full"
						size="lg"
						:disabled="authStore.isLoading || pin.length < PIN_MIN"
						@click="submitPin"
					>
						<Loader2 v-if="authStore.isLoading" class="w-4 h-4 animate-spin" />
						<LogIn v-else class="w-4 h-4" />
						{{ authStore.isLoading ? "Signing in..." : "Sign In" }}
					</Button>
					<button
						type="button"
						class="w-full text-sm text-primary hover:underline"
						@click="chooseUser(null)"
					>
						Not {{ selectedUser.full_name }}?
					</button>
				</template>

				<button
					type="button"
					data-use-password
					class="w-full text-sm text-muted-foreground hover:underline"
					@click="setMode('password')"
				>
					Use password instead
				</button>
			</CardContent>
		</Card>

		<Card v-else class="w-full max-w-md">
			<CardHeader class="text-center">
				<CardTitle class="text-xl">Welcome back</CardTitle>
				<CardDescription>Sign in to your account to continue</CardDescription>
			</CardHeader>
			<CardContent>
				<form @submit.prevent="handleLogin" class="space-y-4">
					<div
						v-if="!tillHasUsers"
						data-no-till-users
						class="p-3 rounded-lg bg-muted text-muted-foreground text-sm"
					>
						No cashiers on this till yet. They arrive from ERPNext with the next sync: the till's
						API user must be on the shop's POS Profile, with the cashiers.
					</div>
					<div
						v-if="authStore.error"
						class="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2"
					>
						<AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
						<span>{{ authStore.error }}</span>
					</div>
					<div class="space-y-2">
						<label for="username" class="text-sm font-medium text-foreground">
							Email or Username
						</label>
						<div class="relative">
							<User
								class="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
							/>
							<Input
								id="username"
								v-model="username"
								type="text"
								placeholder="Enter your email or username"
								class="ps-10"
								:disabled="authStore.isLoading"
								required
								autocomplete="username"
							/>
						</div>
					</div>

					<div class="space-y-2">
						<label for="password" class="text-sm font-medium text-foreground"> Password </label>
						<div class="relative">
							<Lock
								class="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
							/>
							<Input
								id="password"
								v-model="password"
								:type="showPassword ? 'text' : 'password'"
								placeholder="Enter your password"
								class="ps-10 pe-10"
								:disabled="authStore.isLoading"
								required
								autocomplete="current-password"
							/>
							<button
								type="button"
								class="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
								@click="showPassword = !showPassword"
							>
								<EyeOff v-if="showPassword" class="w-4 h-4" />
								<Eye v-else class="w-4 h-4" />
							</button>
						</div>
					</div>

					<div class="flex justify-end">
						<RouterLink to="/reset-password" class="text-sm text-primary hover:underline">
							Forgot password?
						</RouterLink>
					</div>

					<Button
						type="submit"
						class="w-full"
						size="lg"
						:disabled="authStore.isLoading || !username || !password"
					>
						<Loader2 v-if="authStore.isLoading" class="w-4 h-4 animate-spin" />
						<LogIn v-else class="w-4 h-4" />
						{{ authStore.isLoading ? "Signing in..." : "Sign In" }}
					</Button>
					<button
						v-if="pinUsers.length"
						type="button"
						class="w-full text-sm text-muted-foreground hover:underline"
						@click="setMode('pin')"
					>
						Sign in with a PIN
					</button>
				</form>
			</CardContent>
		</Card>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, inject } from "vue";
import { isElectron } from "@/services/electronBridge";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/authStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { User, Lock, Eye, EyeOff, LogIn, Loader2, AlertCircle, Delete } from "lucide-vue-next";
import { useBranding } from "@/composables/useBranding";
const isDark = inject("isDark")! as boolean;
const { logoLight, logoDark } = useBranding();

const router = useRouter();
const authStore = useAuthStore();

const username = ref("");
const password = ref("");
const showPassword = ref(false);

// PIN sign-in on the desktop till: cashiers whose PIN hash came from ERPNext.
type PinUser = { name: string; username: string; full_name: string };
const PIN_MIN = 4;
const PIN_MAX = 6;
const pinUsers = ref<PinUser[]>([]);
const mode = ref<"pin" | "password">("password");
const selectedUser = ref<PinUser | null>(null);
const pin = ref("");

function initials(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]!.toUpperCase())
		.join("");
}

function setMode(next: "pin" | "password") {
	mode.value = next;
	pin.value = "";
	authStore.clearError();
}

function chooseUser(u: PinUser | null) {
	selectedUser.value = u;
	pin.value = "";
	authStore.clearError();
}

function pressDigit(digit: string) {
	if (pin.value.length < PIN_MAX) pin.value += digit;
}

async function submitPin() {
	if (!selectedUser.value || pin.value.length < PIN_MIN) return;
	const success = await authStore.loginWithPin(selectedUser.value.name, pin.value);
	pin.value = "";
	if (success) {
		const redirectTo = (router.currentRoute.value.query.redirect as string) || "/pos";
		router.push(redirectTo);
	}
}

// Number keys, Backspace and Enter work on the PIN pad too.
function onPinKey(event: KeyboardEvent) {
	if (mode.value !== "pin" || !selectedUser.value) return;
	if (/^[0-9]$/.test(event.key)) pressDigit(event.key);
	else if (event.key === "Backspace") pin.value = pin.value.slice(0, -1);
	else if (event.key === "Enter") submitPin();
}

// Only cashiers from ERPNext sign in on the till. A new till gets them with its first
// sync, which may finish after this screen opens.
const tillHasUsers = ref(true);

async function loadPinUsers() {
	if (!isElectron()) return;
	const hadPinUsers = pinUsers.value.length > 0;
	try {
		pinUsers.value = (await window.electronAPI!.db.getPinUsers()) || [];
	} catch {
		pinUsers.value = [];
	}
	try {
		const users = (await window.electronAPI!.db.getPosUsers()) as unknown[] | null;
		tillHasUsers.value = !!users?.length;
	} catch {
		tillHasUsers.value = true;
	}
	if (!hadPinUsers && pinUsers.value.length && !username.value) mode.value = "pin";
}

let stopSyncListener: (() => void) | undefined;

async function handleLogin() {
	if (!username.value || !password.value) return;

	const success = await authStore.login(username.value, password.value);
	if (success) {
		const redirectTo = (router.currentRoute.value.query.redirect as string) || "/pos";
		router.push(redirectTo);
	}
}

onMounted(() => {
	authStore.clearError();
	loadPinUsers();
	if (isElectron()) stopSyncListener = window.electronAPI!.onSyncComplete(() => loadPinUsers());
	window.addEventListener("keydown", onPinKey);
});

onUnmounted(() => {
	authStore.clearError();
	stopSyncListener?.();
	window.removeEventListener("keydown", onPinKey);
});
</script>
