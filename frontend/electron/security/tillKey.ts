/**
 * The till's signing key and sale numbers (K43).
 *
 * The key is made on the till the first time it is needed and never leaves it: its
 * private half is kept encrypted by the OS (`secureStore`, DPAPI on Windows). Each
 * signed sale carries the public half, and ERPNext keeps the first one it sees for the
 * till's API user. Each paid sale gets the next number, so a sale deleted before it
 * synced leaves a gap ERPNext can see.
 *
 * Signing never stops a sale: if the key cannot be read or written the sale is kept
 * unsigned, logged, and ERPNext flags it when it arrives.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { app } from "electron";
import { decryptSecret, encryptSecret, isEncrypted } from "../database/secureStore";
import { execute, query } from "../database/dbService";
import { createLogger } from "../logger";
import { needsSignature, publicKeyText, signSaleWith } from "./saleSignature";

const log = createLogger("TillKey");

const FILE = "till-signing-key.json";

interface KeyFile {
	public_key: string;
	private_key: string;
	next_seq: number;
}

let dir: string | null = null;
let cached: { file: KeyFile; privateKey: crypto.KeyObject } | null = null;

/** Tests point this at a folder of their own. */
export function setTillKeyDir(folder: string | null): void {
	dir = folder;
	cached = null;
}

function filePath(): string {
	return path.join(dir ?? app.getPath("userData"), FILE);
}

function write(file: KeyFile): void {
	const target = filePath();
	const temp = `${target}.tmp`;
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(temp, JSON.stringify(file, null, 2), { encoding: "utf-8", mode: 0o600 });
	fs.renameSync(temp, target);
}

function load(): { file: KeyFile; privateKey: crypto.KeyObject; created: boolean } {
	if (cached) return { ...cached, created: false };
	let created = false;
	let file: KeyFile;
	if (fs.existsSync(filePath())) {
		file = JSON.parse(fs.readFileSync(filePath(), "utf-8")) as KeyFile;
	} else {
		const pair = crypto.generateKeyPairSync("ed25519");
		const pem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
		const stored = encryptSecret(pem);
		if (!isEncrypted(stored)) {
			log.warn("The OS secure store is not available: the signing key is kept unencrypted");
		}
		file = { public_key: publicKeyText(pair.publicKey), private_key: stored, next_seq: 1 };
		write(file);
		created = true;
		log.info("Made this till's signing key");
	}
	const pem = decryptSecret(file.private_key);
	if (!pem) throw new Error("The till's signing key cannot be read");
	cached = { file, privateKey: crypto.createPrivateKey(pem) };
	return { ...cached, created };
}

/**
 * The sale as it is stored: signed and numbered if it is paid. `sequence` re-signs a
 * sale that already has a number (the hub receiving it again) without using a new one.
 */
export function signSale(
	sale: Record<string, unknown>,
	localId: string,
	sequence?: number,
): Record<string, unknown> {
	if (!needsSignature(sale)) return sale;
	try {
		const { file, privateKey } = load();
		let seq = sequence;
		if (!seq) {
			seq = file.next_seq;
			// The number is spent before the sale is stored: a crash leaves a gap, never a repeat.
			file.next_seq = seq + 1;
			write(file);
		}
		const signature = signSaleWith(privateKey, file.public_key, sale, localId, seq, os.hostname());
		return { ...sale, xpos_signature: signature };
	} catch (err) {
		log.error("Could not sign a sale; it is kept unsigned and ERPNext will flag it", err);
		return sale;
	}
}

/**
 * At start: make the key if there is none, and if it was just made (a till updated to
 * signing), sign the paid sales already waiting, once. Never again: re-signing a
 * waiting sale would bless whatever was changed in it.
 */
export async function prepareTillKey(): Promise<void> {
	let created: boolean;
	try {
		created = load().created;
	} catch (err) {
		log.error("The till's signing key is not available; sales will be kept unsigned", err);
		return;
	}
	if (!created) return;
	const waiting = await query<{ id: number; local_id: string; data: string }>(
		"SELECT `id`, `local_id`, `data` FROM `pending_invoices` WHERE `status` IN ('pending','failed')",
	);
	let signed = 0;
	for (const row of waiting) {
		const sale = typeof row.data === "string" ? JSON.parse(row.data || "{}") : row.data || {};
		if (!needsSignature(sale) || sale.xpos_signature) continue;
		await execute("UPDATE `pending_invoices` SET `data` = ? WHERE `id` = ?", [
			JSON.stringify(signSale(sale, row.local_id)),
			row.id,
		]);
		signed++;
	}
	if (signed) log.info(`Signed ${signed} sale(s) already waiting when the key was made`);
}
