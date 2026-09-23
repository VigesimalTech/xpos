# Exceptions Report

<!-- audience: supervisor -->

The **POS Exceptions** report shows, for each cashier, what happened outside a plain sale: items taken out of sales before payment, returns, discounts, sales outside policy, manager approvals, reprints, wrong PINs and drawer count differences. It is how a supervisor reviews the POS without watching every till.

---

## Overview

- One row per day (or week), POS Profile and cashier
- Within a day, the cashier who took the most out of sales comes first
- Figures come from the invoices, the [Audit Log](31-audit-log.md) and the closing shifts, from the desktop till and the web POS alike
- Summary cards total what was taken out, returns, discounts, count differences and wrong PINs

---

## Opening the Report

### In ERPNext
1. Search for **POS Exceptions** in the awesome bar
2. Set the filters and the report runs
- Open to **System Manager**, **Sales Manager** and **Accounts Manager**

### In the POS
- Open **Reports** (`Alt+9`) and choose **Exceptions by Cashier**
- It needs the **Approve Exceptions** permission. Without it, the report follows the POS Profile's **Screens the Role Lacks** (see [Cashier Rights & Manager Approval](30-cashier-rights-approval.md))

### Filters
| Filter | Description |
|---|---|
| Company | Required |
| From Date, To Date | The period. Defaults to the last seven days |
| POS Profile | One shop only |
| Cashier | One cashier only |
| Group By | **Day** (default) or **Week**, starting on Monday |

---

## Columns

| Column | What It Counts |
|---|---|
| Sales, Sales Value | Sales made, and their total |
| Taken Out Before Payment | The value of lines removed, quantities lowered, sales cleared and held orders discarded |
| Taken Out % | What was taken out, as a share of sales value |
| Lines Removed, Quantities Lowered, Sales Cleared, Held Orders Discarded | Each kind of removal, with its count and value |
| Returns, Returns Value | Returns made, and their total |
| Discounts Given | Cart discounts, and lines sold under their price-list price |
| Outside Policy | Sales ERPNext flagged as beyond the cashier's rights |
| Manager Approvals | Approvals given with a manager's PIN |
| Reprints | Receipts printed again |
| Wrong PINs | Wrong PINs entered for this user's PIN |
| Count Difference | The counted drawer less what was expected, over the day's closed shifts |

- The cashier is the one recorded on the sale. For sales made before that was recorded, it is whoever created the invoice
- A wrong PIN counts against the user whose PIN was tried, since that is who someone tried to be

---

## Reading It

- **Taken Out %** well above a cashier's colleagues is the first thing to look at. Open the [Audit Log](31-audit-log.md), filtered by that cashier and day, to see each removal
- A steady **Count Difference** in one direction, rather than small amounts both ways, points to a habit, not a slip
- **Wrong PINs** for a user who was not working that day mean someone else tried their PIN
- **Outside Policy** sales are listed, with their reasons, on each invoice's **Outside Policy** field

---

## Tips

- Review the report weekly (**Group By: Week**), and daily for a shop you are watching closely
- Pair it with a blind cash-up (see [Shift Management](02-shift-management.md)), so the count differences are real counts
- Compare cashiers within the same shop: busy days raise every figure, so the share taken out matters more than the amount
