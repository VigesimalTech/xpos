---
name: bug-hunt
description: Hunt for real, insidious bugs in the X POS desktop till (and the ERPNext side it syncs with) by exploratory testing against a real ERPNext. Session-based, charter by charter, with the network switchable and oracles that check the till against ERPNext. Use when asked to test the app, find bugs, explore a feature, or check a release before tagging.
---

# Bug hunt

You are testing a point-of-sale till that takes real money, works offline and syncs to
ERPNext later. The bugs that matter are the ones unit tests miss: they live **between**
components (till ↔ server, screen ↔ local database, one step ↔ the next) and **in time**
(a request in flight when the network drops, a sale paid before a fetch lands, a patch
that runs after another). Scripted tests walk the happy path; you go where it isn't.

Argument: an area or charter name (see `charters.md`), `release` (the release sweep), or
nothing (the whole app, highest risk first).

## Rules

1. **Evidence, not impressions.** Every finding has a reproduction, what you expected,
   what happened, and proof: a screenshot, log lines, a database row, an ERPNext record.
   If you cannot reproduce it twice, it is a lead, not a finding.
2. **Check with the oracles after every step that changes data** (`GET /check`), not only
   at the end. A problem found three steps later is three times harder to pin.
3. **Fix only what is clearly a bug, and only with a test that fails first.** Anything that
   is a matter of design, behaviour a shop might want, or money policy, goes to the user as
   a question. Never "fix" a finding by changing the test or the oracle.
4. **Stay on the test site.** Never point a till at a production or client site. Server
   changes (code copy, migrate, seed) only on the test site named in
   `.claude/bug-hunt.local.md`, and only in the way it describes.
5. **Say where you are.** At the start of each charter, one line to the user: the charter
   and what you are about to try. At the end, one line: what you found.

## Setup (once per hunt)

1. Read `.claude/bug-hunt.local.md` (gitignored): how to reach the test ERPNext, the
   tunnel, the seed config path, how to put branch code on the server. If it is missing,
   ask the user; do not guess hosts.
2. Build what you test: `cd frontend && npm run build:electron`. The server must run the
   same branch's Python (copy and `migrate` as the local file says).
3. Fresh seed: `bench --site <test site> execute xpos.tests.round_trip.setup`; save its JSON
   as the `XPOS_RT_CONFIG` file. Give the approvers PINs (POS Profile user rows,
   `xpos_pin`; hashed on save).
4. **Baseline**: `npx playwright test -c playwright.desktop.config.ts`. If it fails, that is
   your first finding: stop and pin it before exploring.
5. Start the driver in the background (see `tests/desktop/explore/driver.spec.ts`):
   `XPOS_RT_CONFIG=… XPOS_RT_URL=… npx playwright test -c playwright.explore.config.ts`.
   Set the till up with `x.tillSite` so its traffic goes through the switchable line.

## The driver

`POST /run` takes the body of `async (page, till, site, h, x) => …`:

- `page`: the till's window (Playwright). Act as a cashier would: click what is on the
  screen, type on the keyboard. Reach into the page only to observe, never to act.
- `h`: `tests/desktop/support/till.ts`: `setUpTill`, `signIn`, `menu`, `syncNow`,
  `tillDb(sql)` (the till's MariaDB), `erpList(site, doctype, filters, fields)`.
- `x.net`: `offline("refuse")`, `offline("hang")`, `online()`, `state()`.
- `x.reconcile()`, `x.suspicious(lines)`: the oracles (`explore/oracles.ts`).
- `till.printed()`: receipts sent to the printer; `globalThis.__xposOtherPrints` in the
  main process holds the other print channels.

`GET /check` (oracles + suspicious log lines), `GET /log`, `GET /shot?name=`,
`POST /restart` (quit and reopen the app on the same profile: a till restarted mid-shift),
`POST /quit`. Keep a small client script in the scratchpad (`x.sh run|check|log|shot`).

## A charter

Work one charter at a time from `charters.md`, in risk order. For each:

1. **Mission** in one sentence, and the **oracle**: how you will know it went wrong.
2. **Happy path once**, checking the screen, the receipt, `/check`.
3. **Then attack it** with the heuristics below that fit. Pick at least three.
4. **Record** each finding as it happens (see Report) with its evidence path.
5. **Close**: what you covered, what you did not, and why.

## Heuristics for insidious bugs

Each of these found a real bug in this app at least once.

- **Interrupt it.** Cut the network (`refuse`, then `hang`) before, during and after the
  step: mid-payment, mid-sync, mid-shift-close. Restart the app mid-operation. Then come
  back online and check that everything lands **exactly once**.
- **Be fast.** Act the instant the screen allows: pay straight after opening a shift, tap
  twice, press Enter twice. Background fetches lose races. (Found: the first sale on a new
  till printed the fallback page because the receipt layout was still loading.)
- **Be slow.** Leave a dialog open across a sync, a session expiry, midnight.
- **Change the world underneath.** Change the POS Profile, a role, a price or a user in
  ERPNext while the till is open; sync; see what the till believes, and when.
- **Walk the upgrade path, not just the install.** Patches run in order on sites that skip
  versions. (Found: one patch pre-filled the next patch's permissions as off.)
- **Every way in.** A screen or action has menu, sidebar, shortcut, search, typed address,
  back/forward, and a button inside another screen. Check the rule holds on all of them.
- **Every input device.** Mouse, touch-sized targets, keyboard only, number pad, barcode
  scanner (types fast and presses Enter). (Found: the manager PIN pad ignored the keyboard.)
- **Boundaries and money.** 0, 1, negative, the limit, just over, decimals that round,
  large totals, change due, several payment modes, returns that exceed the sale.
- **Who is signed in.** Cashier vs manager vs someone removed or disabled in ERPNext since;
  switch users mid-sale; approve your own exception.
- **State machines.** Do things out of order: close a shift with a held order, sign out
  mid-sale, return a sale that has not synced, reprint a sale from another shift.
- **Twice.** Sync twice, submit twice, restart twice, reopen the same held order twice.
- **Down is not off.** The till's own network up while ERPNext is gone is the usual outage,
  and differs from the machine being offline: test with the line, not by switching the
  machine's network off. Watch what each failure costs: a retry counter, a status, a flag.
  (Found: a minute of it dead-lettered every sale for good.)
- **Lose the answer, not the request.** `offline("lose-replies", /method/)`: the server acts,
  the till never hears. Everything sent must be safe to send twice. (Found: the re-send was
  refused as a duplicate and the sale given up.)
- **Two things doing one job.** Look for a second code path that does the same work (a web
  store and the desktop engine both syncing, two dialogs for one action). They race.
  (Found: the web store re-sent synced sales and deleted the till's records of them.)
- **Every event has a listener, on every platform.** Map each event, IPC channel and menu
  action to what handles it, per layout (web vs till). (Found: Return, Repeat and the sync
  panel were heard only by the web navbar; on the till nothing opened.)
- **Records must not vanish.** The oracle remembers every sale it has seen; a sale leaving
  the till's records is a finding even when ERPNext has it.
- **Read the logs you were not looking at.** `/check` flags errors; also read `/log` after
  anything odd. A warning today is a lost sale tomorrow.

## Report

At the end, a report to the user (and, if they want it shared, published):

| # | Severity | Finding | Reproduction | Evidence | Status |
|---|---|---|---|---|---|

Severity: **S1** money or data wrong or lost, **S2** a cashier blocked or misled, **S3**
works but wrong or awkward, **S4** cosmetic. Status: fixed (commit), question for the user,
or open.

Then: coverage (charters done, skipped, why), the environment (branch, commit, server
state), and every question that needs the user's decision. Each fixed bug gets a step in a
scripted spec (`tests/desktop/specs/`) or a unit test, so it cannot come back.
