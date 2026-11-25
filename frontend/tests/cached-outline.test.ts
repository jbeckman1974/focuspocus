import assert from "node:assert/strict";
import test from "node:test";
import type { Snapshot } from "../src/persistent/api.ts";
import { cachedOutline } from "../src/persistent/offline/cachedOutline.ts";
import { enqueue, type QueueData } from "../src/persistent/offline/queue.ts";
import { freshData } from "../src/persistent/offline/storeTypes.ts";
import { prepare } from "../src/persistent/writes.ts";

function sample(): Snapshot {
  const row = {
    title: "Synthetic",
    version: 1,
    due: null,
    done: false,
    tags: [],
    kind: "action" as const,
  };
  return {
    workspaceId: "sample",
    generation: "generation",
    context: "context",
    cursor: "cursor",
    revision: 5,
    folders: [{ id: "folder", title: "Folder", parentId: "root", version: 1 }],
    projects: [
      { id: "project", title: "Project", parentId: "folder", version: 1 },
    ],
    tags: [
      { id: "field", title: "Field", version: 1 },
      { id: "visit", title: "Visit", parentId: "field", version: 1 },
    ],
    tasks: [
      { ...row, id: "inbox-item", parentId: "inbox" },
      { ...row, id: "group", kind: "group", parentId: "project" },
      { ...row, id: "second", parentId: "group", tags: ["visit"] },
      { ...row, id: "first", parentId: "group" },
    ],
  };
}

test("cached outline follows a moved item, manual sibling order and the user's focus", () => {
  const snapshot = sample();
  snapshot.focusScopeIds = ["folder"];
  assert.equal(
    cachedOutline(snapshot, { kind: "inbox" }, "everything")
      .captureOutsideFocus,
    true,
  );
  assert.equal(
    cachedOutline(snapshot, { kind: "project", id: "project" }, "blocked")
      .captureOutsideFocus,
    false,
  );
  assert.equal(
    cachedOutline(
      { ...snapshot, focusScopeIds: ["missing"] },
      { kind: "project", id: "project" },
      "everything",
    ).captureOutsideFocus,
    true,
  );
  const all = cachedOutline(snapshot, { kind: "all" }, "everything");
  assert.deepEqual(all.matchIds, [
    "folder",
    "project",
    "group",
    "second",
    "first",
  ]);
  snapshot.tasks[2]!.parentId = "inbox";
  assert.deepEqual(
    cachedOutline(snapshot, { kind: "project", id: "project" }, "everything")
      .matchIds,
    ["project", "group", "first"],
  );
  assert.equal(
    cachedOutline(snapshot, { kind: "inbox" }, "everything").count,
    0,
  );
  snapshot.focusScopeIds = ["removed-folder"];
  assert.equal(cachedOutline(snapshot, { kind: "all" }, "everything").count, 0);
});

test("parent tag views retain ancestors for navigation without counting them as matches", () => {
  const result = cachedOutline(
    sample(),
    { kind: "tag", id: "field" },
    "everything",
  );
  assert.deepEqual(result.matchIds, ["second"]);
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.context]),
    [
      ["folder", true],
      ["project", true],
      ["group", true],
      ["second", false],
    ],
  );
});

test("a durably staged move appears in its project after reloading the stored projection", () => {
  const initial = sample();
  initial.offlineGrant = {
    id: "grant",
    protocol: 1,
    expiresAt: "2099-12-01T00:00:00Z",
  };
  const data: QueueData = freshData(initial);
  const move = prepare(
    { type: "move", ids: ["inbox-item"], parentId: "project" },
    data.projection,
  );
  enqueue(data, data.projection, move);
  const reopened = structuredClone(data);
  assert.equal(reopened.queue[0]?.id, move.envelope.operationId);
  assert.ok(
    cachedOutline(
      reopened.projection,
      { kind: "project", id: "project" },
      "everything",
    ).matchIds.includes("inbox-item"),
  );
  assert.equal(
    cachedOutline(reopened.projection, { kind: "inbox" }, "everything").count,
    0,
  );
});
