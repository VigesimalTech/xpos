# POS Profile Configuration

The POS Profile is the central configuration hub for X POS. It controls every aspect of the POS behavior — from item display to payments, permissions, and advanced features.

---

## View & Display Settings

| Setting | Description |
|---|---|
| Default View | Default item display mode: Card (grid) or List |
| Display Item Code | Show item codes in the POS interface |
| Display Additional Notes | Show notes input per line item and order |
| Input Qty | Enable manual quantity input mode |
| Hide Variants Items | Hide individual variant items in the grid |
| Show Template Items | Show template (parent) items in the grid |
| Hide Expected Amount | Hide expected amounts in the closing dialog |
| Hide Closing Shift | Hide the close shift button |
| Hide Images | Hide item images (text-only display) |
| Hide Unavailable Items | Hide items with zero stock |

---

## Pricing & Discounts

| Setting | Description |
|---|---|
| Tax Inclusive | Item prices include tax |
| Max Discount Percentage Allowed | Maximum discount anyone on this profile may give. 0 means no discount, 100 means no cap. The lower of this and the cashier's **Discount Limit** applies |
| Allow User to Edit Rate | Allow editing item rates in the cart. Off: no price field is offered and ERPNext flags any changed price, whatever the role. On: the role's **Change Price** permission decides |
| Allow User to Edit Discount | Allow editing item-level discounts. Off: no line discount is offered and ERPNext flags one, whatever the role. On (default): the role's **Edit Discount Field** permission decides |
| Apply Customer Discount | Auto-apply customer-stored discount |
| Force Price from Customer Price List | Force prices from customer's assigned price list (default on) |
| Allow Zero Rated Items | Allow items with zero price |

A discount on the whole order has no profile switch: the role's **Apply Additional Discount** permission decides (see [Cashier Rights & Manager Approval](30-cashier-rights-approval.md)).

---

## Offers, Coupons & Referrals

| Setting | Description |
|---|---|
| Auto Fetch Coupons Gifts | Enable coupon entry and automatic cart-offer refresh |

---

## Delivery

| Setting | Description |
|---|---|
| Use Delivery Charges | Enable delivery charges feature |
| Auto Set Delivery Charges | Auto-apply delivery charges |

---

## Sales & Invoicing

| Setting | Description |
|---|---|
| Allow Credit Sale | Allow sales on credit (no payment required) |
| Allow Change Posting Date | Allow backdating invoices |
| Allow Return | Enable the return feature |
| Allow Return Without Invoice | Allow returns without original invoice |
| Allow Free Batch Return | Allow returning to any batch |
| Enable Return Validity | Enforce a return time window |
| Return Validity Days | Days allowed for returns after purchase |
| Allow Delete Offline Invoice | Allow manual delete and clear actions in the offline invoices panel |
| Allow Delete Draft Invoices | Delete the shift's remaining draft invoices when the shift closes (default on) |
| Allow Multi Currency | Enable multi-currency transactions |
| Block Sale Beyond Available Qty | Prevent selling beyond available stock, in the item grid, the cart and on the server. Unset counts as on. Stock Settings' negative stock overrides it |
| Enable Cashier Settlement | Create unsettled bills at the terminal for a cashier to settle later (see [Cashier Settlement](26-cashier-settlement.md)) |
| Print Backup Receipt | Print a non-genuine backup receipt at the terminal when a bill is sent to the cashier |
| Allow Open Tab Recall | Let a cashier pull draft invoices raised on any shift of this profile, not just their own. Also needs the *Recall Other Shifts' Tabs* role permission (see [Open Tabs](27-open-tabs.md)) |
| Allow Outstanding Settlement | Let a cashier collect payment against past submitted invoices that still carry a balance. Also needs the *Settle Outstanding Invoice* role permission (see [Open Tabs](27-open-tabs.md)) |

---

## Payments

| Setting | Description |
|---|---|
| Allow Partial Payment | Allow submitting with partial payment |
| Use POS Payments | Use X POS payment handling |
| Allow Make New Payments | Create new payment entries |
| Allow Reconcile Payments | Enable payment reconciliation |
| Use Cashback | Enable cashback feature |
| Use Customer Credit | Allow payment via customer credit |
| Allow Write Off Change | Allow small write-off amounts |
| Cash Mode of Payment | Default cash payment mode |

---

## Cash Movement

| Setting | Description |
|---|---|
| Enable Cash Movement | Enable cash deposit/expense feature |
| Allow Cash Deposit | Allow cash deposits |
| Allow POS Expense | Allow POS expenses |
| Allow Cancel Submitted Cash Movement | Allow cancelling submitted movements |
| Allow Delete Cancelled Cash Movement | Allow deleting cancelled movements |
| Require Cash Movement Remarks | Require remarks on movements |
| Cash Movement Max Amount | Maximum amount per movement, checked when it is entered |
| Cash Out Within the Drawer | An expense or deposit may not be more than the cash the POS expects in the drawer (default on). Off: only Cash Movement Max Amount limits it |
| Default POS Expense Account | Default expense account |
| Default Source Account | Default source (cash) account |
| Back Office Cash Account | Back-office deposit account |
| Allow Source Account Override | Allow changing the source account |
| Allowed Source Accounts | List of allowed source accounts |
| Allowed Expense Accounts | List of allowed expense accounts |

---

## Purchasing

| Setting | Description |
|---|---|
| Allow Purchasing | Purchase Orders, Purchase Invoices and Stock Receiving in X POS (default off). Off: hidden from everyone on this profile, whatever their POS Role allows |
| Allow Purchase Order | Create Purchase Orders from POS |
| Allow Purchase Receipt | Create Purchase Receipts from POS |
| Allow Create Purchase Suppliers | Create new suppliers from POS |
| Allow Create Purchase Items | Create new items from POS |

---

## Cashier Rights & Approval

See [Cashier Rights & Manager Approval](30-cashier-rights-approval.md) for how these work together.

| Setting | Description |
|---|---|
| Sale Outside Policy | What ERPNext does with a sale beyond the cashier's rights. **Flag** (default) books it and lists why on the invoice. **Reject** refuses a sale being made on the web POS; a sale already paid at a till is booked and flagged |
| Allow Self-Approval | Let a user who holds **Approve Exceptions** approve their own exceptions on the till. Off: someone else must enter their PIN |
| Screens the Role Lacks | What a cashier sees of Reports, the Barcode Printer, the Price Checker or Purchasing when their role lacks it. **Hide** (default) takes it out of menus, shortcuts and search. **Show, Ask a Manager** keeps it and opens it with a manager's PIN on the till |

---

## Search & Performance

| Setting | Description |
|---|---|
| Auto Set Batch | Auto-assign first available batch |
| Use Server Cache | Enable server-side item caching |
| Server Cache Duration (Minutes) | Server cache TTL in minutes |
| Use Offline Mode | Enable offline POS mode |

Item search is configured site-wide, in **POS Settings**, not per profile (see below).

---

## Site-Wide Settings (POS Settings)

Some settings apply to every POS Profile on the site. They live in ERPNext's **POS Settings**:

| Setting | Description |
|---|---|
| Item Search Limit | Max items returned per search (default 20). Applies only when the cashier has typed a search term |
| Search Serial No | When a scanned or typed value is not a barcode or item code, also look it up as a Serial No |
| Search Batch No | When a scanned or typed value is not a barcode or item code, also look it up as a Batch No |
| Invoice Type Created via POS Screen | Sales Invoice or POS Invoice |
| Create Ledger Entries for Change Amount | Must stay on for sales that give change to post. X POS turns it on when it is installed or upgraded |

---

## Submission & Data

| Setting | Description |
|---|---|
| Allow Submissions in Background Job | Submit invoices asynchronously |
| Allow Duplicate Customer Names | Allow duplicate customer names |

---

## Print & Formatting

| Setting | Description |
|---|---|
| Default Print Format | Default receipt/print format for the POS profile |
| Print Format Rules | Conditional print format rules |
| Print Discount Amount | On receipts, show percentage-based discounts as currency amounts instead of percent labels (default on) |
| Allowed Sales Persons | Restrict available sales persons |

---

## Standard POS Profile Fields

In addition to the X POS settings, the standard POS Profile provides:

| Setting | Description |
|---|---|
| Warehouse | Default selling warehouse |
| Company | Associated company |
| Price List | Default selling price list |
| Customer Groups | Allowed customer groups |
| Income Account | Default income account |
| Cost Center | Default cost center |
| Write Off Account | Account for write-offs |
| Payment Methods | Table of allowed payment modes |
| Taxes and Charges | Sales Taxes and Charges template |
| Item Groups | Restrict to specific item groups |
| Print Format | Default print format |
| Letter Head | Company letter head for printing |

---

## User Access (Applicable for Users)

The **Applicable for Users** table assigns users to the POS Profile. X POS adds these fields to each row:

| Field | Description |
|---|---|
| POS Role | The POS Role that sets what this user may do on this profile. See [Cashier Rights & Manager Approval](30-cashier-rights-approval.md) |
| Is Cashier | Allows this user to open the Cashier screen and settle bills. See [Cashier Settlement](26-cashier-settlement.md). |
| Discount Limit | The most discount this user may give without a manager, as a percentage of the list price. 0 means none (new rows start at 0), 100 means no cap. The profile's maximum applies above it |
| Set Till PIN | 4 to 6 digits for signing in on the desktop till. Stored only as a hash; leave empty to keep the current PIN. See [Desktop Till](29-desktop-till.md) |
| Till PIN Set | Read-only. Shows that the user has a till PIN |

A user can be on several POS Profiles, with a different role, limit and PIN on each. The desktop till applies the row for the profile of the open shift.

---

## Configuration Tips

- Start with a minimal configuration and enable features as needed
- Test each new setting in a staging environment before enabling in production
- Use the "Allow" settings to control which operations POS operators can perform
- Configure proper accounts (expense, source, back-office) for cash movements
- Set reasonable limits on discount percentages and cash movement amounts to prevent errors
- Give each cashier a **Discount Limit** and a **Till PIN** on their row before they use a desktop till
- Enable "Use Offline Mode" for locations with unreliable connectivity
- Use "Background Submissions" for high-traffic POS stations to speed up checkout
