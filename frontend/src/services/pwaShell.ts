/**
 * Put the POS page in the service worker's cache on the first visit.
 *
 * The page that registers the worker was loaded before the worker existed, so
 * that load was never cached, and the app would not open offline until it had
 * been opened online a second time. Once the worker controls the page, fetch
 * the page again through it; its network-first rule stores the response.
 */
export async function warmAppShell(sw: ServiceWorkerContainer): Promise<void> {
	if (!sw.controller) {
		await new Promise<void>((resolve) =>
			sw.addEventListener("controllerchange", () => resolve(), { once: true }),
		);
	}
	try {
		await fetch("/xpos", { credentials: "same-origin" });
	} catch {
		/* offline: it is cached on the next online visit */
	}
}
