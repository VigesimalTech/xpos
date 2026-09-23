# Desktop Till

X POS also runs as an installed desktop app (Electron) for shop tills. It shares its screens with the web POS, but keeps its own local database, so a till sells, prints and closes shifts whether or not ERPNext can be reached.

---

## Overview

The desktop till:
- Keeps items, customers, stock, cashiers and unsynced sales in a **local MariaDB** on the PC
- Signs cashiers in with a **4 to 6 digit PIN**, offline
- Prints receipts **silently** to a chosen receipt printer
- Sends sales, shifts, cash movements and audit events to ERPNext through a **sync engine** that runs in the background
- Asks for a **manager's PIN** for anything the cashier's role does not allow, instead of hiding it (see [Cashier Rights & Manager Approval](30-cashier-rights-approval.md))

The web POS at `/xpos` is unchanged and can be used alongside it.

---

## Installing and Setting Up

<!-- audience: administrator -->

Installing the app on a Windows PC, including MariaDB and the API key, is covered step by step in [Installing the desktop app](../desktop-install.md).

### Setup Wizard
On first start, the setup wizard asks for:
1. **Role** — **Hub** for a single till
2. **Database** — The local MariaDB connection. **Test** must pass before you continue
3. **Server** — The ERPNext address and the till's **API key and secret**
4. **Complete Setup** — The app fetches the POS Profile's cashiers from ERPNext, so the till can be signed in to at once

### One API User per Till
- Each till syncs as its own ERPNext user, through its API key
- Assign that user to the shop's POS Profile. The till then receives **only that shop's cashiers**
- An API user on no POS Profile (an admin or integration key) receives every POS Profile's cashiers
- The till's API user is never recorded as the one who made a sale: every request names the **cashier signed in** on the till, and ERPNext checks that cashier's rights, not the till's

### No Local Admin Account
- Only ERPNext users on the POS Profile can sign in on a till
- There is no account that exists only on the till, so every sale names a real ERPNext user

---

## Signing In with a PIN

### Setting a PIN

<!-- audience: administrator -->
1. Open the POS Profile in ERPNext
2. In the **Applicable for Users** table, open the cashier's row
3. Enter **4 to 6 digits** in **Set Till PIN** and save
- The PIN is stored only as a hash. The field is cleared on save, and **Till PIN Set** shows that one exists
- Leave the field empty to keep the current PIN
- The till receives the new PIN on its next sync

### At the Till
- When any cashier has a PIN, the sign-in screen opens on **"Who is signing in?"** with the cashiers' names
- Tap your name, then enter your PIN on the PIN pad (number keys, Backspace and Enter work too)
- **Use password instead** opens the email and password form
- PIN sign-in works fully offline

### Password Sign-In
- A cashier without a PIN signs in with their ERPNext email and password
- The till checks the password with ERPNext the first time, so it must be online then. After that it works offline

### Lockout
- **Five wrong PINs** lock that cashier out of PIN sign-in for **five minutes**
- A correct PIN resets the count
- Sign-in and manager approvals share the same count
- Wrong PINs are recorded in the [Audit Log](31-audit-log.md)

### Cashiers Leaving
- A cashier **disabled** in ERPNext cannot sign in on the till, even with a cached password
- A cashier **removed** from the POS Profile is removed from the till within a few sync cycles

---

## Opening a Shift on the Till

- The shift dialog offers only the POS Profiles the signed-in cashier is on
- A cashier on several profiles has a separate role, discount limit and PIN on each. The till applies the ones for the **profile of the open shift**
- The shift is priced with the POS Profile's taxes, tax-inclusive setting and rounding, as ERPNext prices it
- After a restart, the till signs the last cashier back in and returns to the **open shift**

See [Shift Management](02-shift-management.md) for closing a shift on the till.

---

## Receipt Printing

- Receipts print **without a print dialog** to the printer chosen in **Settings → Receipt Printer**
- **Test Print** checks the printer
- With no printer chosen, the operating system's default printer is used
- If a receipt does not print, the cashier is told why. The sale is saved either way
- Reports keep the print dialog, since page and orientation matter there

See [Printing & Receipts](15-printing-receipts.md).

---

## The Sync Engine

The sync engine runs in the background and sends the till's records to ERPNext in order: opening shifts, sales, expenses and bank drops, closing shifts, then audit events. It also pulls items, prices, stock, customers, cashiers and POS Profile settings.

### Exactly Once
- Every record carries its own ID, so a record sent twice (after a lost answer, a crash or a power cut) is booked **once** in ERPNext
- Records left half-sent by a crash are sent again when the app next starts
- Purchase orders are deduplicated in the same way

### When ERPNext Does Not Answer
- A request ERPNext does not answer (no network, a timeout, a proxy error such as 502, 503 or 504) **never uses up a sale's tries**. The sale waits and is sent once ERPNext answers again
- Only an answer from ERPNext itself counts as a failed try. After three, the sale is set aside for review in the unsynced-sales panel
- Sync requests give up after **60 seconds**, and screen requests after **30 seconds**, so a dead link never freezes the till

### Sync Status Pill
| Pill | Meaning |
|---|---|
| **Synced {time}** | ERPNext is answering, and the last sync finished at that time |
| **Syncing** | A sync is running |
| **Offline – N sales waiting** (amber) | ERPNext is not answering. Sales are kept on the till and sent when it is back. Held orders are not counted |
| **N need attention** | Sales ERPNext refused. Click to open the unsynced-sales panel, review, and requeue |

Selling offline is normal on a till. Waiting sales are not errors.

### When ERPNext Is Out of Reach
- Screens that need ERPNext (reports, adding a customer, looking up a return) say **"ERPNext is not reachable. This needs ERPNext: try again once the till is back online."**
- Stock shown in the item grid refreshes after each sync, with no restart

---

## Starting Up

### Open at Login
- The installed app opens when the PC starts, so a till is ready after a power cut
- Turn this off in **Settings → Startup**

### Only One Copy
- A second launch brings the running window to the front instead of starting another copy

### Waiting for the Database
- If the till starts before its local MariaDB, it shows **"Waiting for the local database"** and carries on to sign-in once the database answers
- A till that was set up never falls back to the setup wizard because its database was slow to start

---

## Differences from the Web POS

| Feature | Web POS | Desktop Till |
|---|---|---|
| Sign-in | Email and password | PIN or password, offline |
| Actions the role lacks | Hidden or refused | Shown, and open with a manager's PIN |
| Held orders | Drafts in ERPNext | Kept on the till, never sent to ERPNext |
| Shift close | Needs ERPNext | Works offline, synced later |
| Receipts | Browser print | Silent print to the receipt printer |
| Removing items | Needs the role's permission | Needs the role's permission, or a manager's PIN |
| Audit log | Removals and reprints, sent to ERPNext | Everything, including approvals and wrong PINs, sent to ERPNext |

---

## Tips

<!-- audience: administrator -->

- Give each till its own API user, and assign it to that shop's POS Profile only
- Set PINs for every cashier before go-live, so no one needs a password at the till
- Choose the receipt printer and press **Test Print** before the first shift
- An amber pill is not a fault. Check the unsynced-sales panel only when it says **need attention**
- Leave "Open X POS when this PC starts" on, so a till recovers from a power cut without help
