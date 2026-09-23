# Signed Sales

<!-- audience: administrator -->

A desktop till takes payment first and sends the sale to ERPNext afterwards, sometimes hours later. **Signed sales** make sure what arrives is what was paid: the till signs every sale at payment and numbers it, and ERPNext checks both when the sale arrives.

---

## Overview

- Every paid sale is **signed** on the till the moment it is paid, and given the till's **next sale number**
- ERPNext checks the signature when the sale arrives. A sale that no longer matches what was signed is **booked and flagged**, never lost
- A sale number that never reaches ERPNext is listed in the **Missing Till Sales** report
- Held orders are not signed: they are not sales until they are paid
- The web POS sends each sale to ERPNext as it is made, so it has nothing to sign

---

## How It Works

### The Till's Key
- Each till makes its own **signing key** the first time it starts. It never leaves the PC
- The key is sealed by the operating system's secure store (on Windows, the signed-in Windows user's), not kept in the till's database
- Each signed sale carries the key's public half. ERPNext keeps the **first** one a till's API user sends, as a **POS Till Key**
- Sales already waiting on a till when it is updated to signing are signed once, as the key is made

### When a Sale Arrives
ERPNext checks the sale against the till's POS Till Key and records, on the invoice:

| Field | Description |
|---|---|
| Till Key | The key that signed the sale |
| Till Sale Number | The till's number for the sale |

A sale is **booked and flagged** in **Outside Policy** when:
- Its lines, quantities, prices, discounts, payments, cashier or approver differ from what the till signed
- It arrives unsigned from a till that signs
- It is signed with a different key from the one ERPNext holds for that till

These flags are never covered by a manager's approval, and **Sale Outside Policy: Reject** does not refuse them: the customer has paid and left. Flagged sales appear in the [Exceptions Report](32-exceptions-report.md) under **Outside Policy**.

### A Different Key
- A till that offers a different key from the one ERPNext holds is recorded once as a **Till Key Refused** event in the [Audit Log](31-audit-log.md), and its sales are flagged
- After reinstalling a till, or replacing its PC, an administrator deletes that till's **POS Till Key** in ERPNext. The till's next sale registers its new key

---

## POS Till Key

**Path:** Search for **POS Till Key** in the awesome bar

| Field | Description |
|---|---|
| Till User | The API user the till syncs as. One key per till user |
| Key ID | The short name shown on each sale the key signs |
| Device | The PC's name, as the till reported it |
| Registered On | When ERPNext received the key |

- Keys cannot be changed, only deleted. Only a **System Manager** can delete one
- **Sales Manager** and **Accounts Manager** can read them

---

## Missing Till Sales Report

<!-- audience: supervisor -->

**Path:** Search for **Missing Till Sales** in the awesome bar

Each row is a run of sale numbers a till used that ERPNext has not received, between the two sales around it.

| Column | Description |
|---|---|
| Till User, Till Key | The till |
| Missing From, Missing To | The numbers not received |
| Sales Missing | How many |
| Sale Before, Date Before | The last sale received before the gap |
| Sale After, Date After | The first sale received after it |

### Filters
| Filter | Description |
|---|---|
| Till User | One till only |
| Gaps Found Since | Only gaps whose later sale was on or after this date |

### Reading a Gap
A gap is a sale paid at the till that has not arrived. It may be:
- **Still waiting** on a till that has not synced. It closes when the till syncs
- **Refused** by ERPNext and still on the till, listed in its unsynced-sales panel
- **Removed** from the till before it synced. A gap that stays after the till has synced and has nothing waiting is the one to ask about

A gap shows once a later sale from the same till arrives.

---

## Tips

- Give each till **its own API user** (see [Desktop Till](29-desktop-till.md)): the key is kept per till user, so tills sharing one would flag each other's sales
- Review **Missing Till Sales** with the closing shifts: a gap that outlives the shift close needs an answer
- Keep the till PC's Windows and MariaDB passwords with the administrator, not the shop floor
