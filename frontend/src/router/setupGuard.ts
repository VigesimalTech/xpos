/**
 * Where the desktop till goes at start, from the main process's setup state
 * (electron/startup/setupState.ts): the setup wizard, a wait for the local
 * database, or on to the normal sign-in checks.
 */
import { isElectron } from "@/services/electronBridge";

export type SetupState = "ready" | "setup" | "waiting-for-database";

type Target = { name?: unknown; meta: { isSetupPage?: unknown; isStartingPage?: unknown } };

/**
 * The route name to redirect to, "" to show `to` as it is, or null to go on to
 * the sign-in checks.
 */
export function setupRedirect(state: SetupState, to: Target): string | null {
	const onSetup = to.meta.isSetupPage === true;
	const onStarting = to.meta.isStartingPage === true;
	if (state === "waiting-for-database") return onStarting ? "" : "starting";
	if (state === "setup") return onSetup ? "" : "setup";
	if (onSetup || onStarting) return "login";
	return null;
}

let checked: SetupState | null = null;

/**
 * Ask the main process once; "ready" and "setup" are kept for the session,
 * the wait is asked again until it ends. Not the desktop app: always ready.
 */
export async function checkSetupState(): Promise<SetupState> {
	if (checked) return checked;
	if (!isElectron()) return "ready";
	let state: SetupState;
	try {
		state = await window.electronAPI!.getSetupState();
	} catch {
		state = "waiting-for-database";
	}
	if (state !== "waiting-for-database") checked = state;
	return state;
}

/** Ask again at the next navigation (the wait ended). */
export function resetSetupState(): void {
	checked = null;
}

/** The setup wizard finished. */
export function markSetupComplete(): void {
	checked = "ready";
}
