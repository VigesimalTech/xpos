# Audit Log

<!-- audience: supervisor -->

X POS records what happens at the POS that leaves no sale behind: deleted lines, cleared sales, reprints, approvals and wrong PINs. These events are sent to ERPNext as **POS Audit Events**, so a manager can review them alongside the sales.

---

## Overview

- On the [Desktop Till](29-desktop-till.md), every event is written to the till's local database first, so nothing is lost offline. Events are sent to ERPNext in the background, after the shifts they belong to
- On the web POS, removals, lowered quantities and reprints are sent to ERPNext as they happen. While ERPNext cannot be reached they wait in the browser and are sent when it is back
- ERPNext keeps **every** event it is sent. POS Audit Events are **read-only** and cannot be changed once stored

---

## Event Types

| Event Type | Recorded When |
|---|---|
| **Line Removed** | A line is deleted from the sale, or its quantity lowered to 0 |
| **Quantity Lowered** | A line's quantity is lowered (no approval needed) |
| **Sale Cleared** | The whole sale is cleared. The first lines are kept, with how many there were |
| **Held Order Discarded** | A held order is deleted |
| **Reprint** | A receipt is reprinted |
| **Approval** | A manager approves an action with their PIN, including opening a screen the role lacks |
| **PIN Failed** | A wrong PIN is entered, at sign-in or for an approval |
| **Settings Changed** | An administrator changes the till's ERPNext server, local database or sync settings, or whether it opens at startup. The change is recorded as from and to |
| **Local Data Cleared** | An administrator clears the till's synced data, or all its local data |
| **Till Key Refused** | A till's sales carry a different signing key from the one ERPNext holds for it. Recorded once per key. See [Signed Sales](33-signed-sales.md) |
| **No Sale**, **Void After Payment**, **Other** | Reserved for coming features |

Approvals and wrong PINs are recorded where the PIN is checked, so no screen can leave them out.

---

## What Each Event Records

| Section | Fields |
|---|---|
| Event | Event Type, Event Time (by the till's clock), POS Profile, POS Opening Shift |
| Who | Cashier, Approved By, PIN Of (whose PIN was tried, for a wrong PIN) |
| What | Item, Item Name, Quantity, Amount (the value taken out of the sale), Reference (the invoice or held order), Description, Details |
| Checks | What did not check out against ERPNext when the event arrived |
| Till | Till User (the till's API user) |

---

## Checks

An event is never refused. When something about it does not check out, ERPNext stores it anyway and notes the problem in **Checks**, for example:
- The cashier is not on the POS Profile
- The approver may not approve that action
- ERPNext has no record of the shift
- The POS Profile no longer exists

An event with something in **Checks** deserves a manager's look.

---

## Reviewing the Log

1. In ERPNext, open the **POS Audit Event** list
2. Filter by **POS Profile**, **POS Opening Shift**, **Cashier** or **Event Type**
3. Open an event to see the item, amount and who approved it

---

## Tips

- The [Exceptions Report](32-exceptions-report.md) totals these events by cashier and day; start there, and open the log for the detail
- Review **Line Removed** and **Sale Cleared** events alongside each shift's close. They show value taken out of sales before payment
- Frequent **PIN Failed** events for one user can mean someone else is trying their PIN
- Filter on events with **Checks** filled in to find approvals that did not hold up
