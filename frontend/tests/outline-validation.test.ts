import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCommand,
  createSample,
  effectiveDone,
  INBOX,
  visibleRows,
} from "../src/outline/index.ts";
import type { Command, Task, Workspace } from "../src/outline/index.ts";

test("invalid commands reject atomically and preserve every original property", () => {
  const workspace = createSample();
  const before = structuredClone(workspace);
  const invalid: Command[] = [
    { type: "rename", id: "I01", title: " \n " },
    { type: "setTitle", ids: ["A01"], title: "Two\nlines" },
    { type: "setTag", ids: ["I01", "foreign"], tagId: "field", enabled: true },
    { type: "setTag", ids: ["I01"], tagId: "foreign", enabled: true },
    { type: "setDue", ids: ["I01", "I02"], due: "2027-02-29" },
    { type: "setDue", ids: ["I01"], due: "2026-04-31" },
    { type: "setDue", ids: ["I01"], due: "2026-1-10" },
    { type: "setDue", ids: ["I01"], due: "0000-01-01" },
    { type: "capture", parentId: INBOX, titles: ["", "  "] },
    { type: "capture", parentId: "A01", titles: ["Illegal child"] },
    { type: "capture", parentId: "field", titles: ["Outside the tree"] },
    { type: "move", ids: ["G01"], parentId: "G01" },
    { type: "move", ids: ["G01"], parentId: "A03" },
    { type: "move", ids: ["I01"], parentId: "missing" },
    { type: "move", ids: ["I01"], parentId: "P01", beforeId: "A11" },
    { type: "move", ids: ["I01", "I02"], parentId: INBOX, beforeId: "I02" },
    { type: "group", ids: ["I01", "A11"], title: "Different parents" },
    { type: "indent", ids: ["I01"] },
    { type: "outdent", ids: ["I02"] },
    { type: "complete", ids: [] },
  ];
  for (const command of invalid) {
    assert.throws(() => applyCommand(workspace, command), Error);
    assert.deepEqual(workspace, before);
  }
  for (const duplicate of ["A01", "field", "P03", INBOX, "", " "]) {
    assert.throws(
      () =>
        applyCommand(
          workspace,
          { type: "capture", parentId: INBOX, titles: ["New"] },
          () => duplicate,
        ),
      /unique/,
    );
  }
  assert.throws(
    () =>
      applyCommand(
        workspace,
        { type: "capture", parentId: INBOX, titles: ["One", "Two"] },
        () => "same-id",
      ),
    /unique/,
  );
  assert.deepEqual(workspace, before);
});

test("a move into a descendant group rejects the whole selection", () => {
  const original = createSample();
  const { workspace } = applyCommand(
    original,
    { type: "group", ids: ["A03"], title: "Nested" },
    () => "g-deep",
  );
  assert.throws(
    () =>
      applyCommand(workspace, {
        type: "move",
        ids: ["I01", "G01"],
        parentId: "g-deep",
      }),
    /subtree/,
  );
  assert.equal(
    workspace.tasks.find((task) => task.id === "I01")!.parentId,
    INBOX,
  );
});

test("idempotent commands preserve history identity and unrelated records remain unchanged", () => {
  const workspace = createSample();
  const noChanges: Command[] = [
    { type: "rename", id: "I01", title: " Loose receipt " },
    { type: "setDue", ids: ["I01", "I02"], due: null },
    { type: "setTag", ids: ["I03"], tagId: "desk", enabled: true },
    { type: "setTag", ids: ["I01", "I01"], tagId: "desk", enabled: false },
    { type: "complete", ids: ["A11"] },
    { type: "reopen", ids: ["I01"] },
    { type: "move", ids: ["A12"], parentId: "P03", beforeId: "A13" },
    { type: "move", ids: ["A13", "A12"], parentId: "P03" },
  ];
  for (const command of noChanges)
    assert.strictEqual(applyCommand(workspace, command).workspace, workspace);
  const renamed = applyCommand(workspace, {
    type: "setTitle",
    ids: ["I02", "I01"],
    title: "Shared title",
  });
  assert.deepEqual(renamed.selection, ["I01", "I02"]);
  assert.strictEqual(renamed.workspace.tasks[2], workspace.tasks[2]);
  assert.equal(workspace.tasks[0]!.title, "Loose receipt");
});

test("reopening a group restores each child's prior direct completion", () => {
  const withLeaf = applyCommand(createSample(), {
    type: "complete",
    ids: ["A03"],
  }).workspace;
  const withGroup = applyCommand(withLeaf, {
    type: "complete",
    ids: ["G01"],
  }).workspace;
  assert.ok(effectiveDone(withGroup, "A04"));
  assert.throws(
    () => applyCommand(withGroup, { type: "reopen", ids: ["A12", "A04"] }),
    /parent group/,
  );
  const reopened = applyCommand(withGroup, {
    type: "reopen",
    ids: ["G01"],
  }).workspace;
  assert.equal(effectiveDone(reopened, "A03"), true);
  assert.equal(effectiveDone(reopened, "A04"), false);
});

test("arbitrarily nested outlines traverse without recursive calls and reject broken ownership", () => {
  const base = createSample().tasks[0]!;
  const tasks: Task[] = Array.from({ length: 12000 }, (_, index) => ({
    ...base,
    id: String(index),
    parentId: index === 0 ? INBOX : String(index - 1),
    kind: "group",
  }));
  const workspace: Workspace = { projects: [], tags: [], tasks };
  const rows = visibleRows(workspace, { kind: "inbox" }, new Set());
  assert.equal(rows.at(-1)!.depth, 11999);
  assert.equal(effectiveDone(workspace, "11999"), false);
  for (const broken of [
    [{ ...base, parentId: "unknown" }],
    [base, base],
    [{ ...base, parentId: base.id, kind: "group" as const }],
    [base, { ...base, id: "other", parentId: base.id }],
  ]) {
    assert.throws(() =>
      visibleRows({ ...workspace, tasks: broken }, { kind: "all" }, new Set()),
    );
  }
});
