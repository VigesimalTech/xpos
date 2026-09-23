/**
 * Signed sales (K43): what the till signs at payment, so that ERPNext sees a sale
 * changed in the till's database before it synced.
 *
 * `canonicalSale` must build exactly the string ERPNext builds
 * (`xpos/api/sale_signature.py` `canonical_sale`): both are tested against
 * `xpos/api/tests/fixtures/sale_signature_vectors.json`. Change one, change both, and
 * raise VERSION.
 *
 * No Electron here: the key and the numbering live in `tillKey.ts`.
 */
import crypto from "crypto";

export const VERSION = 1;

const HEADER_TEXT = [
	"pos_profile",
	"xpos_cashier",
	"xpos_approved_by",
	"return_against",
	"currency",
	"pos_delivery_charges",
];
const HEADER_NUMBERS = [
	"is_return",
	"additional_discount_percentage",
	"discount_amount",
	"loyalty_points",
	"redeem_loyalty_points",
	"write_off_amount",
	"change_amount",
	"pos_delivery_charges_rate",
	"conversion_rate",
	"is_credit_sale",
];
const ITEM_TEXT = ["item_code", "uom", "serial_no", "batch_no"];
const ITEM_NUMBERS = ["qty", "rate", "discount_percentage", "discount_amount", "is_free_item"];
const PAYMENT_TEXT = ["mode_of_payment"];
const PAYMENT_NUMBERS = ["amount"];

type Sale = Record<string, unknown>;

export interface SaleSignature {
	v: number;
	key_id: string;
	seq: number;
	sig: string;
	/** Not signed: ERPNext keeps the first key a till's sales carry, and checks against it. */
	public_key: string;
	device?: string;
}

/** A number as millionths, rounded half up: the same integer in JavaScript and Python. */
function asNumber(value: unknown): number {
	if (value !== null && typeof value === "object") return 0;
	const n = Number(value ?? 0);
	if (!Number.isFinite(n)) return 0;
	return Math.floor(n * 1_000_000 + 0.5);
}

function asText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function row(source: Sale, texts: string[], numbers: string[]): Array<string | number> {
	return [...texts.map((k) => asText(source[k])), ...numbers.map((k) => asNumber(source[k]))];
}

function rows(sale: Sale, key: string, texts: string[], numbers: string[]) {
	const list = Array.isArray(sale[key]) ? (sale[key] as Sale[]) : [];
	return list.map((r) => row(r || {}, texts, numbers));
}

/** What the till signs: the parts of a sale that decide what it is worth. */
export function canonicalSale(sale: Sale, localId: string, sequence: number): string {
	return JSON.stringify([
		VERSION,
		asText(localId),
		Math.trunc(sequence),
		row(sale, HEADER_TEXT, HEADER_NUMBERS),
		rows(sale, "items", ITEM_TEXT, ITEM_NUMBERS),
		rows(sale, "payments", PAYMENT_TEXT, PAYMENT_NUMBERS),
		rows(sale, "pos_change_legs", PAYMENT_TEXT, PAYMENT_NUMBERS),
	]);
}

/** The public key as ERPNext takes it: the raw 32 bytes, base64url. */
export function publicKeyText(key: crypto.KeyObject): string {
	return String(key.export({ format: "jwk" }).x);
}

/** A short name for a public key, the same as ERPNext's `key_id_of`. */
export function keyIdOf(publicKey: string): string {
	return crypto.createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex").slice(0, 16);
}

export function signSaleWith(
	privateKey: crypto.KeyObject,
	publicKey: string,
	sale: Sale,
	localId: string,
	sequence: number,
	device?: string,
): SaleSignature {
	const sig = crypto.sign(null, Buffer.from(canonicalSale(sale, localId, sequence), "utf8"), privateKey);
	return {
		v: VERSION,
		key_id: keyIdOf(publicKey),
		seq: sequence,
		sig: sig.toString("base64"),
		public_key: publicKey,
		...(device ? { device } : {}),
	};
}

/** A paid sale is signed; a held order is not a sale yet. */
export function needsSignature(sale: Sale): boolean {
	return !sale.is_draft;
}
