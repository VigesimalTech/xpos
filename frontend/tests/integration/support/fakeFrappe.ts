/**
 * A minimal Frappe server for sync tests: answers `/api/method/<name>` and
 * records every call. Pulls get empty lists unless a test says otherwise;
 * pushes get a generated document name. A handler can throw a FrappeError to
 * answer the way Frappe does when it rejects a document.
 */
import http from "http";
import type { AddressInfo } from "net";

export interface FrappeCall {
	method: string;
	httpMethod: string;
	args: Record<string, unknown>;
}

export class FrappeError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

type Handler = (args: Record<string, unknown>) => unknown;

export class FakeFrappe {
	calls: FrappeCall[] = [];
	private handlers = new Map<string, Handler>();
	private server: http.Server | null = null;
	private counter = 0;

	/** Answer `method` with the handler's return value (sent as `message`). */
	on(method: string, handler: Handler): void {
		this.handlers.set(method, handler);
	}

	reset(): void {
		this.calls = [];
		this.handlers.clear();
	}

	callsTo(method: string): FrappeCall[] {
		return this.calls.filter((c) => c.method === method);
	}

	async start(): Promise<string> {
		this.server = http.createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => this.respond(req, body, res));
		});
		await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
		const { port } = this.server.address() as AddressInfo;
		return `http://127.0.0.1:${port}`;
	}

	async stop(): Promise<void> {
		await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
	}

	private respond(req: http.IncomingMessage, body: string, res: http.ServerResponse): void {
		const url = new URL(req.url || "/", "http://localhost");
		const method = url.pathname.replace(/^\/api\/method\//, "");
		const args: Record<string, unknown> = body ? JSON.parse(body) : Object.fromEntries(url.searchParams);
		const httpMethod = req.method || "GET";
		this.calls.push({ method, httpMethod, args });

		const send = (status: number, payload: unknown) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(payload));
		};

		const handler = this.handlers.get(method);
		try {
			if (handler) return send(200, { message: handler(args) });
			if (httpMethod === "POST") return send(200, { message: { name: `SRV-${++this.counter}` } });
			return send(200, { message: [] });
		} catch (err) {
			if (err instanceof FrappeError) {
				// Frappe's shape: the human reason is in _server_messages, not message.
				return send(err.status, {
					exc_type: "ValidationError",
					_server_messages: JSON.stringify([JSON.stringify({ message: err.message })]),
				});
			}
			return send(500, { exception: String(err) });
		}
	}
}
