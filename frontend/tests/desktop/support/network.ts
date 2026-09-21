/**
 * The till's line to ERPNext, switchable: a local port that relays to the site while
 * online, and fails the way real networks fail while not.
 *
 *   - "refuse": nothing answers (the server or the shop's router is down). Fails fast.
 *   - "hang": connections are taken and never answered (a dead Wi-Fi link, a captive
 *     portal). Every request waits for its own timeout: the case that finds spinners
 *     that never stop and sales stuck in "syncing".
 *
 * Going offline also cuts every connection already open, so a request in flight fails
 * half way, as it would when the cable is pulled.
 */
import { connect, createServer, type Server, type Socket } from "net";
import { freePort } from "./till";

export type Outage = "refuse" | "hang";

export interface ServerLine {
	/** Give the till this URL instead of the site's. */
	url: string;
	online: () => Promise<void>;
	offline: (how?: Outage) => Promise<void>;
	state: () => "online" | Outage;
	close: () => Promise<void>;
}

export async function serverLine(siteUrl: string): Promise<ServerLine> {
	const target = new URL(siteUrl);
	const targetPort = Number(target.port || (target.protocol === "https:" ? 443 : 80));
	const port = await freePort();
	const open = new Set<Socket>();
	let mode: "online" | Outage = "online";
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
			if (!server) await listen();
		},
		offline: async (how: Outage = "refuse") => {
			mode = how;
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
