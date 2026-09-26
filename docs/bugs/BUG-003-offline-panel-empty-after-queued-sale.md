# BUG-003: Offline Invoices panel shows "All caught up" while a queued offline sale sits in pending_invoices

**Severity:** C — cashier cannot see work waiting on the till
**Environment:** desktop till (Electron), branch `vigesimal/v2.9`
**Found by:** Playwright `frontend/tests/desktop/specs/offlineSale.spec.ts`
**Status:** open (QA does not change application code)

## Summary

With ERPNext unreachable, a sale is saved on the till (toast "Invoice saved locally (#N)",
`pending_invoices` row `status = pending`, sync pill "Offline"). Opening the pill shows the
Offline Invoices panel with **"All caught up! / No pending offline invoices."** and header
**"Online — 0"**, even though the sale is still queued. The panel never lists the sale until
something else happens to call `loadPendingInvoices` (e.g. a later sync).

## Steps to reproduce

1. Seed a site (`xpos/tests/round_trip.py`), start the desktop till, sign in, open a shift.
2. Cut the till's line to ERPNext (refuse connections).
3. Sell one item, Pay → Save. Expect toast "Invoice saved locally (#1)".
4. Confirm locally: `SELECT id, local_id, status FROM pending_invoices` → one row, `pending`.
5. Sync pill shows Offline.
6. Click the sync pill.

**Expected:** panel lists the queued sale (customer, total, item(s), Sync All (1)).

**Actual:** panel shows "All caught up" / "No pending offline invoices"; header shows
"Online — 0". `pendingCount` and `pendingInvoices` in the offline store are stale.

## Root cause

Two paths diverge after queueing:

1. **Electron payment path** (`PaymentDialog.vue`, `isElectron() && window.electronAPI?.db`)
   calls `dbBridge.addPendingInvoice(...)` directly. It never calls
   `offlineStore.saveOffline` / `loadPendingInvoices` / `refreshPendingCount`.

2. **Panel load** (`OfflinePendingPanel.vue`) only runs `offlineStore.loadPendingInvoices()`
   in `onMounted`. The panel component is mounted once with `SaleDialogs` (it is always in
   the tree, `:open` only toggles the dialog), so the list is loaded at app start when it is
   empty and is not reloaded when the pill opens the panel.

`App.vue` does call `refreshPendingCount()` when `syncStatus.unreachable` flips, but that
updates the count ref only; the `pendingInvoices` array the panel renders still comes from
the one-shot `loadPendingInvoices`. The empty-state `v-if` is
`pendingInvoices.length === 0`, so the panel claims all-clear while the queue is non-empty.

Header "Online — 0" also disagrees with the pill's Offline: the panel uses
`offlineStore.isOnline` (`navigator.onLine`, still true when the outage is only the till's
route to ERPNext), while the pill uses `offlineStore.isOnline || syncStatus.unreachable`.

## Impact

- Cashier opens the panel to check "what is waiting to send" and is told nothing is waiting.
- Trust in Offline/queue state erodes; risk of re-selling or restarting thinking work was lost.
- Any UI that relies on `pendingInvoices` being fresh after an Electron local save is wrong
  until the next store action that reloads the list.

## Related

- BUG-001 (browser queue `DataCloneError`) — different path; Electron queue works.
- Core round-trip still works: when the line returns, Sync Now pushes the sale with the same
  `xpos_local_id` and clears `pending_invoices` (covered by the same spec).

## Suggested fix (for the app team; not applied by QA)

- After a local save, refresh the offline store (`loadPendingInvoices` + `refreshPendingCount`),
  or have `addPendingInvoice`'s success path do it.
- Reload (or watch open) when the panel is shown, not only on component mount.
- Panel header should use the same offline predicate as the pill
  (`!isOnline || syncStatus.unreachable`), not `navigator.onLine` alone.
