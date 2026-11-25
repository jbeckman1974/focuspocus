import assert from "node:assert/strict";
import test from "node:test";
import { captureStatus } from "../src/persistent/captureStatus.ts";
import type { QueueNotice } from "../src/persistent/offline/queueTypes.ts";

const saved = {
  receipt: {
    operationId: "first",
    contextId: "local",
    revision: 2,
    selection: ["a"],
    undoable: true,
  },
  intent: {
    type: "capture" as const,
    parentId: "project",
    titles: ["Survey the site"],
  },
};
const snapshot = {
  generation: "original",
  revision: 2,
  workspaceId: "office",
  context: "local",
  cursor: "two",
  tasks: [],
  projects: [],
  tags: [],
};
const state = {
  snapshot,
  reviewOnly: false,
  lastChange: saved,
  lastStaged: null,
  queue: [],
};
const staged = {
  operationId: "second",
  selection: ["b", "c"],
  intent: {
    type: "capture" as const,
    parentId: "project",
    titles: ["Check levels", "Record readings"],
  },
};
function queueEntry(status: QueueNotice["status"]): QueueNotice {
  return {
    id: "second",
    status,
    description: "",
    reason: "",
    canReapply: false,
    base: "",
    draft: "",
    current: "",
  };
}

test("capture feedback confirms only the latest submission in its destination after the receipt revision", () => {
  assert.equal(
    captureStatus(state, "first", "project", "Plats"),
    "Added 1 task to Plats.",
  );
  assert.equal(
    captureStatus(
      { ...state, snapshot: { ...snapshot, revision: 3 } },
      "first",
      "project",
      "Plats",
    ),
    "Added 1 task to Plats.",
  );
  assert.equal(
    captureStatus(
      { ...state, snapshot: { ...snapshot, revision: 1 } },
      "first",
      "project",
      "Plats",
    ),
    null,
  );
  assert.equal(captureStatus(state, "second", "project", "Plats"), null);
  assert.equal(captureStatus(state, "first", "inbox", "Inbox"), null);
});

test("a newer trusted capture reports its own local drafts until confirmed, held or discarded", () => {
  const local = { ...state, lastStaged: staged };
  for (const status of ["queued", "sent"] as const)
    assert.equal(
      captureStatus(
        { ...local, queue: [queueEntry(status)] },
        "second",
        "project",
        "Plats",
      ),
      "Saved 2 tasks for Plats on this device. Waiting to sync.",
    );
  for (const queue of [[], [queueEntry("blocked")], [queueEntry("conflict")]])
    assert.equal(
      captureStatus({ ...local, queue }, "second", "project", "Plats"),
      null,
    );
  assert.equal(
    captureStatus(
      { ...local, reviewOnly: true, queue: [queueEntry("queued")] },
      "second",
      "project",
      "Plats",
    ),
    null,
  );
  const receipt = {
    ...saved.receipt,
    operationId: "second",
    selection: staged.selection,
  };
  assert.equal(
    captureStatus(
      { ...local, lastChange: { intent: staged.intent, receipt } },
      "second",
      "project",
      "Plats",
    ),
    "Added 2 tasks to Plats.",
  );
});
