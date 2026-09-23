/**
 * K43: the till signs each paid sale at payment and numbers it, so ERPNext sees a sale
 * changed or deleted in the till's database before it synced. The string signed must be
 * the one ERPNext builds: both sides read the same fixture.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => os.tmpdir() },
	safeStorage: {
		isEncryptionAvailable: () => true,
		encryptString: (s: string) => Buffer.from(`sealed:${s}`),
		decryptString: (b: Buffer) => b.toString().replace(/^sealed:/, ""),
	},
}));
const db = vi.hoisted(() => ({
	rows: [] as Array<{ id: number; local_id: string; data: string }>,
	updates: [] as unknown[][],
}));
vi.mock("../electron/database/dbService", () => ({
	query: async () => db.rows,
	execute: async (_sql: string, params: unknown[]) => {
		db.updates.push(params);
	},
}));

import { canonicalSale, keyIdOf, signSaleWith } from "../electron/security/saleSignature";
import { prepareTillKey, setTillKeyDir, signSale } from "../electron/security/tillKey";

const fixture = JSON.parse(
	fs.readFileSync(
		path.join(__dirname, "../../xpos/api/tests/fixtures/sale_signature_vectors.json"),
		"utf-8",
	),
);
const fixedKey = crypto.createPrivateKey({
	key: Buffer.from(fixture.private_key_pkcs8_hex, "hex"),
	format: "der",
	type: "pkcs8",
});

describe("what the till signs", () => {
	for (const c of fixture.cases) {
		it(`builds ERPNext's string for: ${c.name}`, () => {
			expect(canonicalSale(c.sale, c.local_id, c.sequence)).toBe(c.canonical);
		});
		it(`signs it as ERPNext expects: ${c.name}`, () => {
			const signed = signSaleWith(fixedKey, fixture.public_key, c.sale, c.local_id, c.sequence);
			expect(signed.sig).toBe(c.signature);
			expect(signed.key_id).toBe(keyIdOf(fixture.public_key));
			expect(signed.public_key).toBe(fixture.public_key);
		});
	}

	it("changes with a line taken out, a quantity or a payment", () => {
		const { sale, local_id, sequence } = fixture.cases[0];
		const base = canonicalSale(sale, local_id, sequence);
		expect(canonicalSale({ ...sale, items: sale.items.slice(1) }, local_id, sequence)).not.toBe(base);
		expect(
			canonicalSale(
				{ ...sale, items: [{ ...sale.items[0], qty: 1 }, sale.items[1]] },
				local_id,
				sequence,
			),
		).not.toBe(base);
		expect(
			canonicalSale(
				{ ...sale, payments: [{ mode_of_payment: "Cash", amount: 4000 }] },
				local_id,
				sequence,
			),
		).not.toBe(base);
		expect(canonicalSale(sale, local_id, sequence + 1)).not.toBe(base);
	});

	it("does not change with what ERPNext does not book from the till: names, the receipt", () => {
		const { sale, local_id, sequence } = fixture.cases[0];
		expect(
			canonicalSale({ ...sale, customer_name: "Someone", receipt: { lines: [] } }, local_id, sequence),
		).toBe(canonicalSale(sale, local_id, sequence));
	});
});

describe("the till's key and sale numbers", () => {
	let folder: string;
	beforeEach(() => {
		folder = fs.mkdtempSync(path.join(os.tmpdir(), "till-key-"));
		setTillKeyDir(folder);
		db.rows = [];
		db.updates = [];
	});
	afterEach(() => {
		setTillKeyDir(null);
		fs.rmSync(folder, { recursive: true, force: true });
	});

	const verify = (sale: Record<string, unknown>, localId: string) => {
		const sig = sale.xpos_signature as { public_key: string; seq: number; sig: string };
		const publicKey = crypto.createPublicKey({
			key: { kty: "OKP", crv: "Ed25519", x: sig.public_key },
			format: "jwk",
		});
		return crypto.verify(
			null,
			Buffer.from(canonicalSale(sale, localId, sig.seq)),
			publicKey,
			Buffer.from(sig.sig, "base64"),
		);
	};

	it("signs paid sales with numbers one after another, and not held orders", () => {
		const first = signSale({ items: [{ item_code: "A", qty: 1, rate: 5 }] }, "inv_1");
		const held = signSale({ items: [], is_draft: true }, "inv_2");
		const second = signSale({ items: [{ item_code: "B", qty: 1, rate: 5 }] }, "inv_3");
		expect((first.xpos_signature as { seq: number }).seq).toBe(1);
		expect(held.xpos_signature).toBeUndefined();
		expect((second.xpos_signature as { seq: number }).seq).toBe(2);
		expect(verify(first, "inv_1")).toBe(true);
		expect(verify({ ...first, items: [{ item_code: "A", qty: 1, rate: 1 }] }, "inv_1")).toBe(false);
	});

	it("keeps the private key sealed by the OS, and the numbering across restarts", () => {
		signSale({ items: [] }, "inv_1");
		const stored = JSON.parse(fs.readFileSync(path.join(folder, "till-signing-key.json"), "utf-8"));
		expect(stored.private_key.startsWith("enc:v1:")).toBe(true);
		expect(stored.private_key).not.toContain("PRIVATE KEY");
		setTillKeyDir(folder); // as after a restart
		expect((signSale({ items: [] }, "inv_2").xpos_signature as { seq: number }).seq).toBe(2);
	});

	it("re-signs a sale the hub receives again under its first number", () => {
		signSale({ items: [] }, "inv_1");
		const again = signSale({ items: [] }, "inv_1", 1);
		expect((again.xpos_signature as { seq: number }).seq).toBe(1);
		expect((signSale({ items: [] }, "inv_2").xpos_signature as { seq: number }).seq).toBe(2);
	});

	it("signs the paid sales already waiting when the key is first made, once", async () => {
		db.rows = [
			{ id: 1, local_id: "inv_a", data: JSON.stringify({ items: [{ item_code: "A", qty: 1 }] }) },
			{ id: 2, local_id: "inv_b", data: JSON.stringify({ items: [], is_draft: true }) },
		];
		await prepareTillKey();
		expect(db.updates).toHaveLength(1);
		const [data, id] = db.updates[0] as [string, number];
		expect(id).toBe(1);
		expect(verify(JSON.parse(data), "inv_a")).toBe(true);

		db.updates = [];
		setTillKeyDir(folder); // the next start: the key exists
		await prepareTillKey();
		expect(db.updates).toHaveLength(0);
	});
});
