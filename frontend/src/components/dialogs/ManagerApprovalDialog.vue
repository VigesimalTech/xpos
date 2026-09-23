<template>
	<Dialog :open="store.open" @update:open="(val: boolean) => !val && cancel()">
		<DialogContent class="max-w-md">
			<DialogHeader>
				<div class="flex items-center gap-2">
					<div
						class="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center"
					>
						<ShieldCheck class="w-4 h-4" />
					</div>
					<div>
						<DialogTitle class="text-base flex items-center gap-1.5">
							{{ chosen ? chosen.full_name : __("Manager approval") }}
							<HelpLink topic="managerApproval" :label="__('How manager approval works')" />
						</DialogTitle>
						<DialogDescription class="text-xs">
							{{ chosen ? __("Enter your PIN to approve") : store.reason }}
						</DialogDescription>
					</div>
				</div>
			</DialogHeader>

			<div
				v-if="error"
				class="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2"
			>
				<AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
				<span>{{ error }}</span>
			</div>

			<div v-if="store.loading" class="flex justify-center py-6">
				<Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
			</div>

			<p v-else-if="!store.approvers.length" class="text-sm text-muted-foreground py-2">
				{{ __("No one on this till can approve this. Ask a manager, or change the sale.") }}
			</p>

			<div v-else-if="!chosen" class="grid grid-cols-2 gap-3">
				<button
					v-for="a in store.approvers"
					:key="a.name"
					type="button"
					:data-approver="a.name"
					class="flex flex-col items-center gap-2 rounded-xl border border-border p-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					@click="choose(a)"
				>
					<span
						class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary"
					>
						{{ initials(a.full_name) }}
					</span>
					<span class="text-sm font-medium text-foreground text-center">{{ a.full_name }}</span>
				</button>
			</div>

			<template v-else>
				<PinPad v-model="pin" :disabled="busy" />
				<Button
					data-pin-submit
					class="w-full"
					size="lg"
					:disabled="busy || pin.length < 4"
					@click="submit"
				>
					<Loader2 v-if="busy" class="w-4 h-4 animate-spin" />
					<ShieldCheck v-else class="w-4 h-4" />
					{{ __("Approve") }}
				</Button>
				<button
					type="button"
					class="w-full text-sm text-primary hover:underline"
					@click="choose(null)"
				>
					{{ __("Not {0}?", [chosen.full_name]) }}
				</button>
			</template>

			<Button data-approval-cancel variant="ghost" class="w-full" @click="cancel">
				{{ __("Cancel") }}
			</Button>
		</DialogContent>
	</Dialog>
</template>

<script setup lang="ts">
import HelpLink from "@/components/help/HelpLink.vue";
/**
 * A manager approves, with their PIN, what the cashier may not do alone (K19). Opened
 * by `useApprovalStore().requestApproval`; lists only those who may approve this.
 */
import { onMounted, onUnmounted, ref, watch } from "vue";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PinPad from "@/components/auth/PinPad.vue";
import { __ } from "@/lib/translate";
import { useApprovalStore, type Approver } from "@/stores/approvalStore";

const store = useApprovalStore();
const chosen = ref<Approver | null>(null);
const pin = ref("");
const error = ref("");
const busy = ref(false);

const REFUSALS: Record<string, string> = {
	wrong_pin: "Wrong PIN.",
	locked: "Too many wrong PINs. Try again in a few minutes, or ask another manager.",
	no_pin: "This manager has no till PIN yet. Set one in ERPNext.",
	disabled: "This user is disabled.",
	not_an_approver: "This user may not approve exceptions.",
	self_approval: "You cannot approve your own exception here.",
	lacks_permission: "This manager may not do this either.",
	over_limit: "This is beyond this manager's own discount limit.",
	unknown_user: "This user is not on this till.",
};

watch(
	() => store.open,
	(open) => {
		if (open) {
			chosen.value = null;
			pin.value = "";
			error.value = "";
		}
	},
);

function initials(name: string) {
	return name
		.split(/\s+/)
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

function choose(a: Approver | null) {
	chosen.value = a;
	pin.value = "";
	error.value = "";
}

async function submit() {
	if (!chosen.value || pin.value.length < 4) return;
	busy.value = true;
	try {
		const result = await store.verify(chosen.value.name, pin.value);
		pin.value = "";
		if (result.ok) {
			store.finish(result.approver);
			return;
		}
		const message = __(REFUSALS[result.reason] ?? "Not approved.");
		error.value =
			result.reason === "wrong_pin" && result.attemptsLeft !== undefined
				? `${message} ${__("{0} tries left.", [String(result.attemptsLeft)])}`
				: message;
	} finally {
		busy.value = false;
	}
}

// Number keys, Backspace and Enter work on the PIN pad too, as on the sign-in screen:
// a manager at a till with a keyboard or a number pad types the PIN.
function onKey(event: KeyboardEvent) {
	if (!store.open || !chosen.value || busy.value) return;
	if (/^[0-9]$/.test(event.key)) {
		if (pin.value.length < 6) pin.value += event.key;
	} else if (event.key === "Backspace") {
		pin.value = pin.value.slice(0, -1);
	} else if (event.key === "Enter") {
		void submit();
	} else {
		return;
	}
	event.preventDefault();
	event.stopImmediatePropagation();
}

// Captured first, so the till's own shortcuts do not act on the same keys.
onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));

function cancel() {
	store.finish(null);
}
</script>
