# BUG-002 — Online `create_invoice` omits `local_id` (idempotency / dedupe gap)

| Field | Value |
| --- | --- |
| Severity | **High (C — audit C4)** |
| Area | Invoice create, sync idempotency, FBR dedupe |
| Environment | Browser online path in PaymentDialog; API accepts `local_id` |
| Reported | 2026-09-24 |
| Status | Open (app code intentionally untouched — QA only) |

## Summary

Offline sync sends `local_id` so the server can dedupe retries (`xpos.api.invoices.create_invoice`). The **online** success path in `PaymentDialog` does not pass `local_id` (top-level or in payload). A retry after a network timeout / ambiguous response can create a **duplicate POS Invoice**; FBR/`xpos_local_id` linkage is also missing on first online create.

## Root cause

| Path | Sends `local_id`? | Location |
| --- | --- | --- |
| Offline sync | **Yes** | `frontend/src/stores/offlineStore.ts:251-254` |
| Online create | **No** | `frontend/src/components/dialogs/PaymentDialog.vue:1395-1397` |
| Server API | Accepts optional | `xpos/api/invoices.py:285-298, 358-359` |

Online call today:

```ts
await call("xpos.api.invoices.create_invoice", {
  data: JSON.stringify(invoiceData),
});
```

Server: `local_id = local_id or data.get("local_id")` — neither is supplied on this path.

## Repro (contract e2e)

```bash
yarn test:e2e --spec "tests/e2e/specs/offline/offline-idempotency.cy.ts"
```

Test: `online create_invoice request includes a local_id for dedupe`  
(`frontend/tests/e2e/specs/offline/offline-idempotency.cy.ts:82+`)

Expected: `create_invoice` args include non-empty `local_id`, or `data.local_id` present.  
Actual: both missing.

## Impact

- Double-submit / retry after timeout → duplicate invoice (no `find_invoice_by_local_id` guard).
- Online-created invoices lack stable `xpos_local_id` unless client later backfills.
- Diverges from documented offline sync contract and C4 audit finding.

## Suggested fix (not applied)

Generate a stable client `local_id` when the cart is finalized (same as offline queue id), then pass it on online create:

```ts
await call("xpos.api.invoices.create_invoice", {
  data: JSON.stringify(invoiceData),
  local_id: invoiceData.local_id, // or equivalent stable id
});
```

Ensure `invoiceData` always carries `local_id` before either branch (online or offline).

## Regression test (keep red until fix)

- `frontend/tests/e2e/specs/offline/offline-idempotency.cy.ts` — `local_id on create_invoice`
