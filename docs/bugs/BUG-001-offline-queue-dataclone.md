# BUG-001 — Offline invoice queue fails with DataCloneError (browser / IndexedDB path)

| Field | Value |
| --- | --- |
| Severity | **Critical (C)** |
| Area | Offline mode, IndexedDB queue |
| Environment | Browser/PWA path (non-Electron); Vite + Cypress e2e |
| Reported | 2026-09-24 |
| Status | Open (app code intentionally untouched — QA only) |

## Summary

`dbBridge.addPendingInvoice` writes `record.data` straight into IndexedDB without `sanitizeForIdb`. Cart payloads contain non-cloneable values (arrays of functions, etc.), so `structuredClone`/IndexedDB throws `DataCloneError`. Offline queueing never succeeds in the browser path: no success toast, no pending row, no stock reservation.

## Root cause

Browser branch of `addPendingInvoice` bypasses the sanitizer used by `idbService.addPendingInvoice`:

- **Broken:** `frontend/src/services/dbBridge.ts:206-224` — `db.table("pendingInvoices").add({ ..., data: record.data, ... })`
- **Correct pattern:** `frontend/src/services/idbService.ts:436-438` — `db.pendingInvoices.add(sanitizeForIdb(record))`
- **Sanitizer:** `frontend/src/services/idbService.ts:19+` (`sanitizeForIdb`)
- **Caller:** `frontend/src/stores/offlineStore.ts:179-204` (`saveOffline` → `addPendingInvoice`; catch returns `{ success: false }`)

Electron path (`getDb().addPendingInvoice`) and direct `idbService` helpers sanitize correctly; the bridge browser path does not.

## Repro (e2e)

```bash
# vite on :5174, then
yarn test:e2e --spec "tests/e2e/specs/offline/offline-sale.cy.ts,tests/e2e/specs/offline/offline-stock.cy.ts"
```

1. Boot POS offline (`use_offline_mode` on).
2. Add line items, open payment, **Save Only**.
3. Expected: toast `/Invoice saved offline/i`, cart clears, pending badge increments, IndexedDB `pendingInvoices` grows, `stockCache` decrements.
4. Actual: toast never appears (or `Failed to save invoice offline`); console `DataCloneError: [object Array] could not be cloned`.

## Observed impact (latest clean runs)

| Spec | Result |
| --- | --- |
| offline-sale | 2/9 pass — all queue paths fail on `/Invoice saved offline` |
| offline-stock | 0/2 — fails before stock asserts |
| offline-status | 6/14 — queue-dependent panel/badge tests fail |
| offline-recovery | 3/10 — queue + downstream toast/pill tests fail |
| offline-idempotency | 2/6 — same cascade |

~15 tests fail directly; ~26 fail as cascade (empty queue ⇒ no sync/stock-reject/Syncing assertions).

## Suggested fix (not applied)

In `dbBridge.addPendingInvoice` browser path, sanitize before write (match `idbService`), e.g. store `sanitizeForIdb(record)` / `sanitizeForIdb(record.data)` so non-cloneable values are stripped or converted.

## Regression tests (already in suite; keep red until fix)

- `frontend/tests/e2e/specs/offline/offline-sale.cy.ts`
- `frontend/tests/e2e/specs/offline/offline-stock.cy.ts`
- `frontend/tests/e2e/specs/offline/offline-status.cy.ts`
- `frontend/tests/e2e/specs/offline/offline-recovery.cy.ts`

Log: `/tmp/opencode/offline-remaining.log`, `/tmp/opencode/offline-stock-clean.log`.
