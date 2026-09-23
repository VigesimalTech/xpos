# Offline Mode

X POS includes a comprehensive offline-first architecture that allows full POS operation without internet connectivity, with intelligent data caching and automatic synchronization.

---

## Overview

When offline mode is enabled (`use_offline_mode` on POS Profile), X POS:
- Pre-caches all item, customer, stock, and configuration data to the browser's IndexedDB
- Continues to function fully when the internet connection is lost
- Queues invoices and purchases locally for later synchronization
- Automatically syncs all pending data when connectivity is restored

---

## Enabling Offline Mode

<!-- audience: administrator -->

1. Open your POS Profile settings
2. Enable the **Use Offline Mode** option
3. Save the profile
4. Next time a shift is opened, the pre-caching process begins

---

## Installing the Web POS as an App

- The web POS at `/xpos` is an installable app (PWA). Your browser offers to install it from the address bar
- Once installed, or after one online visit, a service worker keeps the POS pages cached, so the POS opens and reloads **with no connection**
- On the [Desktop Till](29-desktop-till.md), none of this applies: the till keeps its data in its own local database

---

## Data Pre-Caching

<!-- audience: supervisor -->

When a shift is opened with offline mode enabled, the following data is pre-loaded to your device:

### Items
- All items accessible by the POS Profile are batch-loaded (200 at a time)
- Cached data includes: item code, name, price, group, barcodes, images, tax templates
- Items are indexed for fast search by name, code, group, and barcode

### Stock Levels
- Stock availability for all items is fetched
- Cached per warehouse and item code

### Customers
- Up to 1,000 customers are pre-cached
- Indexed by name, phone, and email
- Supports offline customer search

### Item Groups
- Complete item group hierarchy is cached
- Both groups and parent groups are stored for filtering

### Configuration
- POS Profile settings (all feature flags and configurations)
- Tax templates (per item + company)
- Active offers and promotions
- Sync timestamps for incremental updates

---

## Local Database Structure

<!-- audience: administrator -->

The app stores offline data in your browser with dedicated storage for:

| Storage Area | Purpose |
|---|---|
| Items | Full item catalog |
| Item Groups | Item group hierarchy |
| Customers | Customer records |
| Suppliers | Supplier records |
| Pending Invoices | Queued invoices awaiting sync |
| Pending Purchases | Queued purchases awaiting sync |
| Stock Cache | Per-item stock levels |
| Meta | Configuration, timestamps, profiles |

---

## Offline Capabilities

### Item Browsing
- Items are served from the local IndexedDB cache
- Search by name, code, group, and barcode works offline
- Stock quantities reflect the last cached values
- Item groups filtering uses cached group data

### Barcode Scanning
- Barcode lookups fall back to the cached item database
- Supports item code matching and barcode field matching
- Scale barcodes are parsed locally

### Customer Search
- Customer search uses the cached customer list
- Search by name, mobile, and email works offline
- Limited to the pre-cached 1,000 customers

### Tax Calculation
- Item tax templates are cached per item + company
- Tax calculations run entirely in the browser
- No server round-trips needed

### Invoice Creation
- Full invoices are created and validated locally
- Saved to the `pendingInvoices` queue in IndexedDB
- Includes all data: items, customer, payments, discounts, taxes, offers

### Receipts
- Sales completed offline print their receipt from a cached layout (see [Printing & Receipts](15-printing-receipts.md))

### Reloading While Offline
- Reloading the page, or reopening the installed app, while offline keeps you signed in: the last session the server confirmed is restored
- The sale being rung up is saved as it changes and restored when the POS opens, for the same cashier on the same day
- A completed or cleared sale never comes back
- X POS asks the browser for persistent storage, so queued sales are not evicted when the disk is low

### Purchase Orders
- Purchase orders can be created offline
- Saved to the `pendingPurchases` queue
- Synced when connectivity returns

---

## Automatic Sync Engine

<!-- audience: supervisor -->

### Periodic Sync
- Every **5 minutes**, the system performs a background sync cycle:
  - Refreshes the item cache with any new/updated items
  - Refreshes the customer cache
  - Attempts to sync pending invoices

### Online/Offline Detection
- The app monitors network connectivity via browser events
- **Online event**: Triggers immediate sync of all pending data
- **Offline event**: Activates offline mode, shows toast notification
- Visual indicators show current connectivity status

### Sync Process for Invoices
1. Pending invoices are retrieved from IndexedDB
2. Status changes to "syncing"
3. Each invoice is submitted to the server via `create_invoice` API
4. On success: invoice is removed from the queue
5. On failure: status changes to "failed", error details are stored
6. Retry logic: up to **3 retries** per invoice

### Status Tracking
Pending invoices progress through states:
- **pending** — Awaiting sync
- **syncing** — Currently being submitted
- **failed** — Submission failed (with error details)

---

## Offline Pending Panel

A dedicated dialog for managing queued offline data.

### Accessing
- Click the **Offline Pending** indicator in the POS toolbar
- Shows the count of pending items

### Panel Features
- Lists all queued offline invoices with:
  - Customer name
  - Grand total amount
  - Status badge (pending/syncing/failed)
  - Item count
  - Payment methods used
- **Sync All** button — Attempts to sync all pending invoices immediately
- **Clear All** button — Removes all pending items when `Allow Delete Offline Invoice` is enabled
- Per-invoice actions:
  - **Retry** — Manually retry a failed invoice
  - **Delete** — Remove a specific pending invoice when `Allow Delete Offline Invoice` is enabled
  - **Load to Cart** — Reopens an offline draft in the cart for editing/resubmission

### Status Indicators
- **"Online"** — Connected and synced
- **"Offline"** — No internet connection
- **"Syncing..."** — Sync in progress
- **"{N} pending"** — Number of invoices awaiting sync

---

## Offline → Online Transition

When connectivity returns:
1. The app detects the network change event
2. A toast notification appears: "Connection restored"
3. Automatic sync begins for all pending invoices
4. Items and customers are refreshed in the background
5. Stock levels are updated to current values
6. The status indicator changes to "Online"

---

## Limitations in Offline Mode

| Feature | Offline Behavior |
|---|---|
| Customer creation | Not available offline (use pre-cached customers) |
| Stock updates | Uses cached stock levels (may not reflect latest) |
| Pricing changes | Uses cached prices (server price changes won't appear until sync) |
| Offers/promotions | Uses cached offers (new offers won't appear until sync) |
| External payment verification | Requires connectivity |
| Order history | Only online orders visible in history |
| Shift closing | Requires connectivity to close the shift (the desktop till closes offline) |

---

## Offline on the Desktop Till

The [Desktop Till](29-desktop-till.md) is built to sell offline. Its behavior differs from the web POS:

| | Web POS | Desktop Till |
|---|---|---|
| Local storage | Browser (IndexedDB) | Local MariaDB on the PC |
| Sync | Every 5 minutes, and when the connection returns | Background sync engine, continuously |
| Retries | Up to 3 per invoice | Only an answer from ERPNext counts as a try. If ERPNext does not answer, the sale waits |
| Status | "{N} pending" | **Offline – N sales waiting** (amber) |
| Shift close | Needs connectivity | Works offline, sent after the shift's sales |
| Held orders | Drafts in ERPNext | Kept on the till |
| Crash mid-sync | — | Half-sent records are sent again at start, and booked once |

- Only an answer from ERPNext itself counts as a failed try. After three, the sale shows under **need attention** in the unsynced-sales panel, where it can be reviewed and requeued
- On the till, **Retry** and **Requeue** in the panel hand the sale back to the sync engine; the panel never deletes the till's own records of synced sales

---

## Tips

- Enable offline mode for stores with unreliable internet connectivity
- Pre-caching occurs at shift open — expect a brief loading period for large catalogs
- Monitor the pending panel during the day to ensure invoices are syncing properly
- Failed invoices can be retried manually — check error details for troubleshooting
- Stock levels in offline mode are approximate; consider this for stock-critical businesses
- The 5-minute sync interval keeps data reasonably fresh without excessive bandwidth use
