# Installing the desktop app on a Windows PC

For trying out a build on one PC. The installer is not signed yet and does not
include the database, so a PC needs MariaDB set up first.

## 1. Get the installer

Open the **Build Desktop App** workflow run in GitHub Actions and download the
`xpos-<version>-Windows` artifact. It contains `X POS-<version>-Setup.exe`.

## 2. Install MariaDB

The app keeps its items, customers and unsynced sales in a local MariaDB.

1. Download **MariaDB Server 11.8** (Windows x86_64, MSI) from mariadb.org and
   run it. Set a root password, keep port **3306**, and leave "Install as
   service" ticked so it starts with Windows.
2. Open **MySQL Client (MariaDB 11.8)** from the Start menu, sign in as root,
   and create the app's user. Choose your own password:

   ```sql
   CREATE USER 'xpos'@'localhost' IDENTIFIED BY 'choose-a-password';
   GRANT ALL PRIVILEGES ON xpos_local.* TO 'xpos'@'localhost';
   ```

   The app creates the `xpos_local` database and its tables itself on first start.

## 3. Get an API key from ERPNext

The app syncs with ERPNext using one API key per PC.

1. In ERPNext, open the user the PC will sync as. It must be listed on the
   POS Profile the till uses.
2. **Settings → API Access → Generate Keys**. Copy the key and the secret; the
   secret is shown only once.

## 4. Install and set up the app

1. Run `X POS-<version>-Setup.exe`. Windows SmartScreen warns that the app is
   unrecognised because it is not signed yet: **More info → Run anyway**.
2. The setup wizard opens:
   - **Role:** Hub, for a single till.
   - **Database:** host `127.0.0.1`, port `3306`, user `xpos`, the password
     from step 2, database `xpos_local`. **Test** must pass before you continue.
   - **Server:** the ERPNext address (`https://…`), and the API key and secret
     from step 3.
   - Finish the last step.
3. Sign in with an ERPNext user assigned to the POS Profile. The first sign-in
   must be online.
4. In **Settings**:
   - **Receipt Printer:** choose the receipt printer and press **Test Print**.
     Receipts then print with no print dialog.
   - **Startup:** "Open X POS when this PC starts" is on by default.

## Where things are

| | |
|---|---|
| App data and settings | `%APPDATA%\X POS` |
| Logs | `%APPDATA%\X POS\logs` |
| Database connection | `%APPDATA%\X POS\db-config.json` |

Only one copy of the app runs at a time: starting it again brings the open
window to the front.
