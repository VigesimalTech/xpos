import { watch } from "vue";
import { useCartStore } from "@/stores/cartStore";

/**
 * Keeps the sale being rung up across a reload. The cart lives only in memory,
 * so a refresh, a crash or the till being switched off lost it; this saves it
 * to localStorage as it changes and brings it back when the POS opens again.
 *
 * A draft is only restored for the cashier who made it and on the day it was
 * made (prices, offers and the posting date move on overnight), and it is
 * removed as soon as the cart is empty: a completed or cleared sale never
 * comes back. Payments are not kept; the payment dialog starts afresh.
 */
const KEY = "xpos_cart_draft_v1";

const FIELDS = [
	"items",
	"customer",
	"discountPercentage",
	"discountAmount",
	"ruleDiscountPercentage",
	"ruleDiscountAmount",
	"applyDiscountOn",
	"writeOffAmount",
	"isReturnMode",
	"returnAgainst",
	"returnItemCodes",
	"orderNotes",
	"deliveryDate",
	"salesPerson",
	"redeemLoyaltyPoints",
	"loyaltyPoints",
	"loyaltyAmount",
	"appliedOffers",
	"appliedCoupon",
	"couponCode",
	"currentDraftName",
	"currentDraftModified",
	"currency",
	"conversionRate",
	"selectedDeliveryCharge",
] as const;

type CartStore = ReturnType<typeof useCartStore>;
type Snapshot = Partial<Record<(typeof FIELDS)[number], unknown>>;

interface Draft {
	user: string;
	day: string;
	cart: Snapshot;
}

const watched = new WeakSet<object>();

function today(): string {
	const d = new Date();
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function snapshot(cart: CartStore): Snapshot {
	const store = cart as unknown as Record<string, unknown>;
	return Object.fromEntries(FIELDS.map((f) => [f, store[f]])) as Snapshot;
}

function readDraft(): Draft | null {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as Draft) : null;
	} catch {
		return null;
	}
}

function writeDraft(user: string, cart: Snapshot): void {
	try {
		if (!Array.isArray(cart.items) || cart.items.length === 0) {
			localStorage.removeItem(KEY);
			return;
		}
		localStorage.setItem(KEY, JSON.stringify({ user, day: today(), cart } satisfies Draft));
	} catch {
		/* storage full or blocked: the cart just won't survive a reload */
	}
}

/** Restore this cashier's unfinished sale, if any, and keep saving the cart from now on. */
export function enableCartDraft(user: string): void {
	if (!user || user === "Guest") return;
	const cart = useCartStore();
	if (watched.has(cart)) return;
	watched.add(cart);

	const draft = readDraft();
	if (draft && (draft.user !== user || draft.day !== today())) {
		localStorage.removeItem(KEY);
	} else if (draft && cart.items.length === 0) {
		const store = cart as unknown as Record<string, unknown>;
		for (const field of FIELDS) {
			if (field in draft.cart) store[field] = draft.cart[field];
		}
	}

	watch(
		() => snapshot(cart),
		(state) => writeDraft(user, state),
		{ deep: true },
	);
}
