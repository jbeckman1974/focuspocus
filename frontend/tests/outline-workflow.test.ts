import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCommand,
  createSample,
  effectiveDone,
  INBOX,
  visibleRows,
} from "../src/outline/index.ts";
import type { Command, View, Workspace } from "../src/outline/index.ts";

const expanded = new Set<string>();
const inbox: View = { kind: "inbox" };
const project: View = { kind: "project", id: "P03" };
const field: View = { kind: "tag", id: "field" };

function ids(workspace: Workspace, view: View) {
  return visibleRows(workspace, view, expanded).map(({ task }) => task.id);
}

test("AT-01 captures one item and a multiline paste atomically and in input order", () => {
  const original = createSample();
  let serial = 0;
  const next = () => `capture-${++serial}`;
  const first = applyCommand(
    original,
    { type: "capture", parentId: INBOX, titles: ["Bench kit"] },
    next,
  );
  const captured = applyCommand(
    first.workspace,
    {
      type: "capture",
      parentId: INBOX,
      titles: ["\tCable roll\r\n\n Field book  \n"],
    },
    next,
  );
  assert.deepEqual(captured.selection, ["capture-2", "capture-3"]);
  assert.deepEqual(ids(captured.workspace, inbox).slice(-3), [
    "capture-1",
    "capture-2",
    "capture-3",
  ]);
  const titles = captured.workspace.tasks
    .filter((task) => task.id.startsWith("capture-"))
    .map((task) => task.title);
  assert.deepEqual(titles, ["Bench kit", "Cable roll", "Field book"]);
  assert.equal(
    ids(original, inbox).length + 3,
    ids(captured.workspace, inbox).length,
  );
});

test("AT-16 preserves identity, sibling order, direct fields and immutable undo snapshots across views", () => {
  const initial = createSample();
  let workspace = initial;
  let id = 0;
  const snapshots: Workspace[] = [];
  function run(command: Command) {
    const result = applyCommand(workspace, command, () => `new-${++id}`);
    snapshots.push(workspace);
    workspace = result.workspace;
    return result.selection;
  }
  const selection = run({
    type: "capture",
    parentId: INBOX,
    titles: ["Bench kit", "Cable roll", "Field book"],
  });
  const [kit, cable, book] = selection as [string, string, string];
  run({ type: "rename", id: cable, title: "Coiled cable" });
  assert.deepEqual(run({ type: "indent", ids: [book, cable] }), [cable, book]);
  run({ type: "setTag", ids: [cable, book], tagId: "field", enabled: true });
  run({ type: "setDue", ids: [book], due: "2028-02-29" });
  run({
    type: "move",
    ids: [kit, cable],
    parentId: project.id,
    beforeId: "A12",
  });
  assert.deepEqual(ids(workspace, project), [
    "A11",
    kit,
    cable,
    book,
    "A12",
    "A13",
  ]);
  assert.ok(!ids(workspace, inbox).includes(kit));
  const tagged = visibleRows(workspace, field, new Set([kit])).filter(
    ({ task }) => selection.includes(task.id),
  );
  assert.deepEqual(
    tagged.map(({ task, depth }) => [task.id, depth]),
    [
      [cable, 0],
      [book, 0],
    ],
  );
  assert.equal(tagged[0]!.task.title, "Coiled cable");
  assert.equal(tagged[1]!.task.due, "2028-02-29");
  assert.equal(tagged[1]!.task.parentId, kit);
  assert.deepEqual(
    visibleRows(workspace, project, new Set([kit])).map(({ task }) => task.id),
    ["A11", kit, "A12", "A13"],
  );
  const organized = workspace;
  run({ type: "complete", ids: [kit, cable] });
  assert.ok(effectiveDone(workspace, book));
  assert.ok(effectiveDone(workspace, cable));
  assert.ok(!workspace.tasks.find((task) => task.id === cable)!.done);
  const redo = workspace;
  workspace = snapshots.pop()!;
  assert.strictEqual(workspace, organized);
  assert.equal(effectiveDone(workspace, book), false);
  workspace = redo;
  assert.equal(effectiveDone(workspace, book), true);
  assert.equal(
    visibleRows(initial, inbox, expanded).some(({ task }) => task.id === kit),
    false,
  );
});

test("group, reorder and outdent operate on selected subtree roots in manual outline order", () => {
  let workspace = createSample();
  const result = applyCommand(
    workspace,
    { type: "group", ids: ["A05", "G01", "A03", "A02"], title: "Field run" },
    () => "combined",
  );
  assert.deepEqual(result.selection, ["combined"]);
  workspace = result.workspace;
  const list = { kind: "project", id: "P01" } as const;
  const rows = (w: Workspace) =>
    visibleRows(w, list, expanded).map(({ task, depth }) => [task.id, depth]);
  assert.deepEqual(rows(workspace), [
    ["A01", 0],
    ["combined", 0],
    ["A02", 1],
    ["G01", 1],
    ["A03", 2],
    ["A04", 2],
    ["A05", 1],
  ]);
  workspace = applyCommand(workspace, {
    type: "move",
    ids: ["A05"],
    parentId: "combined",
    beforeId: "A02",
  }).workspace;
  const moved = applyCommand(workspace, {
    type: "outdent",
    ids: ["G01", "A03", "A05"],
  });
  assert.deepEqual(moved.selection, ["A05", "G01", "A03"]);
  assert.deepEqual(rows(moved.workspace), [
    ["A01", 0],
    ["combined", 0],
    ["A02", 1],
    ["A05", 0],
    ["G01", 0],
    ["A03", 1],
    ["A04", 1],
  ]);
});

test("the Everything and direct-tag views share authoritative task objects and IDs", () => {
  const workspace = createSample();
  const all = visibleRows(workspace, { kind: "all" }, expanded);
  assert.equal(all.length, workspace.tasks.length);
  assert.equal(new Set(all.map(({ task }) => task.id)).size, all.length);
  const found = all.find(({ task }) => task.id === "A12")!;
  assert.strictEqual(
    visibleRows(workspace, field, expanded).find(
      ({ task }) => task.id === "A12",
    )!.task,
    found.task,
  );
  assert.strictEqual(
    visibleRows(workspace, project, expanded).find(
      ({ task }) => task.id === "A12",
    )!.task,
    found.task,
  );
  assert.deepEqual(
    visibleRows(workspace, { kind: "tag", id: "missing" }, expanded),
    [],
  );
});
