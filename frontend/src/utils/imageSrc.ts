import { getApiBaseUrlSync, isElectron } from "@/services/electronBridge";

/**
 * The URL to load an ERPNext file from (item and customer images, the
 * company logo). ERPNext stores paths relative to its own site. The web POS
 * is served from that site, so they work as they are; the desktop app is
 * not, so there they are pointed at the ERPNext server. The main process
 * adds the API key to those requests (electron/serverFiles.ts).
 */
export function imageSrc(path: string | null | undefined): string {
	if (!path) return "";
	if (!isElectron() || !path.startsWith("/")) return path;
	const server = getApiBaseUrlSync().replace(/\/+$/, "");
	return server ? `${server}${path}` : path;
}
