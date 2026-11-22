# Trusted browsers and offline sign-in

Open an authenticated workspace and choose **Enable offline editing on this device** on a browser profile only you control. Repeat for each workspace you need offline. Wait for **Offline editing enabled on this device** before disconnecting. The application installs its public shell and writes the first authorized workspace snapshot in one IndexedDB transaction with its device binding. Browser privacy restrictions, storage errors or a failed shell installation can prevent enrollment. The signed-in application remains available online.

Reopen `/app/` in the same browser profile to use the last selected, enrolled workspace during an outage. Its saved grant must still be valid. Selecting a workspace without enrollment clears the offline startup selection. The local working data, pending edits, file bytes and acknowledgements belong to one account and workspace. Offline access uses the signed workspace grant and its expiry. Credentials and CSRF tokens come from the live login when reconnecting.

## Work offline and reconnect

Capture a task in the Inbox, then rename, group or move it using the usual outline controls. The **Offline changes** list shows which edits this browser has saved locally. You can reopen the browser with the same profile while disconnected. Availability and date filters use the last server evaluation. Calendar refreshes, workspace sharing, imports and exports require a connection.

Use **Notes and files** to stage a file. Wait for the local confirmation before closing the browser. On reconnect, the server checks the target, quota and checksum. An interrupted upload retries with the same file and operation identities. A storage error leaves the input available to retry.

Reconnect and open the workspace to sync. If another editor changed a target, compare the original values, your draft and the current server values under **Offline changes**. For a note, **Compare note versions** opens the three texts. Choose **Reapply change** to submit against the reviewed state or **Discard change** to remove that local edit. Dependent edits remain visible while the earlier change is unresolved. After an operator restores the database, review held drafts before reapplying them. [Workspace protocol](OFFLINE_PROTOCOL.md)

## Sign out or remove local data

Offline sessions learn about permission changes when the browser reconnects. A confirmed revocation or role change removes that workspace's cached records and pending edits. If the login has expired, sign in again as the same account to recover work still covered by its membership. Signing into another account clears the prior account's private storage first.

Use **Forget offline workspace** to remove just the current workspace’s local data, including any queued changes or staged files. Confirm with **Remove offline data**. The server copy and other offline workspaces are retained.

Choose **Sign out** to clear the account's offline data on this browser. With queued edits, keep the workspace open to sync, discard the changes and sign out, or cancel. A sign-out while disconnected immediately clears local data and records that the old login cookie needs to be signed out on reconnect. Other open tabs lock their private interface. Each subsequent local write checks its original account and device binding inside the database transaction.

Private workspace contents and attachments reside in IndexedDB. Service Worker Cache Storage holds the public application shell and its assets. Clearing browser site data removes pending edits and the offline installation. The server's PostgreSQL data and operational backups have their own recovery procedure. [Operations](OPERATIONS.md)
