# Workspace snapshots and offline replay

A trusted device opens a workspace through the ordinary authenticated snapshot route. Its `offlineGrant` contains an opaque UUID in `id`, integer protocol version `1` and an `expiresAt` timestamp in UTC. The snapshot also includes the recovery `generation`, workspace revision, signed write context, signed change cursor and the account's `focusScopeIds`. An empty list means unrestricted outline focus. A configured root that disappeared still limits the visible view to its remaining descendants. Another member's focus is independent.

A grant remains stable across refreshes and sign-ins by the same account while the same membership, role and recovery generation remain valid. A downgrade followed by a promotion issues a different grant. So does revocation followed by reinvitation. The current workspace membership is checked under the same workspace lock used by writes before a server returns a recorded acknowledgement. Each signed write context and cursor binds the protocol, principal, workspace, recovery generation and grant. The device keeps the original context, operation ID and preconditions for a sent write. Receipts return the committed revision and affected record versions.

| Server response | Client action |
| --- | --- |
| 401 | Lock the local workspace and reauthenticate the same account before reconciliation. |
| 403 or 404 | Recheck the authenticated account and current membership. Clear revoked workspace data. A viewer can continue with authorized reads. |
| 409 or 412 | Preserve the base and draft. Compare with the authorized current state before creating a replacement operation. |
| 410 | Obtain a fresh authorized snapshot. Reconcile outstanding work explicitly when the grant, protocol, context, cursor or generation has expired or changed. |
 
A device may retain trusted access up to the snapshot's advertised expiry. Online operations always require an active session. Signing out sends the expected actor ID so a delayed request from an offline tab cannot end a different user's new session. Browser storage is cleared as part of the trusted-device logout.

## Retention and restore

The server retains detailed sync receipts and change rows for 90 days from commit. The worker prunes bounded batches, ordered by indexed timestamps, while skipping busy workspaces. An operator can also run one batch with `python manage.py prune_sync_history --batch-size 100` in the application container. If a page crosses a pruned revision, the changes endpoint returns 410 and requires a snapshot.

Before removing a detailed journal, pruning saves the portable history entry with its original timestamp, command name and item IDs. Recurrences, trash, imported records and restored history have independent lifetimes. A scoped Inbox credential can renew its context. Its compact operation acknowledgement survives until the credential is revoked to prevent an old request from creating a second task.

An operational SQL restore rotates workspace generations and invalidates sessions before web and worker start. A portable bundle restore creates a different workspace with fresh access. Both events require new grants. A browser holding an uncertain operation must compare the recovered state before issuing another write. [Recovery procedure](OPERATIONS.md)
