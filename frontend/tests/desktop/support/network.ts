/**
 * The till's line to ERPNext, switchable: a local port that relays to the site while
 * online, and fails the way real networks fail while not.
 *
 *   - "refuse": nothing answers (the server or the shop's router is down). Fails fast.
 *   - "hang": connections are taken and never answered (a dead Wi-Fi link, a captive
 *     portal). Every request waits for its own timeout: the case that finds spinners
 *     that never stop and sales stuck in "syncing".
 *   - "lose-replies": requests reach ERPNext and are acted on, but the answers never come
 *     back (the link drops on the way back). The till cannot tell a sale that failed from
 *     one that landed: the case that finds sales sent twice.
 *
 * Going offline also cuts every connection already open, so a request in flight fails
 * half way, as it would when the cable is pulled.
 */
import { connect, createServer, type Server, type Socket } from "net";
import { freePort } from "./till";

export type Outage = "refuse" | "hang" | "lose-replies";

export interface ServerLine {
	/** Give the till this URL instead of the site's. */
	url: string;
	online: () => Promise<void>;
	/** `only`: with "lose-replies", lose only the answers to requests whose first bytes
	 *  match (e.g. /create_invoice/), so everything else still works. */
	offline: (how?: Outage, only?: RegExp) => Promise<void>;
	state: () => "online" | Outage;
	close: () => Promise<void>;
}

export async function serverLine(siteUrl: string, fixedPort?: number): Promise<ServerLine> {
	const target = new URL(siteUrl);
	const targetPort = Number(target.port || (target.protocol === "https:" ? 443 : 80));
	// A till keeps the URL it was set up with: reopening one needs the same port.
	const port = fixedPort || (await freePort());
	const open = new Set<Socket>();
	let mode: "online" | Outage = "online";
	let only: RegExp | null = null;
	let server: Server | null = null;

	const track = (s: Socket) => {
		open.add(s);
		s.on("error", () => undefined);
		s.on("close", () => open.delete(s));
	};

	const listen = () =>
		new Promise<void>((done) => {
			server = createServer((client) => {
				track(client);
				if (mode === "hang") return; // take it, say nothing
				const upstream = connect(targetPort, target.hostname);
				track(upstream);
				if (mode === "lose-replies") {
					// Decide on the request's first bytes (method and path) whether to lose the answer.
					client.once("data", (first: Buffer) => {
						upstream.write(first);
						client.pipe(upstream); // the server gets it and acts on it
						if (!only || only.test(first.toString("latin1")))
							upstream.on("data", () => undefined);
						else upstream.pipe(client);
					});
					return;
				}
				client.pipe(upstream).pipe(client);
			});
			server.listen(port, "127.0.0.1", () => done());
		});

	const unlisten = () =>
		new Promise<void>((done) => {
			if (!server) return done();
			server.close(() => done());
			server = null;
		});

	const cutAll = () => {
		for (const s of open) s.destroy();
	};

	await listen();
	return {
		url: `${target.protocol}//127.0.0.1:${port}`,
		state: () => mode,
		online: async () => {
			cutAll();
			mode = "online";
			only = null;
			if (!server) await listen();
		},
		offline: async (how: Outage = "refuse", match?: RegExp) => {
			mode = how;
			only = match ?? null;
			cutAll();
			if (how === "refuse") await unlisten();
			else if (!server) await listen();
		},
		close: async () => {
			cutAll();
			await unlisten();
		},
	};
}
