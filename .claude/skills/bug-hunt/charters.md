# Charters

In risk order: money and data first. Each names what to protect, the oracle, and the
attacks most likely to break it. Add a charter when a feature lands; strike nothing out,
mark it with the date it was last run.

## 1. Offline selling and sync (S1 territory) — last run 21 Sep 2026

Protect: every sale made on the till reaches ERPNext exactly once, with the same total.
Oracle: `/check` (no sale missing, duplicated, stuck in `syncing`, or failed without a
reason a cashier can act on); ERPNext stock and totals match the till.

- Sell with the line `refuse`d, then `hang`: the sale saves, prints, and says so.
- Cut the line **during** payment and **during** a sync push; come back; `/check`.
- Restart the app with sales pending; restart it mid-sync.
- Several offline sales, one of them a return; sync; order and totals in ERPNext.
- Offline for a long time: the session and the API key still work when back.
- A sale ERPNext rejects (policy, closed period, missing item): the till says why and
  keeps it for review, and nothing else is blocked behind it.

## 2. Payment and totals — last run 22 Sep 2026

Protect: what the cashier sees, what prints and what ERPNext books are the same numbers.
Oracle: screen total = receipt total = `pending_invoices.grand_total` = ERPNext.

- Cash with change; exact cash; several payment modes; overpaying a non-cash mode.
- Rounding: prices with decimals, quantities that do not divide, tax inclusive and not.
- Discounts: line and whole-sale, at the cashier's limit, just over (manager's PIN), 100%.
- Price change on a line (allowed and not). Free items, pricing rules, coupons.
- Pay twice fast; Enter twice on Save & Print.

## 3. Shift open and close — last run 22 Sep 2026 (not: two users on one till)

Protect: the closing counts every sale, return and cash movement of the shift, once.
Oracle: closing summary = sum of the shift's sales and movements; ERPNext closing entry.

- Close with sales pending sync, with a held order, offline.
- Two users on one till, each with a shift. Close one; the other's sales stay theirs.
- Restart mid-close. Close, then reopen a shift at once.

## 4. Returns, voids and reprints — last run 22 Sep 2026 (not: void after payment, return without receipt)

Protect: a return never refunds more than was sold; every reprint and void is logged.
Oracle: ERPNext return against the right invoice; audit events.

- Return a synced sale, an unsynced one, part of one, more than was sold, twice.
- Return without a receipt (permission and manager PIN). Void after payment.
- Reprint: last receipt, from Order History, a sale from another shift.

## 5. Manager approval and permissions — last run 21 Sep 2026

Protect: nothing the role forbids happens without a named approver, on every way in.
Oracle: audit events; the approver on the invoice; the server's own check on sync.

- Every gated action and screen: menu, sidebar, shortcut, search, typed address, back.
- Hide vs Show, Ask a Manager; purchasing on and off; a change made while the till is open.
- Wrong PIN until locked; another manager; self-approval on and off; keyboard entry.
- A cashier removed or disabled in ERPNext since the last sync.

## 6. Held orders and open tabs — last run 22 Sep 2026 (not: other shift's tabs)

Protect: a held order comes back whole, once, and never reaches ERPNext on its own.

- Hold, restart, restore. Restore twice. Discard (manager). Hold offline.
- Recall another shift's tab (permission).

## 7. Cash movements — last run 22 Sep 2026 (expenses only)

Protect: expenses, deposits and bank drops post once, to the right accounts.

- Each type online and offline; amount 0, negative, larger than the drawer.
- No-sale drawer open (permission, audit).

## 8. Items, search and scanning — last run 22 Sep 2026 (not: variants, batches, serials)

Protect: the right item at the right price, quickly.

- Search by name, code, barcode; scanner speed (type fast + Enter); unknown barcode.
- Variants, batches, serials, UOM changes, out of stock with and without blocking.
- A price changed in ERPNext: when does the till sell at the new price?

## 9. Customers and loyalty — last run 22 Sep 2026 (not: loyalty, credit sales)

- Create a customer offline; sell to them; sync; one customer in ERPNext, not two.
- Loyalty points earned and redeemed; credit sale; outstanding settlement.

## 10. Setup, sign-in and devices — last run 22 Sep 2026

- Setup wizard with a wrong key, a wrong URL, the server down; database late.
- PIN sign-in, password sign-in, lockout, sign out mid-sale.
- Receipt printer missing; printing offline; the first sale on a new till.

## 11. Reports, price checker, barcode printer — last run 22 Sep 2026 (stock reports only)

- Each report opens, with data, offline and online; export and print.
- Locked per-report permissions; very large results.

## Release sweep

Before tagging: the baseline suite, then charters 1–3 in full and one attack from each of
4–11, on the release branch built as it will ship.
