import { call } from "@/services/api";
import { setTillIdentity } from "@/services/tillIdentity";
import { isElectron } from "@/services/electronBridge";
import { loadPermissions, resetPermissions } from "@/services/userRights";
import { forgetSession, recallSession, rememberSession } from "@/services/offlineSession";
import { UserSession } from "@/types/pos.types";
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { isOnline, isNetworkError } from "@/utils";

function friendlyMessage(err: unknown, fallback: string): string {
	if (isNetworkError(err)) return "Cannot reach the server. Check your connection and try again.";
	const message = err instanceof Error ? err.message : "";
	if (!message || message.includes("Traceback") || message.startsWith("__")) return fallback;
	return message;
}

function pinErrorMessage(result: { reason?: string; attemptsLeft?: number; lockedUntil?: string }): string {
	switch (result.reason) {
		case "wrong_pin":
			return result.attemptsLeft === 1
				? "Wrong PIN. 1 try left before this till locks you out for 5 minutes."
				: `Wrong PIN. ${result.attemptsLeft} tries left.`;
		case "locked": {
			const until = result.lockedUntil ? new Date(result.lockedUntil.replace(" ", "T")) : null;
			const at =
				until && !Number.isNaN(until.getTime())
					? ` until ${until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
					: "";
			return `Too many wrong PINs. PIN sign-in is locked${at}. You can sign in with your password.`;
		}
		case "no_pin":
			return "No PIN is set for this user. Sign in with your password, or ask a manager to set a PIN.";
		case "disabled":
			return "This user is disabled.";
		default:
			return "User not found. Check your username.";
	}
}

export const useAuthStore = defineStore("auth", () => {
	const isLoading = ref(false);
	const isAuthenticated = ref(false);
	const user = ref<UserSession | null>(null);
	const error = ref("");
	const resetEmailSent = ref(false);
	const isOfflineAuth = ref(false);

	const userName = computed(() => user.value?.user || "Guest");
	const userEmail = computed(() => user.value?.user_email || "");
	const userFullName = computed(() => user.value?.user_fullname || "");
	const isGuest = computed(() => !user.value || user.value.user === "Guest");

	if (isElectron()) {
		watch(
			() => user.value?.user,
			(cashier) => setTillIdentity({ cashier: cashier && cashier !== "Guest" ? cashier : undefined }),
			{ immediate: true },
		);
	}
	const isSystemManager = computed(() =>
		Boolean((window.xpos?.boot as Record<string, unknown> | undefined)?.xpos_is_system_manager),
	);
	const canManagePermissions = computed(() =>
		Boolean((window.xpos?.boot as Record<string, unknown> | undefined)?.xpos_can_manage_permissions),
	);

	async function checkAuth(): Promise<boolean> {
		try {
			isLoading.value = true;
			error.value = "";

			if (isElectron()) {
				return await checkOfflineAuth();
			}

			const response = await call("frappe.auth.get_logged_user");

			if (!response) {
				forgetSession();
				isAuthenticated.value = false;
				user.value = null;
				return false;
			}
			const loggedUser = response as string;

			if (loggedUser && loggedUser !== "Guest") {
				isAuthenticated.value = true;
				isOfflineAuth.value = false;
				if (window.xpos) {
					const bootUserInfo = xpos?.boot?.user_info[loggedUser] as any;
					user.value = {
						user: loggedUser,
						user_email: bootUserInfo?.user_email || loggedUser,
						user_fullname: bootUserInfo?.user_fullname || loggedUser,
						image: bootUserInfo?.image || "",
					};
				}
				if (user.value) rememberSession(user.value);
				await loadPermissions(loggedUser);
				return true;
			}

			forgetSession();
			isAuthenticated.value = false;
			user.value = null;
			return false;
		} catch (err) {
			console.error("Auth check failed:", err);
			if (isAuthenticated.value && !isOnline()) {
				return true;
			}
			// A reload with no connection (or no server): start as the cashier the
			// server last confirmed, so selling can go on offline.
			const remembered = (isNetworkError(err) || !isOnline()) && recallSession();
			if (remembered) {
				isAuthenticated.value = true;
				isOfflineAuth.value = true;
				user.value = remembered;
				await loadPermissions(remembered.user);
				return true;
			}
			isAuthenticated.value = false;
			user.value = null;
			return false;
		} finally {
			isLoading.value = false;
		}
	}

	async function checkOfflineAuth(): Promise<boolean> {
		try {
			const lastUser = await window.electronAPI!.db.getSetting("last_logged_user");
			if (!lastUser) return false;

			const posUser = (await window.electronAPI!.db.getPosUser(lastUser)) as Record<
				string,
				unknown
			> | null;
			if (!posUser || posUser.enabled === 0 || posUser.enabled === false) {
				return false;
			}

			isAuthenticated.value = true;
			isOfflineAuth.value = true;
			user.value = {
				user: lastUser,
				user_email: (posUser.email as string) || lastUser,
				user_fullname: (posUser.full_name as string) || lastUser,
			};

			window
				.electronAPI!.startSyncEngine()
				.catch((err) => console.warn("[XPOS] startSyncEngine error:", err));

			await loadPermissions(lastUser);
			return true;
		} catch (err) {
			console.error("Offline auth check failed:", err);
			return false;
		}
	}

	async function login(username: string, password: string): Promise<boolean> {
		try {
			isLoading.value = true;
			error.value = "";

			if (isElectron()) {
				return await loginOffline(username, password);
			}

			await call("login", {
				usr: username,
				pwd: password,
			});

			isAuthenticated.value = true;
			isOfflineAuth.value = false;
			user.value = {
				user: username,
				user_email: username,
			};
			rememberSession(user.value);

			await loadPermissions(username);
			return true;
		} catch (err) {
			console.error("Login failed:", err);
			error.value = friendlyMessage(err, "Invalid login credentials.");
			return false;
		} finally {
			isLoading.value = false;
		}
	}

	async function loginOffline(username: string, password: string): Promise<boolean> {
		try {
			const posUser = await window.electronAPI!.db.getPosUser(username);
			if (!posUser) {
				error.value = "User not found. Check your username.";
				return false;
			}

			const userData = posUser as Record<string, unknown>;
			const db = window.electronAPI!.db;

			// A user pulled from ERPNext has no local password until it has been checked against
			// the server once. A failed local check also goes to the server when online, so a
			// password changed in ERPNext reaches the till.
			const valid = !!userData.password_hash && (await db.verifyPassword(username, password));
			if (!valid) {
				if (!isOnline()) {
					error.value = userData.password_hash
						? "Invalid password"
						: "Sign in once while online to set up this user on this till.";
					return false;
				}
				const result = await db.cachePasswordFromServer(username, password);
				if (!result.success) {
					error.value =
						result.unreachable && !userData.password_hash
							? "Cannot reach the server. Sign in once while online to set up this user on this till."
							: result.unreachable
								? "Invalid password"
								: result.error || "Invalid password";
					return false;
				}
			}

			await completeTillSignIn(userData, username);
			return true;
		} catch (err) {
			console.error("Login failed:", err);
			error.value = friendlyMessage(err, "Could not sign in. Please try again.");
			return false;
		}
	}

	/** Signed in on the till (password or PIN): set the session, start syncing, load rights. */
	async function completeTillSignIn(userData: Record<string, unknown>, username: string): Promise<void> {
		// Records pushed to ERPNext name the user by its Frappe ID (usually the email),
		// not the username typed here.
		const userId = (userData.name as string) || username;
		isAuthenticated.value = true;
		isOfflineAuth.value = true;
		user.value = {
			user: userId,
			user_email: (userData.email as string) || userId,
			user_fullname: (userData.full_name as string) || userId,
		};

		await window.electronAPI!.db.setSetting("last_logged_user", userId, "auth");
		window
			.electronAPI!.startSyncEngine()
			.then((result) => {
				if (!result.success) {
					console.warn("[XPOS] Sync engine start failed:", result.error);
				}
			})
			.catch((err) => {
				console.warn("[XPOS] startSyncEngine error:", err);
			});

		await loadPermissions(userId);
	}

	/**
	 * Sign in on the desktop till with a PIN, checked offline against the hash ERPNext
	 * sends with the POS users (xpos.api.pin). Five wrong PINs lock the cashier out
	 * for five minutes; a password still works then.
	 */
	async function loginWithPin(username: string, pin: string): Promise<boolean> {
		error.value = "";
		if (!isElectron()) {
			error.value = "PIN sign-in is only available on the desktop till.";
			return false;
		}
		try {
			isLoading.value = true;
			const db = window.electronAPI!.db;
			const result = await db.verifyPin(username, pin);
			if (!result.ok) {
				error.value = pinErrorMessage(result);
				return false;
			}
			const userData = (await db.getPosUser(username)) as Record<string, unknown> | null;
			if (!userData) {
				error.value = "User not found. Check your username.";
				return false;
			}
			await completeTillSignIn(userData, username);
			return true;
		} catch (err) {
			console.error("PIN sign-in failed:", err);
			error.value = friendlyMessage(err, "Could not sign in. Please try again.");
			return false;
		} finally {
			isLoading.value = false;
		}
	}

	async function sendResetPasswordEmail(email: string): Promise<boolean> {
		try {
			isLoading.value = true;
			error.value = "";
			resetEmailSent.value = false;

			await call("frappe.core.doctype.user.user.reset_password", { user: email });

			resetEmailSent.value = true;
			return true;
		} catch (err) {
			console.error("Reset password failed:", err);
			error.value = friendlyMessage(err, "Failed to send reset email.");
			return false;
		} finally {
			isLoading.value = false;
		}
	}

	async function logout(): Promise<void> {
		forgetSession();
		try {
			isLoading.value = true;

			if (!isOfflineAuth.value) {
				await call("logout");
			}

			isAuthenticated.value = false;
			isOfflineAuth.value = false;
			user.value = null;
			resetPermissions();

			if (isElectron()) {
				try {
					await window.electronAPI!.db.setSetting("last_logged_user", "", "auth");
				} catch {
					/* ignore */
				}
				window.location.hash = "#/login";
				window.location.reload();
			} else {
				window.location.href = "/xpos/login";
			}
		} catch (err) {
			console.error("Logout failed:", err);
		} finally {
			isLoading.value = false;
		}
	}

	function clearError(): void {
		error.value = "";
	}

	function $reset(): void {
		isLoading.value = false;
		isAuthenticated.value = false;
		isOfflineAuth.value = false;
		user.value = null;
		error.value = "";
		resetEmailSent.value = false;
		resetPermissions();
	}

	return {
		isLoading,
		isAuthenticated,
		isOfflineAuth,
		user,
		error,
		resetEmailSent,
		userName,
		userEmail,
		userFullName,
		isGuest,
		isSystemManager,
		canManagePermissions,
		checkAuth,
		login,
		loginWithPin,
		sendResetPasswordEmail,
		logout,
		clearError,
		$reset,
	};
});
