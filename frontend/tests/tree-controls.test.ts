import assert from "node:assert/strict";
import test from "node:test";
import { visibleRows } from "../src/outline/index.ts";
import type { Command, Task, Workspace } from "../src/outline/index.ts";
import { handleTreeKey } from "../src/components/outline/keyboard.ts";
import {
  adjacentId,
  extendRange,
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
  projects: [
    { id: "p1", title: "Office" },
    { id: "p2", title: "Field" },
  ],
  tags: [{ id: "t", title: "Research" }],
  tasks: [
    {
      id: "a",
      title: "Maps",
      parentId: "p1",
      kind: "group",
      done: false,
      due: null,
      tags: [],
    },
    {
      id: "b",
      title: "Drafts",
      parentId: "a",
      kind: "group",
      done: false,
      due: null,
      tags: [],
    },
    {
      id: "c",
      title: "Draw",
      parentId: "b",
      kind: "action",
      done: false,
      due: null,
      tags: [],
    },
    {
      id: "d",
      title: "Permits",
      parentId: "p2",
      kind: "group",
      done: false,
      due: null,
      tags: [],
    },
  ],
};

test("the move picker excludes the selected subtree and labels nested groups", () => {
  assert.deepEqual(
    moveDestinations(workspace, ["a"]).map((entry) => entry.id),
    ["inbox", "p1", "p2", "d"],
  );
  assert.equal(
    moveDestinations(workspace, ["c"]).find((entry) => entry.id === "b")?.title,
    "Office / Maps / Drafts",
  );
  assert.deepEqual(
    moveDestinations(workspace, ["b", "d"]).map((entry) => entry.id),
    ["inbox", "p1", "p2", "a"],
  );
});

test("view headings use the current project or tag name", () => {
  assert.equal(viewTitle({ kind: "inbox" }, workspace), "Inbox");
  assert.equal(viewTitle({ kind: "project", id: "p1" }, workspace), "Office");
  assert.equal(viewTitle({ kind: "tag", id: "t" }, workspace), "Research");
});

test("Escape leaves the focused task available for navigation and clears every editing shortcut", () => {
  const target = new EventTarget();
  const view = { kind: "project", id: "p1" } as const;
  const rows = visibleRows(workspace, view, new Set());
  const ids = rows.map(({ task }) => task.id);
  const commands: Command[] = [];
  const edits: string[] = [];
  const dialogs: string[] = [];
  let selection = [ids[1]!];
  const nav = {
    active: ids[1]!,
    clearSelection() {
      selection = [];
    },
    select(id: string) {
      selection = [id];
    },
    navigate() {},
  };

  function press(key: string, shortcut = "x", modifiers: { ctrlKey?: boolean; metaKey?: boolean; target?: EventTarget } = {}) {
    handleTreeKey(
      {
        key,
        target,
        currentTarget: target,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        nativeEvent: { isComposing: false },
        preventDefault() {},
        ...modifiers,
      },
      {
        view,
        workspace,
        selection,
        rows,
        collapsed: new Set(),
        toggle() {},
        undo() {},
        redo() {},
        edit(task: Task) {
          edits.push(task.id);
        },
        panel(panel) {
          dialogs.push(panel);
        },
        run(command) {
          commands.push(command);
          return true;
        },
      },
      nav,
      ids,
      shortcut,
    );
  }

  press("Escape");
  assert.deepEqual(selection, []);
  assert.equal(nav.active, "b");
  for (const key of ["x", "i", "o", "Enter", "F2", "g", "m"]) press(key);
  assert.deepEqual(commands, []);
  assert.deepEqual(edits, []);
  assert.deepEqual(dialogs, []);

  press(" ");
  press("x");
  assert.deepEqual(commands, [{ type: "complete", ids: ["b"] }]);
  commands.length = 0;
  press("x", "k");
  press("k", "k", { ctrlKey: true });
  press("k", "k", { metaKey: true });
  press("k", "k", { target: new EventTarget() });
  assert.deepEqual(commands, []);
  press("k", "k");
  assert.deepEqual(commands, [{ type: "complete", ids: ["b"] }]);
});

test("a new command selection resets the range anchor to the newly active task", () => {
  const ids = ["first", "middle", "previous", "captured"];
  const oldCursor = { id: "first", anchor: "first", selection: ["first"] };
  const next = extendRange(
    ids,
    oldCursor,
    ["captured"],
    "captured",
    "previous",
  );
  assert.deepEqual(next, {
    id: "previous",
    anchor: "captured",
    selection: ["previous", "captured"],
  });
  const continued = extendRange(ids, next, next.selection, next.id, "middle");
  assert.deepEqual(continued.selection, ["middle", "previous", "captured"]);
  const filtered = extendRange(
    ["middle", "previous"],
    continued,
    continued.selection,
    "middle",
    "previous",
  );
  assert.deepEqual(filtered, {
    id: "previous",
    anchor: "middle",
    selection: ["middle", "previous"],
  });
});
