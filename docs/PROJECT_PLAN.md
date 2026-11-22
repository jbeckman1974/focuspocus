# Self-hosted task application

Joe wants to capture a task at home, organize it at the office, and return to the same outline in another browser. The reference is native OmniFocus 4.10.1 on Mac, including Pro workflows. The product will have its own implementation, identity, and artwork.

**Status on November 22, 2026.** Milestones M0–M4 have merged, including Forecast, Review, saved perspectives and SQL attachments. M5 is testing import, restore, sharing and personal integrations. The private test-host procedure has passed native AMD64 CI. The physical Tumbleweed host, private release images and Joe’s pilot each have a separate acceptance gate. [Implementation progress](PROGRESS.md)

## Maintained specification

| When you need to… | Read |
| --- | --- |
| Choose a work package, identify its prerequisites, or decide whether a milestone can close | This plan |
| Look up any of the six owner outcomes, FR-01 through FR-20, a native source, a browser adaptation, or a pending observation | [Feature parity register](FEATURE_PARITY.md) |
| Design a data change, command, query, worker, screen, or reconnect path | [Architecture and contracts](ARCHITECTURE.md) |
| Set up a synthetic workspace, compare an outcome, check migration field coverage, or collect release evidence | [Verification plan](VERIFICATION_PLAN.md) |
| Prepare a local build, generate an identifiable image, update a host, or recover a database | [Operations](OPERATIONS.md) |
| Find an approved constraint, a provisional default, a setup fact, or the evidence needed to revisit a choice | [Decision log](DECISIONS.md) |

The supplied handoff and companion Word plan are retained locally. The six Markdown specifications are the maintained record of the approved direction. Use the requirement and acceptance IDs when filing work or recording results. [Implementation progress](PROGRESS.md)

## Scope and release boundaries

The six owner outcomes are familiar task behavior, Linux/Docker operation, local development backed by GitHub Actions builds, a rich desktop interface, SQL storage including file bytes, and private individual logins with deliberate sharing. Each has its own UR entry, linked features, and acceptance criteria in the [parity register](FEATURE_PARITY.md).

The full scope includes capture, nested outlines, project sequencing, tags, dates and repeats, standard and custom perspectives, review and focus, notes and files, preferences, and undo. It also includes online synchronization, shared workspaces, documented import with loss reporting, restorable exports, browser integrations, offline editing, and operational recovery. The server owns task rules across these workflows. Native-only integrations have named boundaries and browser alternatives in the parity register.

| Checkpoint | What Joe can use it for | Evidence needed |
| --- | --- | --- |
| M1 interaction prototype | Evaluate capture, organization, and editing with disposable examples | Complete the same workflow by keyboard and pointer and record where it slows him down. |
| M2 first persistent slice | Try the core outline with separate accounts in a local stack | Demonstrate isolation, persistence, acknowledged writes, conflict handling, and two-browser updates. |
| Online evaluation beta | Evaluate everyday private work after M2, M3 and selected M4 Forecast, Review, and search workflows | Pass the applicable rules, isolation, recurrence, and interaction scenarios. Keep an independent source copy. List every outstanding parity item. |
| M7 replacement-ready release | Rely on the application for the agreed workflows | Complete the M5 portability checks, M6 offline checks, restore and upgrade drills, and a daily-use pilot spanning a full review cycle. Verify every required item or record a specific owner-accepted exception. |

## Roadmap and dependencies

The packages below are independently reviewable changes. A prerequisite denotes a contract or working increment the next package needs. The integration lead owns the shared schema, command format, and milestone evidence. UI and service work can run concurrently once they agree on fixture examples and response shapes. Estimates below are focused engineering effort for the stated scope. Keep investigation time visible when an observed outcome changes a rule.

| Milestone | Packages and order of work | Exit gate |
| --- | --- | --- |
| **M0 · Behavioral specification** | **0A** freeze native baseline, owner outcomes, and platform boundaries. **0B** define fixture inventory, command shapes, ownership, and verification cases against 0A. **0C** assign native observations to the relevant rule or workflow owner. Record the result with the source version when a trial becomes possible. | Each requirement has delivery state, sources, dependencies, and acceptance IDs. Each unresolved observation has a trial and a consuming milestone. The written M0 deliverables are ready for M1. A native comparison stays open until someone runs it. |
| **M1 · Interaction prototype** | **1A** build the native ARM64 development container, four-pane shell, fixture reader and selectable outline from 0B. **1B** add in-memory capture, inline editing, grouped selection and inspector commands. **1C** connect move, alternate views, completion and undo to the same data. **1D** run the keyboard/pointer walkthrough with Joe. 1B and 1C can share 1A's command vocabulary. | From the Mac checkout, build the locked dependencies in the container and open the fixture app in the Mac browser. Native CI exercises both input methods, selection, expanded groups and scroll position. Joe’s Mac walkthrough and editing preferences are recorded when available. Record AT-01/16 and prototype portions of AT-24/28. |
| **M2 · Persistent foundation** | **2A** create the initial migration, local accounts, private workspaces and scoped reads. **2B** implement ordered capture/edit/move/complete/undo with operation receipts and expected versions after 2A. **2C** connect the M1 UI, committed changes, reconnect snapshots and worker. **2D** package web/worker and database in Compose, implement native AMD64 application and startup/migration tests in Actions, and assemble the two-platform GHCR release. **2E** exercise replacement, isolation and retries. | The walkthrough passes on the native ARM64 Mac stack. Release requires passing AMD64 checks and one version tag containing the tested `linux/amd64` and `linux/arm64` images. Record the M2 portions of AT-01/16/17/18/23/29/30/31. |
| **M3 · Task semantics** | **3A** enforce hierarchy lifecycle, manual order, project/group modes, statuses and tag rules on 2B. **3B** implement direct/effective dates, duration, timezone intent, and evaluation with 3A. **3C** add series, occurrences, catch-up, completion, skipping, and compensating undo after 3B. **3D** run the same fixture queries across the initial standard views and race two completions. | Pass the M3 portions of AT-02 through AT-13 and AT-18/27/32. A deferred first sequential action blocks later siblings. One occurrence completion produces at most one successor under retries and races. M4 tests Forecast's presentation of the dated results. |
| **M4 · Planning workflows** | **4A** implement Forecast, scoped search, focus, and saved perspective expressions on the M3 evaluator. **4B** implement review cadence and queue on that evaluator. **4C** add formatted notes, permission-checked SQL attachments, preferences, and bulk editing on the M2 ownership model. **4D** integrate daily planning and a full review, checking AT-14/15/16/25/28/32. 4A–4C can proceed independently after their contracts settle. | Capture work, find it through Forecast and a focused saved view, inspect/edit it, then review a project. Check read/write boundaries on files and preferences. The beta may use a recorded subset of M4, while the M4 exit covers all packages. |
| **M5 · Portability, sharing, and integrations** | **5A** build source-format staging, field comparison, idempotent commit and rollback. **5B** implement the complete versioned export, clean restore and a readable CSV outline export after content/series schemas stabilize. **5C** add explicit shared memberships and enforce every role across the M2/M4 channels. **5D** connect calendar, reminders, location and capture adapters to scoped reads and durable jobs. Optional OIDC follows the identity decision. | A migration dry run accounts for every source field and count. Full export restoration preserves behavior and file checksums. Permission changes take effect across all channels. Adapter denial, expiry, and retry are visible. Pass the applicable AT-17/21/22/25/26/29/31/32 cases. |
| **M6 · Offline and device reliability** | **6A** add principal-scoped IndexedDB caches, queue, tombstones and restart recovery on 2B/2C. **6B** replay in dependency order with permission rechecks, partial-upload recovery and user conflict resolution on 5C. **6C** test expired cursors, restored server state, account switches, narrow layouts, and touch/keyboard workflows. | AT-18/19/20/24 pass through disconnect, edit, browser restart and reconnect. No duplicate effects or cross-account disclosure. Each retained draft ends in a visible outcome. |
| **M7 · Release readiness** | **7A** profile the representative workspace and verify keyboard, screen-reader and browser behavior. **7B** rehearse backups, restoration, upgrades and failed migration recovery on representative data. **7C** verify deployment on the actual x64 Linux Docker host, check access and release controls, complete the applicable identity/license review and run Joe's pilot after 7A/7B. | AT-22/23/24/30/31 include the target-host deployment record. Reconcile the parity register, meet recovery targets at measured size, and record the pilot version, review cycle, limitations and Joe's replacement decision. |

### Independently reviewable increments

Use these boundaries when dividing the larger packages among contributors. Each increment delivers a working behavior and its named acceptance example.

| Package | First increment | Dependent or parallel increments |
| --- | --- | --- |
| 3A–3D · Rules | Implement the three project modes on a fixed ordered tree (AT-02/03). | Add mixed nested groups (AT-04), tag insertion/state (AT-06/08) and lifecycle commands (AT-27) in separate reviews. Land direct/effective dates (AT-05/07) before simple recurrence (AT-09/10), calendar edges (AT-11), and repeated subtrees plus concurrent completion (AT-12/13). |
| 4A–4D · Planning | Implement the Forecast day query and render its dated sections (AT-07/32). | The saved-filter compiler and scoped search can use the shared rule fixture independently (AT-14). Review (AT-15), note editing and binary file handling (AT-25) each have a separate path to integration. |
| 5A–5C · Moving data and granting access | Accept each source format into the same staging model and present a field comparison (AT-21). | Review atomic apply/rollback separately. Pair a portable exporter with a clean importer in one round trip (AT-22). Invitations and role changes can proceed on the M2 identity model. Exercise each new read/write channel under all roles before closing 5C (AT-17/29). |
| 5D · Integrations | Agree on user/workspace ownership, delivery identities, permission failure and retry state (AT-31). | Deliver one adapter per change. Check a calendar refresh, a push reminder, a foreground Nearby lookup and a capture-only credential independently in AT-26. Calendar depends on Forecast, Nearby on tag locations, and push on the durable outbox. |
| 6A–6C · Offline | Persist a local capture, restart offline and replay it once (AT-19). | Extend to dependent edits and partial files, then conflict resolution and revoked membership (AT-18/19/20). Device layout checks can run against the same fixtures independently (AT-24). |
| 7A–7C · Readiness | Establish a performance/keyboard baseline and restore a pilot-sized backup in parallel (AT-22/24). | Qualify actual devices, rehearse the oldest supported upgrade and its recovery path (AT-23), then run the pilot on the release candidate whose digest passed those checks. |

## First implementation slice

Start with **1A–1D**. Use the [verification fixtures](VERIFICATION_PLAN.md) and the command and view models in [architecture](ARCHITECTURE.md). Give the prototype a clearly labeled sample workspace that resets on demand. Use two projects, a few actions, a tag, and enough rows to expose scrolling errors. A second perspective must display the same items by identity.

1. From the Inbox, enter three actions in succession, edit one inline, then assign a tag and a date through the inspector. Joe should be able to keep his place after the edit.
2. Group two actions, indent/outdent them, and move the group to the second project. Check order and selection after collapsing and expanding. Provide a keyboard move command and a visible pointer drop target.
3. Find one moved action through the alternate view, complete the group, then undo. Confirm the same item identities, parent, order and properties in both views. Run the entire sequence with keyboard alone and then by pointer. Capture Joe's preferred editing mode and any missed shortcut in OBS-07.

Follow M1 with **2A–2E** for the first durable increment. Starting from an empty private workspace, create two simple projects and a tag. Capture three actions, stamp a direct tag and date on one action, group and move actions, find the tagged action using a simple direct-tag filter, complete ordinary nonrepeating work and undo that completion. Use the same item IDs throughout. The full Tags perspective, inherited values, recurrence and general undo/redo reach their gates in M3. The persistent bulk inspector arrives in M4. M1 can demonstrate these interactions against fixtures.

| M2 demonstration | Concrete acceptance |
| --- | --- |
| Start clean | From the MacBook, build dependencies in native Linux ARM64 containers, apply the initial migration once and start healthy web, worker and PostgreSQL services. Provision two ordinary accounts through the supported local process. Each gets its own private workspace. |
| Save and read | In account A, capture and move a group, reload and reopen the browser. Identity, parent, order, direct edits and completion survive. B cannot see it in lists, counts, changes or by direct lookup. |
| Observe and conflict | Open A in two active browsers. A committed change appears in the other within five seconds on the test LAN. Submit a move based on an older position. Preserve the winning order and show the other editor a recoverable conflict with its unsaved input. |
| Replay and recover | Drop the response after a successful capture. Retry the same operation. Return its prior result once authorized, with one item and one durable effect. Undo a simple completion and protect intervening changes. |
| Replace and identify | Replace both application containers using the same native image and retain the database volume. Verify login, order, a fresh task mutation and worker health. Link the native AMD64 CI results, release index and both platform digests at M2. Verify the selected AMD64 image again during [target-host deployment](OPERATIONS.md#controlled-host-update). |

Budget roughly 1–2 days for 1A, 2–3 for editing and organization in 1B/1C, and 1–2 for the two-input walkthrough and fixes. For M2, budget 2–4 days for tenancy/schema, 3–5 for transactional commands, 2–4 for the browser update and reconnect path, and 3–6 for packaging, CI and integrated checks. These are initial planning ranges for one focused contributor with review. Package estimates may overlap and need revisiting when reference trials or a first Linux build expose new work.

## Effort and sequencing

| Outcome from kickoff | Cumulative planning range | Assumption that most affects it |
| --- | --- | --- |
| Specification and usable M1 prototype | 1–2 focused engineering weeks | Quick access to Joe's interaction feedback and sample data |
| Private online evaluation beta | 6–12 weeks total | Selected M4 workflows and a bounded compatibility set, with shared workspaces scheduled in M5 |
| Broad workflow equivalence and replacement readiness | 5–9 person-months total | Verified migration, offline work, production rehearsals and time for a review-cycle pilot |

These overlapping estimates include integration and review. Re-estimate after M0 observations that affect a critical rule, again after the M2 slice, and before committing to a migration date. Short-lived feature branches based on `main` are the working default. The integration lead sequences migrations and resolves contract changes before merging independently developed work.

## Risks that can change the schedule

| Risk and early signal | Response and owner | Evidence before relying on it |
| --- | --- | --- |
| Task meaning drifts. A view lists a later sequential sibling or a move changes the user's direct date. | Domain lead reproduces it with a fixed clock and tree, records the native result, and fixes the shared evaluator. | AT-02–08, including both nesting directions. |
| Recurrence loses work. DST travel, catch-up or two completions produce a missing or duplicate occurrence. | Scheduling lead preserves wall-clock intent and unique occurrence identity, then tests the atomic transition under contention. | AT-09–13 with series state and history checked. |
| Concurrent or offline edits overwrite a move, revive a deletion, or disappear after a restore. | API and client leads version item and list changes, retain the queue, and reconcile against current grants and server generation. | AT-13/18–20/22 on separate clients, including an expired base. |
| A second account sees private data through an ancillary route. | Identity lead scopes lookups, counts, file bodies, exports, stream cursors, and jobs. Add each new channel to the role matrix when introduced. | AT-17/20/25/29, including revoked access. |
| A migration appears successful while a field is missing or a retry makes duplicates. | Portability lead compares synthetic exports field by field and stages a reversible batch. Joe identifies switch-critical fields before real cutover. | AT-21/22 with counts, checksums and omission report. |
| Browser restrictions break a familiar shortcut or background reminder. Dense lists lose focus when rows recycle. | UI/integration leads test actual combinations, expose a keyboard/in-app fallback, and report permission or delivery status. | AT-16/24/26/28 on the supported browser matrix. |
| Large files inflate backup time or a database upgrade makes image rollback unsafe. | Operator measures the SQL footprint, rehearses an off-host restore at pilot size, and chooses a compatible rollback, forward fix, or restore per release. | AT-22/23/30/31 with elapsed recovery and image/schema identities. |
| Scope or reference version drifts during the pilot. | Product lead keeps the native baseline fixed, records observed gaps and budgets separately for optional native helpers. | Versioned parity entries and an explicit M7 decision. |

**Implementation handoff.** Begin with M1 package 1A, FR-01/02/13/14 and AT-01/16. Read the command contract, fixture inventory and OBS-07 before wiring the outline. Use the M1 walkthrough to decide which interaction details need correction before connecting real accounts and storage.
