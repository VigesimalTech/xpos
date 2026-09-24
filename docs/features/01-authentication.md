# Authentication & Login

X POS provides a dedicated login experience separate from the standard Frappe desk, designed for cashiers and POS operators.

---

## Login Screen

- Navigate to `/xpos/login` to access the POS login page
- Enter your **email/username** and **password**
- Click **Login** to authenticate
- A **show/hide password** toggle is available for convenience

## Session Persistence

- If you are already logged into Frappe, X POS automatically detects your active session
- When an active session is found, you are redirected directly to the POS screen without needing to re-enter credentials
- The system checks your session status on every app load via `frappe.auth.get_logged_user`
- If that check cannot reach the server (for example, reloading the page while offline), the last session the server confirmed is restored, so you can keep selling
- The remembered session is forgotten on logout, and as soon as the server reports that the session has ended

## Desktop Till Sign-In

On the [Desktop Till](29-desktop-till.md), cashiers sign in differently:
- When any cashier has a PIN, the sign-in screen opens on **"Who is signing in?"**. Tap your name, then enter your **4 to 6 digit PIN**
- **Use password instead** opens the email and password form
- PIN sign-in works offline. Password sign-in needs ERPNext the first time only
- **Five wrong PINs** lock that cashier out of PIN sign-in for **five minutes**
- A till left idle locks itself and asks the same cashier's PIN to go on. See [Idle Lock](29-desktop-till.md#idle-lock)
- Only ERPNext users on the till's POS Profile can sign in. There is no local admin account
- A cashier disabled in ERPNext, or removed from the POS Profile, can no longer sign in on the till

### Setting a Cashier's PIN

<!-- audience: administrator -->
1. Open the POS Profile in ERPNext
2. In the **Applicable for Users** table, open the cashier's row
3. Enter 4 to 6 digits in **Set Till PIN** and save
- The PIN is stored only as a hash, and **Till PIN Set** shows that one exists
- Leave the field empty to keep the current PIN

## Password Reset

- Click the **"Forgot password?"** link on the login screen
- Enter your registered email address
- A password reset link will be sent to your email via Frappe's built-in reset mechanism
- Follow the link to set a new password, then return to X POS to log in

## Redirect After Login

- If you attempt to access a protected POS page (e.g., `/xpos/pos`) while logged out, you are redirected to the login page
- After successful login, you are automatically taken back to the page you originally tried to access
- This is handled via the `?redirect=` query parameter

## Logout

- Click the **Logout** button (available in the POS navigation bar)
- Your session is cleared and you are redirected to `/xpos/login`
- All local session data is removed

---

## Security Notes

<!-- audience: administrator -->

- Authentication uses standard Frappe session management with secure cookies
- POS access is controlled by Frappe user roles and POS Profile assignments
- Only users assigned to a POS Profile can open a shift and use the POS
- Role-based permissions restrict which operations each user can perform (see [Cashier Rights & Manager Approval](30-cashier-rights-approval.md))
- The page embeds the session's own CSRF token. If the token changes (for example, after opening the desk in another tab), X POS fetches the current one and retries the request once, so offline sales still sync
- On the desktop till, every request names the cashier signed in, and ERPNext checks that cashier's rights rather than the till's API user
