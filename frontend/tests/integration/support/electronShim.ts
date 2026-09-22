/**
 * Stand-in for the `electron` module, so main-process code (sync engine, local
 * database, IPC handlers) runs under plain Node in integration tests.
 *
 * Only what that code touches is here. `net.request` goes out over Node's
 * http, so requests reach a real (or fake) Frappe server; `net.isOnline` is
 * switchable; IPC handlers land in a registry tests can invoke; messages to
 * the renderer are recorded.
 */
import { EventEmitter } from "events";
import http from "http";
import https from "https";
import os from "os";
import path from "path";

// --- connectivity -----------------------------------------------------------

let online = true;

/** Simulate the till losing or regaining its connection. */
export function setOnline(value: boolean): void {
	online = value;
}

class ShimResponse extends EventEmitter {
	constructor(public statusCode: number) {
		super();
	}
}

class ShimRequest extends EventEmitter {
	private headers: Record<string, string> = {};
	private chunks: string[] = [];
	private req: http.ClientRequest | null = null;

	constructor(private options: { method?: string; url: string }) {
		super();
	}

	setHeader(name: string, value: string): void {
		this.headers[name] = value;
	}

	write(chunk: string): void {
		this.chunks.push(chunk);
	}

	end(): void {
		const url = new URL(this.options.url);
		const client = url.protocol === "https:" ? https : http;
		const req = client.request(
			url,
			{ method: this.options.method || "GET", headers: this.headers },
			(res) => {
				const response = new ShimResponse(res.statusCode || 0);
				this.emit("response", response);
				res.on("data", (chunk: Buffer) => response.emit("data", chunk));
				res.on("end", () => response.emit("end"));
				// As Electron's: an answer cut short is an error on the response.
				res.on("aborted", () =>
					response.emit("error", new Error("net::ERR_CONTENT_LENGTH_MISMATCH")),
				);
			},
		);
		req.on("error", (err) => this.emit("error", err));
		for (const chunk of this.chunks) req.write(chunk);
		req.end();
		this.req = req;
	}

	/** As Electron's: stop the request; emits "abort", not "error". */
	abort(): void {
		this.req?.destroy();
		this.emit("abort");
	}
}

export const net = {
	isOnline: () => online,
	request: (options: { method?: string; url: string }) => new ShimRequest(options),
};

// --- app --------------------------------------------------------------------

const userData = path.join(os.tmpdir(), `xpos-integration-${process.pid}`);

/** What the app asked of the OS at startup, for startup tests. */
export const startup = {
	loginItem: null as null | { openAtLogin: boolean },
	/** Whether this launch gets the single-instance lock (false = another copy runs). */
	lockAvailable: true,
	listeners: {} as Record<string, (...args: unknown[]) => void>,
};

export const app = {
	getPath: (_name: string) => userData,
	isPackaged: false,
	getVersion: () => "0.0.0-test",
	setLoginItemSettings: (settings: { openAtLogin: boolean }) => {
		startup.loginItem = { openAtLogin: settings.openAtLogin };
	},
	requestSingleInstanceLock: () => startup.lockAvailable,
	on: (event: string, listener: (...args: unknown[]) => void) => {
		startup.listeners[event] = listener;
	},
};

export const safeStorage = {
	isEncryptionAvailable: () => false,
	encryptString: (plain: string) => Buffer.from(plain),
	decryptString: (buf: Buffer) => buf.toString(),
};

type BeforeSendHeaders = (
	details: { url: string; method: string; requestHeaders: Record<string, string> },
	callback: (response: { requestHeaders?: Record<string, string>; cancel?: boolean }) => void,
) => void;

/** The listeners main-process code installed on the default session. */
export const webRequest = {
	beforeSendHeaders: null as BeforeSendHeaders | null,
};

export const session = {
	defaultSession: {
		webRequest: {
			onBeforeSendHeaders: (listener: BeforeSendHeaders) => {
				webRequest.beforeSendHeaders = listener;
			},
			onHeadersReceived: () => undefined,
		},
	},
};

// --- IPC --------------------------------------------------------------------

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

export const ipcMain = {
	// Electron throws on a second handle() for one channel; tests re-initialise
	// modules, so the latest registration wins instead.
	handle: (channel: string, handler: Handler) => {
		handlers.set(channel, handler);
	},
	removeHandler: (channel: string) => {
		handlers.delete(channel);
	},
	on: () => undefined,
};

/** Call an IPC handler the way the renderer's `ipcRenderer.invoke` would. */
export async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
	const handler = handlers.get(channel);
	if (!handler) throw new Error(`No IPC handler registered for ${channel}`);
	return (await handler({}, ...args)) as T;
}

// --- preload ----------------------------------------------------------------
// Importing electron/preload.ts puts window.electronAPI in place, so renderer code (stores,
// dbBridge) runs against the real IPC handlers and database. Arguments are structured-cloned
// on the way, as Electron does: a live Vue object throws here as it does in the app.

export const contextBridge = {
	exposeInMainWorld: (key: string, api: unknown) => {
		const g = globalThis as { window?: Record<string, unknown> };
		g.window ??= {};
		g.window[key] = api;
	},
};

export const ipcRenderer = {
	invoke: async (channel: string, ...args: unknown[]) => invoke(channel, ...structuredClone(args)),
	on: () => ipcRenderer,
	removeListener: () => ipcRenderer,
};

// --- renderer ---------------------------------------------------------------

export const rendererEvents: { channel: string; data: unknown }[] = [];

/** Printers the fake OS reports, and every print job sent, for print tests. */
export const printing = {
	printers: [] as { name: string; displayName: string }[],
	jobs: [] as { options: Record<string, unknown>; url: string }[],
	/** Make the next print fail with this reason, as Chromium does for an unknown printer. */
	failWith: null as string | null,
};

class ShimWebContents {
	url = "";
	constructor(private events: { channel: string; data: unknown }[] | null) {}
	send(channel: string, data: unknown): void {
		this.events?.push({ channel, data });
	}
	async getPrintersAsync() {
		return printing.printers;
	}
	print(options: Record<string, unknown>, callback: (success: boolean, reason: string) => void): void {
		const device = options.deviceName as string | undefined;
		const known = !device || printing.printers.some((p) => p.name === device);
		const reason = printing.failWith ?? (known ? "" : "Invalid deviceName provided");
		if (!reason) printing.jobs.push({ options, url: this.url });
		setTimeout(() => callback(!reason, reason), 0);
	}
}

class ShimBrowserWindow {
	webContents: ShimWebContents;
	private destroyed = false;
	constructor(
		public options: Record<string, unknown> = {},
		events: { channel: string; data: unknown }[] | null = null,
	) {
		this.webContents = new ShimWebContents(events);
	}
	async loadURL(url: string): Promise<void> {
		this.webContents.url = url;
	}
	close(): void {
		this.destroyed = true;
	}
	isDestroyed(): boolean {
		return this.destroyed;
	}
	static getAllWindows(): ShimBrowserWindow[] {
		return [mainWindow];
	}
	static getFocusedWindow(): ShimBrowserWindow {
		return mainWindow;
	}
}

const mainWindow = new ShimBrowserWindow({}, rendererEvents);

export const BrowserWindow = ShimBrowserWindow;

export default { app, net, ipcMain, safeStorage, session, BrowserWindow };
