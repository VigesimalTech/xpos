# Cashier Rights & Manager Approval

<!-- audience: supervisor -->

X POS decides what each cashier may do from their **POS Role** and their row on the **POS Profile**. ERPNext checks every sale against those rights when it arrives. On the desktop till, a manager can approve with their PIN whatever the cashier may not do alone.

---

## Overview

A cashier's rights come from three places:
- **POS Role permissions** — What the role may do (change prices, give discounts, return, close a shift, open screens)
- **Their row on the POS Profile** — Their own **Discount Limit**, and their PIN
- **The POS Profile itself** — Switches that apply to everyone on it, such as **Allow User to Edit Rate** and **Max Discount Percentage Allowed**

A user on several POS Profiles can hold a different role and limit on each. The profile of the open shift applies.

---

## POS Role Permissions

Permissions are ticked on the **POS Role** form in ERPNext, grouped as below.

| Group | Permission | Allows |
|---|---|---|
| Billing & Invoicing | Close Shift | Closing the shift |
| | Reprint Invoice | Reprinting a receipt |
| | Print Draft Invoice | Printing a held order |
| | Shift Report | The shift report |
| Discounts & Pricing | Apply Additional Discount | A discount on the whole sale |
| | Edit Discount Field | A discount on a line |
| | Change Price | Changing a line's price |
| Sales Operations | Sale Return | Returns |
| | Recall Other Shifts' Tabs | See [Open Tabs](27-open-tabs.md) |
| | Settle Outstanding Invoice | See [Open Tabs](27-open-tabs.md) |
| | Remove Items From the Cart | Deleting a line, lowering one to 0, clearing the sale, discarding a held order |
| | Void After Payment, Return Without Receipt | For coming features |
| Cash Management | Expense | Recording an expense |
| | Bank Drop | Recording a bank drop |
| | Open Drawer Without a Sale | For a coming feature |
| Reports | Current Stock by Brand, Current Stock Report | Those reports |
| Screens | Reports | The report catalog |
| | Barcode Printer | The Barcode Printer screen |
| | Price Checker | The Price Checker screen |
| | Purchasing | Purchase orders, purchase invoices and stock receiving |
| Administration | Manage Role Permissions | Editing POS Roles from the POS |
| | Approve Exceptions | Approving, with their PIN, what a cashier may not do alone |

### After an Upgrade
- New permissions are given to **Manager**, **Administrator** and roles with **Manage Role Permissions**, and to no other role
- Other roles keep the **Price Checker** only
- So cashiers who could remove items freely now ask a manager, until you tick **Remove Items From the Cart** on their role

---

## Discount Limits

- Each row in the POS Profile's **Applicable for Users** table has a **Discount Limit**, as a percentage of the list price
- **0** means no discount, and **100** means no cap
- The lower of the cashier's limit and the profile's **Max Discount Percentage Allowed** applies
- A price changed **below the price list** counts as a discount
- The limit applies to each line, the cart discount and the sale in total
- New cashier rows start at **0**

---

## Profile Switches That Override the Role

| POS Profile Setting | Off | On |
|---|---|---|
| **Allow User to Edit Rate** | No price field is offered, and ERPNext flags any changed price, whatever the role. A manager cannot approve it | The **Change Price** permission decides |
| **Allow User to Edit Discount** | No line discount is offered, and ERPNext flags one, whatever the role | The **Edit Discount Field** permission decides |

- ERPNext leaves **Allow User to Edit Rate** off by default
- **Allow User to Edit Discount** is switched on for existing profiles on upgrade, and new profiles default to on
- The cart discount keeps its own **Apply Additional Discount** permission

---

## Checking Every Sale on the Server

Every sale that reaches ERPNext is checked against the rights of the **cashier who made it**, not the till's API user.

### What Is Recorded
| Invoice Field | Description |
|---|---|
| Cashier | Who made the sale |
| Outside Policy | How the sale went beyond the cashier's rights. Empty means within policy |
| Approved By | The manager who approved it on the till |
| Approved Exceptions | What the approval covered |

### Sale Outside Policy
The POS Profile's **Sale Outside Policy** setting decides what ERPNext does with a sale beyond the cashier's rights:
- **Flag** (default) — The sale is booked, and the reasons are listed in **Outside Policy**
- **Reject** — A sale being made on the web POS is refused. A sale already paid at a till is **booked and flagged**, with a note that it was outside policy but already paid, because the customer has left with the goods

---

## Manager Approval on the Till

<!-- audience: cashier -->

On the desktop till, an action the cashier's role does not allow is **shown, not hidden**. Choosing it asks for a manager.

### How It Works
1. The cashier chooses the action (for example, a discount over their limit)
2. The **approval dialog** lists only the users on this till who may approve it
3. The manager taps their name and enters their PIN (on the pad or the keyboard)
4. The action goes ahead, and the manager is recorded as the approver
- **Cancel** leaves the action undone. A cancelled approval takes no payment
- Approval works fully offline

### Who May Approve
- A user of the same POS Profile
- Who holds **Approve Exceptions**
- Whose own role holds the permission being approved, and whose own discount limit covers the discount
- Who is not the cashier, unless the POS Profile's **Allow Self-Approval** is on

ERPNext checks the approval again when the record arrives. An approval that does not hold up is treated as no approval.

### What Asks for a Manager
| Action | Asks When |
|---|---|
| Paying for a sale | A price change, line or cart discount, or return beyond the cashier's rights. One approval covers the whole sale; a later change within that cover is not asked again |
| Removing items | The role lacks **Remove Items From the Cart**: deleting a line or taking it to 0, clearing the sale, discarding a held order |
| Returns | The role lacks **Sale Return** |
| Reprints | The role lacks **Reprint Invoice** (toolbar, menu, `Ctrl+P` and the receipt preview) |
| Closing the shift | The role lacks **Close Shift**. The POS Closing Shift records **Approved By** |
| Expenses and bank drops | The role lacks **Expense** or **Bank Drop**. The POS Cash Movement records **Approved By** |
| Screens | The role lacks the screen's permission and **Screens the Role Lacks** is **Show, Ask a Manager** |

Every approval, and every wrong PIN, is recorded in the [Audit Log](31-audit-log.md).

### On the Web POS
- The web POS has no PIN pad, so a manager cannot approve there
- An action the cashier's role lacks is hidden, or refused with the reason; a manager does it instead
- Removals are recorded in the [Audit Log](31-audit-log.md), as on the till

---

## Screens the Role Lacks

Reports, the Barcode Printer, the Price Checker and Purchasing each need a POS Role permission. The POS Profile's **Screens the Role Lacks** sets what a cashier sees of one their role lacks:

| Option | Effect |
|---|---|
| **Hide** (default) | Taken out of the menu bar, sidebar, navigation, shortcuts and search |
| **Show, Ask a Manager** | Kept, and opened with a manager's PIN on the till. The web POS hides it either way |

- Typing the screen's address does not get round the rule
- Moving within a screen asks only once
- A menu with nothing left in it is left out
- Reports the role lacks follow the same rule
- Purchasing also needs the POS Profile's **Allow Purchasing**, which is off by default

---

## Tips

- Give each cashier a **Discount Limit** on their POS Profile row; new rows start at 0
- Keep **Sale Outside Policy** on **Flag** while you tune the roles, then review the **Outside Policy** column on sales invoices
- Give **Approve Exceptions** to supervisors, and set their PINs, before cashiers start asking for approvals
- Leave **Allow Self-Approval** off unless a shop has only one manager on duty
- Review the history of a POS Profile or POS Role after anyone changes limits or permissions: every change is recorded with who made it
- Use **Show, Ask a Manager** where cashiers occasionally need a screen, and **Hide** where they never do
