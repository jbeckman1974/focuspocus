import assert from "node:assert/strict";
import test from "node:test";
import { prepare } from "../src/persistent/writes.ts";
import {
  outlineQuery,
  projectedRows,
  visibleSelection,
} from "../src/persistent/rules.ts";
import type { OutlineResult } from "../src/persistent/rules.ts";
import type { Snapshot } from "../src/persistent/api.ts";

const snapshot: Snapshot = {
  workspaceId: "office",
  generation: "generation",
  context: "context",
  cursor: "cursor",
  revision: 5,
  projects: [{ id: "p", title: "Project", version: 1 }],
  tags: [],
  tasks: ["g", "a", "b", "c"].map((id, index) => ({
    id,
    title: id,
    parentId: index === 1 || index === 2 ? "g" : "p",
    kind: index === 0 ? "group" : "action",
    tags: [],
    due: null,
    done: false,
    version: 1,
  })),
};

function result(ids: string[]): OutlineResult {
  const rows = ids
    .map((id) => snapshot.tasks.find((task) => task.id === id)!)
    .map((task) => ({ ...task, context: task.kind === "group" }));
  return {
    workspaceId: snapshot.workspaceId,
    revision: 5,
    rows,
    matchIds: ids.filter((id) => id !== "g"),
    count: ids.filter((id) => id !== "g").length,
  };
}

test("scopes project and tag availability to the same UUID the sidebar selected", () => {
  assert.deepEqual(
    Object.fromEntries(
      new URLSearchParams(
        outlineQuery({ kind: "project", id: "p" }, "first-available"),
      ),
    ),
    { view: "projects", projectId: "p", availability: "first-available" },
  );
  assert.deepEqual(
    Object.fromEntries(
      new URLSearchParams(outlineQuery({ kind: "tag", id: "t" }, "remaining")),
    ),
    { view: "tags", tagId: "t", availability: "remaining" },
  );
});

test("filtered rows follow server order, preserve visible selection and collapse ancestors", () => {
  const selected = ["a", "b", "c"];
  const response = result(["c", "g", "a"]);
  const rows = projectedRows(snapshot, response, new Set());
  assert.deepEqual(
    rows.map((row) => [row.task.id, row.depth, row.hasChildren]),
    [
      ["c", 0, false],
      ["g", 0, true],
      ["a", 1, false],
    ],
  );
  assert.deepEqual(visibleSelection(rows, selected), ["a", "c"]);
  assert.deepEqual(
    visibleSelection(
      projectedRows(snapshot, response, new Set(["g"])),
      selected,
    ),
    ["c"],
  );
});

test("project modes use the normal retryable command envelope", () => {
  const command = prepare(
    {
      type: "set-properties",
      ids: ["p"],
      properties: { mode: "single-action", autoComplete: false },
    },
    snapshot,
    () => "operation",
  );
  assert.equal(command.name, "set-properties");
  assert.deepEqual(command.envelope, {
    context: "context",
    expectedRevision: 5,
    operationId: "operation",
    payload: { ids: ["p"], mode: "single-action", autoComplete: false },
  });
});

import { directoryRows } from "../src/outline/directory.ts";
import { hasEligibleFiling } from "../src/persistent/lifecycle.ts";
test("nested folder, project and tag navigation retains manual sibling order", () => {
  const rows = directoryRows(
    [
      { id: "sub", title: "Sub", parentId: "top", position: 2 },
      { id: "project", title: "Project", parentId: "top", position: 1 },
      { id: "top", title: "Top", parentId: "root", position: 5 },
      { id: "second", title: "Second", parentId: "root", position: 8 },
    ],
    "root",
  );
  assert.deepEqual(
    rows.map((row) => [row.entry.id, row.depth]),
    [
      ["top", 0],
      ["project", 1],
      ["sub", 1],
      ["second", 0],
    ],
  );
});

test("a tagged Inbox entry stays put under the default project filing policy", () => {
  const inbox = {
    ...snapshot,
    tasks: [{ ...snapshot.tasks[1]!, parentId: "inbox", tags: ["tag"] }],
  };
  assert.equal(hasEligibleFiling(inbox), false);
  assert.equal(hasEligibleFiling({ ...inbox, filingPolicy: "either" }), true);
  assert.equal(hasEligibleFiling({ ...inbox, filingPolicy: "both" }), false);
  assert.equal(
    hasEligibleFiling({
      ...inbox,
      tasks: [{ ...inbox.tasks[0]!, filingProjectId: "p" }],
      filingPolicy: "both",
    }),
    true,
  );
});

test("archive retrieval and restoration submit only the selected original IDs", () => {
  for (const name of ["restore", "retrieve"] as const) {
    const write = prepare(
      {
        type: "lifecycle",
        change: { name, payload: { ids: ["original"], parentId: "p" } },
      },
      snapshot,
      () => "op",
    );
    assert.equal(write.name, name);
    assert.deepEqual(write.envelope.payload, {
      ids: ["original"],
      parentId: "p",
    });
    assert.equal(write.envelope.expectedRevision, 5);
  }
});

import { durationMinutes, previewQuery } from "../src/persistent/schedule.ts";
test("previews distinguish ambiguous wall-clock inputs and preserve the encoded timezone", () => {
  const query = new URLSearchParams(
    previewQuery(
      "planned",
      " 2026-11-01 01:30 ",
      "zoned",
      "America/New_York",
      1,
    ),
  );
  assert.equal(query.get("zone"), "America/New_York");
  assert.equal(query.get("text"), "2026-11-01 01:30");
  assert.equal(query.get("fold"), "1");
  assert.equal(query.get("field"), "planned");
});
test("duration edits distinguish zero minutes from clearing an estimate", () => {
  assert.equal(durationMinutes("0"), 0);
  assert.equal(durationMinutes(""), null);
  assert.throws(() => durationMinutes("-1"));
  assert.throws(() => durationMinutes("90 minutes"));
});
test("schedule commands preserve independent date fields, time intent and original revision", () => {
  const changes = {
    schedule: {
      defer: null,
      planned: {
        kind: "zoned" as const,
        value: "2026-11-01T01:30",
        zone: "America/New_York",
        fold: 1 as const,
      },
    },
    durationMinutes: 30,
  };
  const write = prepare(
    { type: "set-schedule", ids: ["task"], changes },
    snapshot,
    () => "op",
  );
  assert.deepEqual(write.envelope.payload, { ids: ["task"], ...changes });
  assert.equal(write.envelope.expectedRevision, 5);
});

test("a floating date uses the chosen viewing zone without binding a fixed timezone", () => {
  const fields = Object.fromEntries(
    new URLSearchParams(
      previewQuery(
        "due",
        "tomorrow at 09:00",
        "floating",
        "America/New_York",
        0,
        "Europe/Paris",
      ),
    ),
  );
  assert.equal(fields.viewZone, "Europe/Paris");
  assert.equal(fields.kind, "floating");
  assert.equal(fields.zone, undefined);
});

test("Changed renders a flat chronological list even when parent and child both match", () => {
  const query = { ...result(["a", "g"]), view: "changed" };
  assert.deepEqual(
    projectedRows(snapshot, query, new Set(["g"])).map((r) => [
      r.task.id,
      r.depth,
      r.hasChildren,
    ]),
    [
      ["a", 0, false],
      ["g", 0, false],
    ],
  );
});

test("explicit timestamp input retains its offset and does not send a wall-clock ambiguity", () => {
  const query = new URLSearchParams(
    previewQuery(
      "due",
      "2026-11-01T01:30-05:00",
      "instant",
      "UTC",
      1,
      "Europe/Paris",
    ),
  );
  assert.equal(query.get("text"), "2026-11-01T01:30-05:00");
  assert.equal(query.get("viewZone"), "Europe/Paris");
  assert.equal(query.has("fold"), false);
  assert.equal(query.has("zone"), false);
});
