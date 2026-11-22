import assert from "node:assert/strict";
import test from "node:test";
import type { Receipt, Snapshot } from "../src/persistent/api.ts";
import {
  acknowledge,
  enqueue,
  nextTransmission,
  queueNotices,
  resolveEntry,
  type QueueData,
} from "../src/persistent/offline/queue.ts";
import { project } from "../src/persistent/offline/queueProjection.ts";
import { prepare, type Intent, type Write } from "../src/persistent/writes.ts";
import { freshData } from "../src/persistent/offline/storeTypes.ts";
import type { QueueEntry } from "../src/persistent/offline/queueTypes.ts";

const initial: Snapshot = {
  workspaceId: "office",
  generation: "gen-1",
  context: "ctx-first",
  cursor: "page-1",
  revision: 1,
  offlineGrant: {
    id: "grant-A",
    protocol: 1,
    expiresAt: "2099-12-01T00:00:00Z",
  },
  tags: [],
  projects: [],
  tasks: [],
};
function create() {
  return freshData<QueueEntry>(structuredClone(initial));
}
function add(doc: QueueData, intent: Intent) {
  const write = prepare(intent, doc.projection);
  enqueue(doc, doc.projection, write);
  return write;
}
function receipt(
  write: Write,
  revision: number,
  versions: Record<string, number>,
): Receipt {
  return {
    operationId: write.envelope.operationId,
    contextId: "context-key",
    revision,
    versions,
    selection: Object.keys(versions),
    undoable: true,
  };
}
const capture: Intent = {
  type: "capture",
  parentId: "inbox",
  titles: ["Field notebook"],
};
function task(
  id: string,
  title: string,
  version: number,
): Snapshot["tasks"][number] {
  return {
    id,
    title,
    version,
    parentId: "inbox",
    kind: "action",
    tags: [],
    done: false,
    due: null,
  };
}

test("restart resolves a dependent rename only from the capture receipt, then freezes each transmission", () => {
  let doc = create();
  const first = add(doc, capture);
  const id = doc.projection.tasks[0].id;
  const rename = add(doc, { type: "rename", id, title: "Crew notes" });
  assert.equal(doc.projection.tasks[0].title, "Crew notes");
  assert.deepEqual(doc.queue[1].dependencies, [first.envelope.operationId]);
  doc = structuredClone(doc);
  const initialSend = structuredClone(nextTransmission(doc, initial)!);
  assert.equal(initialSend.id, first.envelope.operationId);
  const committed: Snapshot = {
    ...initial,
    revision: 2,
    tasks: [task(id, "Field notebook", 1)],
  };
  assert.deepEqual(
    nextTransmission(doc, committed)?.write.envelope,
    initialSend.write.envelope,
  );
  acknowledge(doc, initialSend, receipt(first, 2, { [id]: 1 }));
  const next = nextTransmission(doc, committed)!;
  assert.equal(next.id, rename.envelope.operationId);
  assert.equal(next.write.envelope.expectedRevision, 2);
  assert.equal(next.write.envelope.context, "ctx-first");
  const restarted = structuredClone(doc);
  const newer = { ...committed, revision: 7, context: "later" };
  assert.deepEqual(
    nextTransmission(restarted, newer)?.write.envelope,
    next.write.envelope,
  );
});

test("a remotely deleted target holds related drafts while independent capture proceeds", () => {
  const base = { ...initial, tasks: [task("removed", "Stakeout", 4)] };
  const doc = freshData<QueueEntry>(base);
  const first = add(doc, { type: "rename", id: "removed", title: "A" });
  const child = add(doc, { type: "rename", id: "removed", title: "B" });
  const independent = add(doc, capture);
  const current = { ...initial, revision: 4 };
  const ready = nextTransmission(doc, current)!;
  assert.equal(ready.id, independent.envelope.operationId);
  const notices = queueNotices(doc);
  assert.deepEqual(
    notices.map((n) => n.status),
    ["conflict", "blocked", "sent"],
  );
  assert.equal(notices[0].current, "Item absent");
  assert.equal(doc.projection.tasks.length, 1);
  assert.throws(
    () => resolveEntry(doc, first.envelope.operationId, "reapply"),
    /no longer exists/,
  );
  resolveEntry(doc, first.envelope.operationId, "discard");
  assert.equal(
    queueNotices(doc).find((n) => n.id === child.envelope.operationId)?.status,
    "blocked",
  );
  assert.throws(() => resolveEntry(doc, ready.id, "discard"), /transmitted/);
});

test("a server edit between predecessor commit and dependent rename cannot be rebased silently", () => {
  const doc = create();
  const first = add(doc, capture);
  const id = doc.projection.tasks[0].id;
  const original = add(doc, { type: "rename", id, title: "Offline edit" });
  const sent = nextTransmission(doc, initial)!;
  acknowledge(doc, sent, receipt(first, 2, { [id]: 1 }));
  const conflicting = {
    ...initial,
    revision: 3,
    tasks: [task(id, "Server edit", 2)],
  };
  assert.equal(nextTransmission(doc, conflicting), undefined);
  assert.equal(doc.queue[0].state, "conflict");
  assert.equal(doc.projection.tasks[0].title, "Server edit");
  resolveEntry(doc, original.envelope.operationId, "reapply");
  const chosen = nextTransmission(doc, conflicting)!;
  assert.notEqual(chosen.id, original.envelope.operationId);
  assert.equal(chosen.write.envelope.expectedRevision, 3);
  assert.equal(doc.projection.tasks[0].title, "Offline edit");
});

test("a generation, grant, protocol or expiry change holds even an already transmitted operation", () => {
  for (const change of [
    { generation: "restored" },
    { offlineGrant: { ...initial.offlineGrant!, id: "new-membership" } },
    { offlineGrant: { ...initial.offlineGrant!, protocol: 2 } },
  ]) {
    const doc = create();
    add(doc, capture);
    nextTransmission(doc, initial);
    assert.equal(nextTransmission(doc, { ...initial, ...change }), undefined);
    assert.equal(doc.queue[0].state, "conflict");
  }
  const doc = create();
  add(doc, capture);
  doc.queue[0].expiresAt = "2000-01-01T00:00:00Z";
  assert.equal(nextTransmission(doc, initial), undefined);
  assert.equal(doc.queue[0].state, "conflict");
});

test("offline parent creation, child capture and tree edits retain their prepared identities", () => {
  const doc = create();
  const projectWrite = add(doc, { type: "project", title: "Drainage" });
  const projectId = projectWrite.envelope.payload.id as string;
  const siblings = add(doc, {
    type: "capture",
    parentId: projectId,
    titles: ["Inspect", "Cover"],
  });
  const [parent, child] = doc.projection.tasks.map((row) => row.id);
  add(doc, { type: "indent", ids: [child] });
  add(doc, { type: "rename", id: child, title: "Open cover" });
  assert.equal(
    doc.projection.tasks.find((row) => row.id === parent)?.kind,
    "group",
  );
  assert.equal(
    doc.projection.tasks.find((row) => row.id === child)?.parentId,
    parent,
  );
  assert.equal(
    doc.projection.tasks.find((row) => row.id === child)?.title,
    "Open cover",
  );
  const moved = add(doc, { type: "move", ids: [child], parentId: "inbox" });
  assert.equal(
    doc.projection.tasks.find((row) => row.id === child)?.parentId,
    "inbox",
  );
  add(doc, {
    type: "lifecycle",
    change: { name: "delete", payload: { ids: [parent] } },
  });
  assert.deepEqual(
    doc.projection.tasks.map((row) => row.id),
    [child],
  );
  assert.deepEqual(
    (siblings.envelope.payload.items as { id: string }[]).map((row) => row.id),
    [parent, child],
  );
  assert.equal(moved.intent.type, "move");
});

test("staged bytes follow the predecessor's version and survive a restart until acknowledgment", async () => {
  const doc = create();
  const createTask = add(doc, capture);
  const itemId = doc.projection.tasks[0].id;
  const write = prepare(
    { type: "content", id: itemId, action: "upload" },
    doc.projection,
  );
  const file = {
    action: "upload",
    itemId,
    itemVersion: 0,
    fileId: "file-id",
    name: "field.txt",
    mediaType: "text/plain",
    size: 3,
    sha256: "test",
  } as const;
  enqueue(doc, doc.projection, write, file, new Blob(["abc"]));
  const parent = nextTransmission(doc, initial)!;
  acknowledge(doc, parent, receipt(createTask, 2, { [itemId]: 1 }));
  const restored = structuredClone(doc);
  const current = {
    ...initial,
    revision: 2,
    tasks: [task(itemId, "Field notebook", 1)],
  };
  const upload = nextTransmission(restored, current)!;
  assert.equal(upload.content?.itemVersion, 1);
  assert.equal(await restored.files[upload.id].text(), "abc");
  assert.equal(upload.write.envelope.operationId, write.envelope.operationId);
  const conf = {
    ...current,
    revision: 3,
    tasks: [task(itemId, "Later title", 2)],
  };
  assert.equal(nextTransmission(restored, conf)?.content?.itemVersion, 1);
  acknowledge(restored, upload, receipt(write, 3, { [itemId]: 2 }));
  assert.equal(restored.files[upload.id], undefined);
  assert.equal(restored.queue.length, 0);
});

test("invalid staging or unrelated acknowledgment cannot remove queued data", () => {
  const doc = create();
  assert.throws(
    () => add(doc, { type: "move", ids: ["missing"], parentId: "inbox" }),
    /no longer exists/,
  );
  assert.equal(doc.queue.length, 0);
  const first = add(doc, capture);
  const wrong = receipt(first, 9, {});
  const selected = nextTransmission(doc, initial)!;
  wrong.operationId = "unrelated";
  assert.throws(() => acknowledge(doc, selected, wrong), /matched/);
  assert.equal(doc.queue.length, 1);
  assert.deepEqual(
    project(initial, first).tasks.map((row) => row.id),
    doc.projection.tasks.map((row) => row.id),
  );
});

test("an unrelated remote write preceding a local receipt keeps a stale global command under review", () => {
  const doc = create();
  const first = add(doc, capture);
  const id = doc.projection.tasks[0].id;
  add(doc, { type: "complete", ids: [id] });
  const others = { ...initial, revision: 2 };
  const captureEntry = nextTransmission(doc, others)!;
  assert.equal(captureEntry.id, first.envelope.operationId);
  acknowledge(doc, captureEntry, receipt(first, 3, { [id]: 1 }));
  assert.equal(
    nextTransmission(doc, {
      ...others,
      revision: 3,
      tasks: [task(id, "Field notebook", 1)],
    }),
    undefined,
  );
  assert.equal(doc.queue[0].state, "conflict");
});

test("discarding a conflicted parent and its blocked child clears only those operations and file bytes", () => {
  const doc = create();
  const first = add(doc, capture);
  const item = doc.projection.tasks[0];
  const child = prepare(
    { type: "content", id: item.id, action: "upload" },
    doc.projection,
  );
  enqueue(
    doc,
    doc.projection,
    child,
    {
      action: "upload",
      itemId: item.id,
      itemVersion: 0,
      fileId: "A",
      name: "field.txt",
      mediaType: "text/plain",
      sha256: "hash",
      size: 1,
    },
    new Blob(["A"]),
  );
  const retained = add(doc, { type: "project", title: "Unaffected project" });
  doc.queue[0].state = "conflict";
  resolveEntry(doc, first.envelope.operationId, "discard");
  assert.equal(queueNotices(doc)[0].status, "blocked");
  resolveEntry(doc, child.envelope.operationId, "discard");
  assert.deepEqual(
    doc.queue.map((entry) => entry.id),
    [retained.envelope.operationId],
  );
  assert.deepEqual(Object.keys(doc.files), []);
  assert.equal(doc.projection.projects[0].title, "Unaffected project");
});

test("trusted edits rename projects, folders and tasks through the same title command", () => {
  const library = {
    ...initial,
    folders: [{ id: "f", parentId: "root", title: "Folder", version: 2 }],
    projects: [{ id: "p", parentId: "f", title: "Project", version: 2 }],
    tasks: [task("t", "Task", 2)],
  };
  const doc = freshData<QueueEntry>(library);
  add(doc, { type: "rename", id: "p", title: "Revised project" });
  assert.equal(doc.projection.projects[0].title, "Revised project");
  add(doc, { type: "setTitle", ids: ["p", "f", "t"], title: "Shared title" });
  assert.equal(doc.projection.tasks[0].title, "Shared title");
  assert.equal(doc.projection.projects[0].title, "Shared title");
  assert.equal(doc.projection.folders![0].title, "Shared title");
});

test("optimistic completion and reopening update direct and inherited statuses for the Completed view", () => {
  const flags = {
    status: "active",
    flagged: false,
    flagSource: null,
    remaining: true,
    available: true,
    firstAvailable: false,
    blocked: false,
    reason: null,
    reasonSource: null,
  } as const;
  const snapshot: Snapshot = {
    ...initial,
    projects: [
      {
        id: "p",
        title: "Field",
        version: 1,
        status: "active",
        effective: flags,
      },
    ],
    tasks: [
      {
        ...task("child", "Read level", 1),
        parentId: "p",
        status: "active",
        effective: flags,
      },
    ],
  };
  const doc = freshData<QueueEntry>(snapshot);
  add(doc, { type: "complete", ids: ["p", "child"] });
  assert.equal(doc.projection.projects[0].status, "completed");
  assert.equal(doc.projection.tasks[0].status, "active");
  assert.equal(doc.projection.tasks[0].effective?.status, "completed");
  assert.equal(doc.projection.tasks[0].effective?.remaining, false);
  add(doc, { type: "reopen", ids: ["p"] });
  assert.equal(doc.projection.tasks[0].effective?.status, "active");
  assert.equal(doc.projection.tasks[0].effective?.remaining, true);
  add(doc, { type: "complete", ids: ["child"] });
  assert.equal(doc.projection.tasks[0].done, true);
  assert.equal(doc.projection.tasks[0].effective?.status, "completed");
  add(doc, { type: "reopen", ids: ["child"] });
  assert.equal(doc.projection.tasks[0].done, false);
  assert.equal(doc.projection.tasks[0].effective?.status, "active");
});

test("unrecognized stored envelopes stay opaque before optimistic rendering or transmission", async () => {
  const { supportedQueue } =
    await import("../src/persistent/offline/queueTypes.ts");
  const doc = create();
  add(doc, capture);
  assert.ok(supportedQueue(doc.queue));
  assert.equal(supportedQueue([null]), false);
  assert.equal(supportedQueue([{ ...doc.queue[0], protocol: 2 }]), false);
  assert.equal(supportedQueue([{ ...doc.queue[0], write: {} }]), false);
  assert.equal(
    supportedQueue([
      {
        ...doc.queue[0],
        write: { ...doc.queue[0].write, intent: { type: "future-edit" } },
      },
    ]),
    false,
  );
  assert.equal(
    supportedQueue([
      {
        ...doc.queue[0],
        write: { ...doc.queue[0].write, intent: { type: "content" } },
        content: {
          itemId: "task",
          itemVersion: 2,
          action: "save",
          document: { paragraphs: [null] },
        },
      },
    ]),
    false,
  );
  assert.equal(
    supportedQueue([
      {
        ...doc.queue[0],
        guards: [{ key: "row:id", value: "1", predecessors: 24 }],
      },
    ]),
    false,
  );
});

test("staging an old tab's draft against a newer local edit requires comparison", () => {
  const original = { ...initial, tasks: [task("row", "Field notes", 1)] };
  const doc = freshData<QueueEntry>(original);
  add(doc, { type: "rename", id: "row", title: "First browser tab" });
  const stale = prepare(
    { type: "rename", id: "row", title: "Earlier form" },
    original,
  );
  enqueue(doc, original, stale);
  assert.equal(doc.queue[1].state, "conflict");
  assert.equal(doc.projection.tasks[0].title, "First browser tab");
  assert.match(doc.queue[1].reason, /Another tab/);
});

test("recovery keeps draft and file bytes for deliberate review and clears old execution receipts", async () => {
  const { quarantine, matchesReview } =
    await import("../src/persistent/offline/queueRecovery.ts");
  const old = create();
  const parent = add(old, capture);
  const target = old.projection.tasks[0];
  const child = prepare(
    { type: "content", id: target.id, action: "upload" },
    old.projection,
  );
  enqueue(
    old,
    old.projection,
    child,
    {
      action: "upload",
      itemId: target.id,
      itemVersion: 0,
      fileId: "A",
      name: "field.txt",
      mediaType: "text/plain",
      sha256: "hash",
      size: 1,
    },
    new Blob(["Z"]),
  );
  nextTransmission(old, initial);
  old.receipts.retired = receipt(parent, 2, {});
  const restored = {
    ...initial,
    generation: "restored",
    offlineGrant: { ...initial.offlineGrant!, id: "restored-grant" },
    context: "fresh-context",
  };
  const next = freshData<QueueEntry>(restored);
  quarantine(old, next, "generation");
  assert.equal(next.queue[0].transmitted, true);
  assert.equal(await next.files[child.envelope.operationId].text(), "Z");
  assert.deepEqual(next.receipts, {});
  assert.deepEqual(next.projection.tasks, []);
  assert.deepEqual(
    queueNotices(next).map((n) => n.status),
    ["conflict", "blocked"],
  );
  assert.equal(nextTransmission(next, restored), undefined);
  assert.equal(matchesReview(initial, restored), false);
  assert.equal(matchesReview(restored, { ...restored, revision: 3 }), false);
  assert.equal(matchesReview(restored, restored), true);
  const restoredItem = { ...restored, tasks: [task("t", "Current note", 9)] };
  const reviewed = {
    itemId: "t",
    itemVersion: 8,
    generation: "restored",
    grantId: "restored-grant",
  };
  assert.equal(matchesReview(restoredItem, restoredItem, reviewed), false);
  assert.equal(
    matchesReview(restoredItem, restoredItem, { ...reviewed, itemVersion: 9 }),
    true,
  );
  resolveEntry(next, parent.envelope.operationId, "reapply");
  const chosen = nextTransmission(next, restored)!;
  assert.notEqual(chosen.id, parent.envelope.operationId);
  assert.equal(chosen.write.envelope.context, "fresh-context");
});

test("blocked reapply needs a discarded predecessor and a currently visible target", () => {
  const original = { ...initial, tasks: [task("row", "Field notes", 1)] };
  const doc = freshData<QueueEntry>(original);
  const first = add(doc, { type: "rename", id: "row", title: "Earlier draft" });
  add(doc, { type: "rename", id: "row", title: "Later draft" });
  doc.queue[0].state = "conflict";
  assert.deepEqual(
    queueNotices(doc).map((n) => n.canReapply),
    [true, false],
  );
  resolveEntry(doc, first.envelope.operationId, "discard");
  assert.equal(queueNotices(doc)[0].canReapply, true);
  doc.confirmed = { ...original, tasks: [] };
  assert.equal(queueNotices(doc)[0].canReapply, false);
});
