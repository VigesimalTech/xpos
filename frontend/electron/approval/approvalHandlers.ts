/**
 * A manager's approval on the till (K19): who may approve a request, and checking
 * their PIN. Offline: the approvers, their rights and PIN hashes arrive with the
 * cashier pull, the self-approval setting with the POS Profile.
 *
 * Whether someone may approve is checked before their PIN, so a refusal never counts
 * towards the PIN lockout and a right PIN tells an ineligible user nothing.
 */
import { ipcMain } from "electron";
import { query, queryOne } from "../database/dbService";
import { checkTillPin, type PinResult } from "../database/ipcHandlers";
import { createLogger } from "../logger";
import { approvalRefusal, type ApprovalRefusal, type ApproverRow } from "./approvalRules";

const log = createLogger("Approval");

export interface ApprovalAsk {
	cashier: string;
	posProfile: string;
	permission?: string;
	permissions?: string[];
	discountPct?: number;
}

export type ApprovalVerdict =
	| { ok: true; approver: string }
	| {
			ok: false;
			reason: ApprovalRefusal | NonNullable<PinResult["reason"]>;
			attemptsLeft?: number;
			lockedUntil?: string;
	  };

async function profileRules(posProfile: string) {
	const row = await queryOne<{
		max_discount_percentage_allowed: number | null;
		xpos_allow_self_approval: number | null;
	}>(
		"SELECT `max_discount_percentage_allowed`, `xpos_allow_self_approval` FROM `pos_profiles` WHERE `name` = ?",
		[posProfile],
	);
	return {
		profileMaxDiscount: row?.max_discount_percentage_allowed ?? 100,
		allowSelfApproval: Boolean(Number(row?.xpos_allow_self_approval)),
	};
}

async function refusalFor(approver: ApproverRow, ask: ApprovalAsk): Promise<ApprovalRefusal | null> {
	return approvalRefusal(approver, { ...ask, ...(await profileRules(ask.posProfile)) });
}

/** Everyone on this till who may approve `ask`, for the approval dialog. */
export async function approversFor(ask: ApprovalAsk): Promise<{ name: string; full_name: string }[]> {
	const users = await query<ApproverRow & { full_name: string }>(
		"SELECT * FROM `pos_users` WHERE `approve_exceptions` = 1 ORDER BY `full_name`",
	);
	const eligible = [];
	for (const user of users) {
		if (!(await refusalFor(user, ask)))
			eligible.push({ name: user.name, full_name: user.full_name || user.name });
	}
	return eligible;
}

export async function verifyApproval(
	approver: string,
	pin: string,
	ask: ApprovalAsk,
): Promise<ApprovalVerdict> {
	const row = await queryOne<ApproverRow>("SELECT * FROM `pos_users` WHERE `username` = ? OR `name` = ?", [
		approver,
		approver,
	]);
	if (!row) return { ok: false, reason: "unknown_user" };
	const refusal = await refusalFor(row, ask);
	if (refusal) {
		log.info(`Approval by ${row.name} for ${ask.cashier} refused: ${refusal}`);
		return { ok: false, reason: refusal };
	}
	const result = await checkTillPin(row.name, pin);
	if (!result.ok) return { ok: false, reason: result.reason ?? "wrong_pin", ...pick(result) };
	log.info(
		`Approved by ${row.name} for ${ask.cashier}: ${ask.permission ?? ""} ${ask.discountPct ?? ""}`.trim(),
	);
	return { ok: true, approver: row.name };
}

function pick(r: PinResult) {
	return {
		...(r.attemptsLeft !== undefined ? { attemptsLeft: r.attemptsLeft } : {}),
		...(r.lockedUntil !== undefined ? { lockedUntil: r.lockedUntil } : {}),
	};
}

export function registerApprovalHandlers(): void {
	ipcMain.handle("approval:approvers", (_e, ask: ApprovalAsk) => approversFor(ask));
	ipcMain.handle("approval:verify", (_e, approver: string, pin: string, ask: ApprovalAsk) =>
		verifyApproval(approver, pin, ask),
	);
}
