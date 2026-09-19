/**
 * Lets the desktop app show ERPNext files: item and customer images, and the
 * company logo on printed receipts.
 *
 * Files under /private/files need the viewer signed in. The web POS has a
 * session cookie; the desktop app is signed in with its API key, which an
 * <img> tag cannot send. So requests for files on the ERPNext server get the
 * key added here, in the main process, for every window (receipts print
 * from a hidden one). Nothing else is touched: other sites never see the key,
 * and API calls already carry their own credentials.
 */
import { session } from "electron";
import { getMeta } from "./database/dbService";
import { createLogger } from "./logger";

const log = createLogger("ServerFiles");

const FILE_PATH = /^\/(private\/)?files\//;

interface FileAuth {
	origins: string[];
	token: string | null;
}

function originOf(url: string | null | undefined): string | null {
	try {
		return url ? new URL(url).origin : null;
	} catch {
		return null;
	}
}

/** Read fresh each time: three local lookups per image, and never a stale key. */
async function fileAuth(): Promise<FileAuth> {
	const [serverUrl, key, secret] = await Promise.all([
		getMeta("server_url"),
		getMeta("api_key"),
		getMeta("api_secret"),
	]);
	const origins = [originOf(serverUrl), originOf(process.env.XPOS_SERVER_URL)].filter(
		(o): o is string => !!o,
	);
	return { origins, token: key && secret ? `token ${key}:${secret}` : null };
}

function hasAuthorization(headers: Record<string, string>): boolean {
	return Object.keys(headers).some((h) => h.toLowerCase() === "authorization");
}

export function installServerFileAuth(): void {
	session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
		let url: URL;
		try {
			url = new URL(details.url);
		} catch {
			callback({ requestHeaders: details.requestHeaders });
			return;
		}
		if (!FILE_PATH.test(url.pathname) || hasAuthorization(details.requestHeaders)) {
			callback({ requestHeaders: details.requestHeaders });
			return;
		}
		fileAuth()
			.then(({ origins, token }) => {
				const headers = { ...details.requestHeaders };
				if (token && origins.includes(url.origin)) headers.Authorization = token;
				callback({ requestHeaders: headers });
			})
			.catch((err) => {
				log.warn("Could not read API credentials for a file request", err);
				callback({ requestHeaders: details.requestHeaders });
			});
	});
}
