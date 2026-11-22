import assert from "node:assert/strict";
import test from "node:test";
import type { Workspace } from "../src/outline/index.ts";
import {
  adjacentId,
  moveDestinations,
  selectThrough,
  viewTitle,
} from "../src/components/outline/controls.ts";

test("keyboard range follows visible order in both directions", () => {
  const ids = ["A", "B", "C", "D"];
  assert.deepEqual(selectThrough(ids, "B", "D"), ["B", "C", "D"]);
  assert.deepEqual(selectThrough(ids, "D", "B"), ["B", "C", "D"]);
  assert.deepEqual(selectThrough(ids, "C", "C"), ["C"]);
  assert.deepEqual(selectThrough(ids, "unmounted", "B"), ["B"]);
  assert.deepEqual(selectThrough(ids, "B", "unmounted"), []);
  assert.deepEqual(ids, ["A", "B", "C", "D"]);
});

test("navigation stays inside the view and supports Home and End", () => {
  const ids = ["A", "C", "D"];
  assert.equal(adjacentId(ids, "A", "ArrowUp"), "A");
  assert.equal(adjacentId(ids, "C", "ArrowDown"), "D");
  assert.equal(adjacentId(ids, "D", "ArrowDown"), "D");
  assert.equal(adjacentId(ids, "C", "Home"), "A");
  assert.equal(adjacentId(ids, "C", "End"), "D");
  assert.equal(adjacentId([], "gone", "End"), undefined);
});

const workspace: Workspace = {
  projects: [{ id: "p1", title: "Office" }, { id: "p2", title: "Field" }],
  tags: [{ id: "t", title: "Research" }],
  tasks: [
    { id: "a", title: "Maps", parentId: "p1", kind: "group", done: false, due: null, tags: [] },
    { id: "b", title: "Drafts", parentId: "a", kind: "group", done: false, due: null, tags: [] },
    { id: "c", title: "Draw", parentId: "b", kind: "action", done: false, due: null, tags: [] },
    { id: "d", title: "Permits", parentId: "p2", kind: "group", done: false, due: null, tags: [] },
  ],
};

test("the move picker excludes the selected subtree and labels nested groups", () => {
  assert.deepEqual(moveDestinations(workspace, ["a"]).map((entry) => entry.id), ["inbox", "p1", "p2", "d"]);
  assert.equal(moveDestinations(workspace, ["c"]).find((entry) => entry.id === "b")?.title, "Office / Maps / Drafts");
  assert.deepEqual(moveDestinations(workspace, ["b", "d"]).map((entry) => entry.id), ["inbox", "p1", "p2", "a"]);
});

test("view headings use the current project or tag name", () => {
  assert.equal(viewTitle({ kind: "inbox" }, workspace), "Inbox");
  assert.equal(viewTitle({ kind: "project", id: "p1" }, workspace), "Office");
  assert.equal(viewTitle({ kind: "tag", id: "t" }, workspace), "Research");
});
