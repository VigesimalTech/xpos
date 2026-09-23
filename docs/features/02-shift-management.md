# Shift Management

X POS uses a shift-based workflow. Every POS session starts with opening a shift and ends with closing it. Shifts provide accountability, cash reconciliation, and transaction tracking.

---

## Opening a Shift

### Automatic Session Check
- When you open X POS, the app automatically checks if you already have an **open shift**
- If a shift is found, it resumes your session immediately with all settings loaded
- If no shift is found, the **Opening Dialog** appears

### Opening Dialog
1. **Select POS Profile** — Choose from available POS Profiles assigned to your user account
   - Only profiles you are listed on are offered, on the web POS and the desktop till alike
   - If only one profile is available, it is auto-selected
   - The company name auto-fills based on the selected profile
2. **Enter Opening Balances** — For each payment method (Cash, Card, Bank Transfer, etc.), enter the starting cash/balance amount
   - Cash amount typically reflects the float (starting cash in the register)
   - Other payment modes can have zero opening balances
3. **Click "Open Shift"** — This creates a POS Opening Shift document and initializes the POS session

### What Happens on Shift Open
- A **POS Opening Shift** document is created and submitted
- The POS loads all configuration from the selected POS Profile:
  - Payment methods, tax templates, print settings
  - Stock settings, warehouse assignments
  - Feature flags (returns, discounts, offline mode, etc.)
- If offline mode is enabled, items, customers, and stock data are pre-cached
- On the desktop till, the shift is priced with the POS Profile's taxes, tax-inclusive setting and rounding, as ERPNext prices it
- On the desktop till, your role and discount limit are the ones on the **profile of the open shift**, if you are on several

### After a Restart
- On the desktop till, a restart (or a power cut) signs the last cashier back in and returns to the open shift
- The opening dialog does not reappear, and nothing typed into it is lost

---

## During a Shift

- All invoices created during the shift are linked to the POS Opening Shift
- The shift tracks:
  - Total number of invoices
  - Grand total and net total of all sales
  - Returns count and amounts
  - Payment method breakdowns
  - Tax summaries

---

## Closing a Shift

### Shift Summary Preview
Before closing, you can review a complete summary of the shift:
- **Total invoices** processed
- **Grand total** of all sales
- **Net total** (excluding taxes)
- **Returns count** and return amounts
- **Tax breakdown** by tax account (account head, rate, total amount)
- **Payment breakdown** by mode of payment

### Closing Dialog
1. The dialog shows a **payment reconciliation table** with columns:
   - **Payment Method** — Each mode of payment used during the shift
   - **Opening Amount** — Balance entered at shift start
   - **Expected Amount** — System-calculated amount based on invoices
   - **Closing Amount** — The actual amount you count and enter
   - **Difference** — Calculated surplus or shortage (over/short)
2. Enter the **actual closing amounts** for each payment method
3. Review any discrepancies between expected and actual amounts
4. Click **Close Shift** to finalize
- Closing needs the **Close Shift** role permission. On the desktop till, a cashier without it can close with a manager's approval, recorded as **Approved By** on the POS Closing Shift (see [Cashier Rights & Manager Approval](30-cashier-rights-approval.md))
- After closing, you can **Print** the close summary: the counted amounts against what was expected

### What Happens on Shift Close
- A **POS Closing Shift** document is created with:
  - All invoices linked as child records (Sales Invoice Reference table)
  - Payment reconciliation details
  - Tax summary breakdown
  - Shift period (start/end times)
- The POS Opening Shift status changes from "Open" to "Closed"
- All POS state is reset
- The Opening Dialog reappears for the next shift

---

## Closing a Shift on the Desktop Till

The [Desktop Till](29-desktop-till.md) closes a shift from its own records, so closing works offline.

### How It Works
1. The till sums the shift from its own sales and cash movements: the float, payments net of change, each tender in its own currency, less expenses and bank drops
2. You enter the counted amounts and close, as on the web POS
3. The till keeps the close and sends it to ERPNext **after** the shift's sales and cash movements have arrived
4. ERPNext builds the POS Closing Shift from its own records, taking only the counted amounts from the till

### Sales Still Waiting to Sync
- If some of the shift's sales or cash movements have not reached ERPNext yet, the Close Shift dialog says how many before you close
- Nothing is lost: they sync when the till is back online, and the close follows them

### Sales ERPNext Refused
- A sale ERPNext refused (for example, in a closed accounting period) was paid at the till but is not in ERPNext
- The close dialog lists these sales separately, with their total, and warns that ERPNext will show the close **over** by that amount
- ERPNext adds a comment to the POS Closing Shift listing each refused sale, its reason and amount, for a manager to settle

### Several Tills

<!-- audience: supervisor -->
- Each till's shifts carry their own ID, so two tills on the same POS Profile never have their shifts or sales mixed up

---

## Tips

- Always reconcile cash carefully before closing the shift — discrepancies are recorded permanently
- If you need to leave temporarily, you can hold orders and return to the same shift later
- The shift closing document serves as a complete audit trail for the POS session
- Multiple users can have separate open shifts on different POS Profiles simultaneously
- On a desktop till, check the Close Shift dialog for sales still waiting or refused before you count the drawer
