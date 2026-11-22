# Trusted browsers and offline sign-in

Open an authenticated workspace and choose **Enable offline editing on this device** on a browser profile only you control. Repeat for each workspace you need offline. Wait for **Offline editing enabled on this device** before disconnecting. The application installs its public shell and writes the first authorized workspace snapshot in one IndexedDB transaction with its device binding. Browser privacy restrictions, storage errors or a failed shell installation can prevent enrollment. The signed-in application remains available online.

Reopen `/app/` in the same browser profile to use the last selected, enrolled workspace during an outage. Its saved grant must still be valid. Selecting a workspace without enrollment clears the offline startup selection. The local working data, pending edits, file bytes and acknowledgements belong to one account and workspace. Offline access uses the signed workspace grant and its expiry. Credentials and CSRF tokens come from the live login when reconnecting.

Offline sessions learn about permission changes when the browser reconnects. A confirmed revocation or role change removes that workspace's cached records and pending edits. If the login has expired, sign in again as the same account to recover work still covered by its membership. Signing into another account clears the prior account's private storage first.

Use **Forget offline workspace** to remove just the current workspace’s local data, including any queued changes or staged files. Confirm with **Remove offline data**. The server copy and other offline workspaces are retained.

Choose **Sign out** to clear the account's offline data on this browser. With queued edits, keep the workspace open to sync, discard the changes and sign out, or cancel. A sign-out while disconnected immediately clears local data and records that the old login cookie needs to be signed out on reconnect. Other open tabs lock their private interface. Each subsequent local write checks its original account and device binding inside the database transaction.

Private workspace contents and attachments reside in IndexedDB. Service Worker Cache Storage holds the public application shell and its assets. Clearing browser site data removes pending edits and the offline installation. The server's PostgreSQL data and operational backups have their own recovery procedure. [Operations](OPERATIONS.md)
