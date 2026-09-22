<template>
	<ReturnDialog :open="showReturn" @close="showReturn = false" />
	<RepeatInvoiceDialog :open="showRepeat" @close="showRepeat = false" />
	<OfflinePendingPanel :open="showPending" @close="showPending = false" />
</template>

<script setup lang="ts">
/**
 * The dialogs the menus, shortcuts and search open by event: Return Invoice, Repeat
 * Invoice and the panel of sales not yet in ERPNext. They lived in the web POS's navbar,
 * which the desktop till does not show, so on the till the menu items, Ctrl+R, Ctrl+G and
 * the sync pill did nothing (found by the bug hunt). Rendered by the layout on both.
 */
import { onMounted, onUnmounted, ref } from "vue";
import ReturnDialog from "@/components/dialogs/ReturnDialog.vue";
import RepeatInvoiceDialog from "@/components/dialogs/RepeatInvoiceDialog.vue";
import OfflinePendingPanel from "@/components/offline/OfflinePendingPanel.vue";
import { usePosStore } from "@/stores/posStore";
import { canDoOrAsk } from "@/services/userRights";

const posStore = usePosStore();
const showReturn = ref(false);
const showRepeat = ref(false);
const showPending = ref(false);

function openReturn() {
	if (posStore.allowReturn && canDoOrAsk("sale_return")) showReturn.value = true;
}
function openRepeat() {
	showRepeat.value = true;
}
function openPending() {
	showPending.value = true;
}

const listeners: [string, () => void][] = [
	["xpos:show-return-dialog", openReturn],
	["xpos:show-repeat-dialog", openRepeat],
	["xpos:open-offline-panel", openPending],
];

onMounted(() => listeners.forEach(([event, fn]) => window.addEventListener(event, fn)));
onUnmounted(() => listeners.forEach(([event, fn]) => window.removeEventListener(event, fn)));
</script>
