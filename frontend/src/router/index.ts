import {
	createRouter,
	createWebHistory,
	createWebHashHistory,
	type Router,
	type RouteRecordRaw,
} from "vue-router";
import { useAuthStore } from "@/stores/authStore";
import { isElectron } from "@/services/electronBridge";
import routes from "./routes";
import { checkSetupState, setupRedirect } from "./setupGuard";
import { usePosStore } from "@/stores/posStore";
import { openScreen, screenOfRoute } from "@/services/screenAccess";

const history = isElectron() ? createWebHashHistory() : createWebHistory("/xpos");

export const router: Router = createRouter({
	history,
	routes,
});

router.beforeEach(async (to, from, next) => {
	const redirect = setupRedirect(await checkSetupState(), to);
	if (redirect) {
		next({ name: redirect });
		return;
	}
	if (redirect === "") {
		next();
		return;
	}

	const authStore = useAuthStore();
	const posStore = usePosStore();

	if (!authStore.isAuthenticated && !authStore.isLoading) {
		await authStore.checkAuth();
	}

	const requiresAuth = to.meta.requiresAuth !== false;
	const isAuthPage = to.meta.isAuthPage === true;

	if (requiresAuth && !authStore.isAuthenticated) {
		next({
			name: "login",
			query: { redirect: to.fullPath },
		});
		return;
	}

	if (isAuthPage && authStore.isAuthenticated) {
		next({ name: "pos" });
		return;
	}

	if (to.name === "settings" && !isElectron()) {
		next({ name: "pos" });
		return;
	}
	if (to.name === "cashier" && (!posStore.enableCashierSettlement || !posStore.isCashier)) {
		next({ name: "pos" });
		return;
	}
	if (to.meta.requiresAdmin === true && (isElectron() || !authStore.canManagePermissions)) {
		next({ name: "pos" });
		return;
	}

	// K27: a screen the cashier's role lacks is hidden, or opens with a manager's PIN.
	// Moving within a screen (a report from the catalog, an invoice from its list) asks once.
	const screen = screenOfRoute(to.name);
	if (screen && screen !== screenOfRoute(from.name) && !(await openScreen(screen))) {
		if (from.matched.length) next(false);
		else next({ name: "pos" });
		return;
	}

	if (to.meta.title) {
		document.title = `${to.meta.title} | X POS`;
	}

	next();
});
