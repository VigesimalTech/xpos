/**
 * What the cashier reads when something needs ERPNext and the till cannot reach it, in
 * place of the internal "__offline__" that reached the screen in reports, returns and the
 * customer form (bug hunt, 22 Sep 2026).
 */
import __ from "@/lib/translate";

export const OFFLINE_SENTINEL = "__offline__";

export function offlineMessage(): string {
	return __("ERPNext is not reachable. This needs ERPNext: try again once the till is back online.");
}

/** The message with any internal offline marker replaced by the sentence. */
export function plainMessage(message: string): string {
	return message.includes(OFFLINE_SENTINEL) ? offlineMessage() : message;
}
