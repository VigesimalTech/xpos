/**
 * K44: the desktop till locks itself when left alone, so whoever walks up to a signed-in
 * till cannot sell or approve as the cashier who left it. After the POS Profile's Lock
 * After Idle (Minutes) with no touch, click, key or scroll, the till asks the signed-in
 * cashier's PIN (or password) again; the session and the sale in progress stay.
 *
 * Desktop only: the web POS has no PINs to ask for.
 */
import { onMounted, onUnmounted, watch } from "vue";
import { isElectron } from "@/services/electronBridge";
import { useAuthStore } from "@/stores/authStore";
import { usePosStore } from "@/stores/posStore";

const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;

export function useIdleLock(): void {
	if (!isElectron()) return;
	const auth = useAuthStore();
	const pos = usePosStore();
	let timer: ReturnType<typeof setTimeout> | null = null;

	function arm() {
		if (timer) clearTimeout(timer);
		timer = null;
		const minutes = pos.idleLockMinutes;
		if (!auth.isAuthenticated || auth.locked || !minutes) return;
		timer = setTimeout(() => void auth.lock(), minutes * 60_000);
	}

	// Activity only counts while unlocked: typing a PIN on the lock screen is not "use".
	const onActivity = () => {
		if (!auth.locked) arm();
	};

	onMounted(() => {
		for (const event of ACTIVITY)
			window.addEventListener(event, onActivity, { capture: true, passive: true });
		arm();
	});
	onUnmounted(() => {
		for (const event of ACTIVITY) window.removeEventListener(event, onActivity, { capture: true });
		if (timer) clearTimeout(timer);
	});

	// Signed in, unlocked again, or the profile's minutes changed: start counting afresh.
	watch(() => [auth.isAuthenticated, auth.locked, pos.idleLockMinutes], arm);
}
