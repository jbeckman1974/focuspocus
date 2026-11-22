import test from "node:test";
import assert from "node:assert/strict";
import type { OutlineRow } from "../src/outline/index.ts";
import type { Snapshot } from "../src/persistent/api.ts";
import { resolvedRows } from "../src/persistent/resolvedCleanup.ts";

function snapshot(): Snapshot {
  return {
    workspaceId: "fixture",
    revision: 1,
    generation: "fixture-generation",
    context: "fixture-context",
    cursor: "fixture-cursor",
    projects: [],
    tags: [],
    tasks: ["One", "Two", "Three"].map((title) => ({
      id: title,
      title,
      kind: "action" as const,
      parentId: "inbox",
      tags: [],
      due: null,
      done: false,
      version: 1,
      status: "active",
    })),
  };
}
const rows = (snap: Snapshot): OutlineRow[] =>
  snap.tasks
    .filter((task) => task.status === "active")
    .map((task) => ({ task, depth: 0, hasChildren: false }));
const ids = (list: OutlineRow[]) => list.map((row) => row.task.id);
const expanded = new Set<string>();

test("manual cleanup keeps freshly resolved rows with their current values until this view is cleared", () => {
  const snap = snapshot();
  const initial = resolvedRows([], snap, rows(snap), expanded, false);
  snap.tasks[0].status = "completed";
  snap.tasks[0].title = "One done";
  snap.tasks[1].status = "dropped";
  const updated = resolvedRows(
    initial.memory,
    snap,
    rows(snap),
    expanded,
    false,
  );
  assert.deepEqual(ids(updated.rows), ["One", "Two", "Three"]);
  assert.equal(updated.rows[0].task.title, "One done");
  assert.deepEqual(
    ids(resolvedRows(updated.memory, snap, rows(snap), expanded, false).rows),
    ["One", "Two", "Three"],
  );
  assert.deepEqual(
    ids(resolvedRows([], snap, rows(snap), expanded, false).rows),
    ["Three"],
  );
  assert.deepEqual(
    ids(resolvedRows(initial.memory, snap, rows(snap), expanded, true).rows),
    ["Three"],
  );
});

test("filing, deletion, and collapsed ancestor hide a retained item immediately", () => {
  const snap = snapshot();
  snap.tasks[1].parentId = "Three";
  const initial = resolvedRows([], snap, rows(snap), expanded, false);
  snap.tasks[0].status = "completed";
  snap.tasks[0].parentId = "filed-project";
  snap.tasks[1].status = "dropped";
  const updated = resolvedRows(
    initial.memory,
    snap,
    rows(snap),
    new Set(["Three"]),
    false,
  );
  assert.deepEqual(ids(updated.rows), ["Three"]);
  snap.tasks = [];
  assert.deepEqual(
    resolvedRows(initial.memory, snap, [], expanded, false).rows,
    [],
  );
});
