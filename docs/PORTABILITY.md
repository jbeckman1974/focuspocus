# Moving and sharing workspace data

Open the signed-in workspace and choose **Workspace tools**. Use synthetic tasks until the development warning has been removed. The private workspace belongs to one account. Create a shared workspace when other people need access.

## Import a source file

An owner can stage TaskPaper or CSV from **Import**. Supply a file up to 512 KiB with at most 2,000 rows. The preview lists recognized fields, conversions, omitted values and invalid rows. Inspect the hierarchy, dates, repeat projections, source identities and lost fields before committing. A staged file can be discarded without changing tasks.

Keep the original file and its source IDs. Retrying an acknowledged commit uses its original operation identity. If the workspace changed since the preview, refresh the comparison before trying again. Rollback checks the imported rows, sibling order and references created after the import. A conflict leaves the affected work in place for inspection.

## Export or restore

The workspace owner can download a readable CSV, or a complete versioned ZIP bundle for restoration. CSV shows the active outline in manual order and includes plain-text notes. Text that could be interpreted as a spreadsheet formula receives a leading apostrophe. The ZIP preserves the original text, relationships, shelves, dates, repeats, review state, history and attachment bytes.

The Sorbet pilot writes version 2 ZIP bundles, which also preserve a task's in-progress marker. It can restore version 1 bundles, assigning the original tasks their existing completion state with no in-progress marker.

Restore creates a **new owned workspace**. It checks the manifest, record lengths, relationships and file hashes before committing. An owner can include their personal workspace settings and explicitly choose whether to apply account-wide preferences. The initial format supports 64 MiB of record metadata and up to 12,000 distinct attachments, subject to the configured attachment quotas. Keep the original bundle until the restored contents have been compared.

An operator's PostgreSQL backup separately recovers accounts, memberships, job state and service operation. After an operational restore, the database fence invalidates browser sessions and holds external deliveries for reconciliation. [Backup and restore procedures](OPERATIONS.md)

## Invite a member

Create a shared workspace, choose **Sharing**, name the existing account and select an editor or viewer role. Give the one-time invitation to the recipient privately. The recipient signs into that account and accepts the invitation. The owner can change the role or revoke access. Members share task edits and project review state. Each member has personal reminders, saved views and display preferences.

Capture credentials allow a specific account to add items to one workspace's Inbox. Copy a newly generated credential once and keep it in the calling application's secret store. Revoke it in the same workspace when the integration is retired. The capture API checks the grant and current write role on every use, including retries.
