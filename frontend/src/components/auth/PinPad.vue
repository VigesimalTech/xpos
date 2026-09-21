<template>
	<div class="space-y-4">
		<div
			class="flex justify-center gap-3"
			aria-live="polite"
			:aria-label="`${modelValue.length} digits entered`"
		>
			<span
				v-for="i in max"
				:key="i"
				class="h-3.5 w-3.5 rounded-full border border-primary"
				:class="i <= modelValue.length ? 'bg-primary' : i > min ? 'border-dashed opacity-50' : ''"
			/>
		</div>
		<div class="grid grid-cols-3 gap-3">
			<button
				v-for="key in ['1', '2', '3', '4', '5', '6', '7', '8', '9']"
				:key="key"
				type="button"
				:data-pin-key="key"
				class="h-14 rounded-xl border border-border text-xl font-semibold hover:bg-muted"
				:disabled="disabled"
				@click="press(key)"
			>
				{{ key }}
			</button>
			<button
				type="button"
				class="h-14 rounded-xl text-sm text-muted-foreground hover:bg-muted"
				@click="emit('update:modelValue', '')"
			>
				Clear
			</button>
			<button
				type="button"
				data-pin-key="0"
				class="h-14 rounded-xl border border-border text-xl font-semibold hover:bg-muted"
				:disabled="disabled"
				@click="press('0')"
			>
				0
			</button>
			<button
				type="button"
				aria-label="Delete last digit"
				class="h-14 rounded-xl text-muted-foreground hover:bg-muted flex items-center justify-center"
				@click="emit('update:modelValue', modelValue.slice(0, -1))"
			>
				<Delete class="w-5 h-5" />
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
/** The till's PIN pad: dots for the digits entered, and the keys. Sign-in and approvals. */
import { Delete } from "lucide-vue-next";

const props = withDefaults(
	defineProps<{ modelValue: string; disabled?: boolean; min?: number; max?: number }>(),
	{
		disabled: false,
		min: 4,
		max: 6,
	},
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

function press(digit: string) {
	if (props.modelValue.length < props.max) emit("update:modelValue", props.modelValue + digit);
}
</script>
