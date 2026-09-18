/**
 * Sales made offline wait in the browser's IndexedDB until they sync. By
 * default that storage is "best effort": the browser may delete it to free
 * disk space. Ask for it to be kept. Browsers usually grant this to an
 * installed PWA; the result is logged so a refusal can be seen.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
	if (!storage?.persist) return false;
	try {
		if (await storage.persisted?.()) return true;
		const granted = await storage.persist();
		if (!granted)
			console.warn("[XPOS] Browser did not grant persistent storage; offline sales may be evicted");
		return granted;
	} catch (err) {
		console.warn("[XPOS] Persistent storage request failed:", err);
		return false;
	}
}
