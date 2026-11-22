import { strict as assert } from "node:assert";
import { test } from "node:test";
import { effectiveDone, INBOX, visibleRows } from "../src/outline/index.ts";
import type { Task, Workspace } from "../src/outline/index.ts";
import { WorkspaceSession } from "../src/workspace/session.ts";

function item(id: string, parentId: string): Task {
  return {
    id,
    parentId,
    kind: "action",
    title: id,
    tags: [],
    due: null,
    done: false,
  };
}

function fixture(): WorkspaceSession {
  const workspace: Workspace = {
    projects: [{ id: "project", title: "Punch list" }],
    tags: [{ id: "field", title: "Field" }],
    tasks: [
      item("receipt", INBOX),
      { ...item("bag", INBOX), kind: "group" },
      { ...item("sheet", "bag"), tags: ["field"] },
      { ...item("destination", "project"), kind: "group" },
      item("book", "destination"),
    ],
  };
  let sequence = 0;
  return new WorkspaceSession(workspace, () => `task-${++sequence}`);
}

test("each view remembers its own selection and collapsed groups", () => {
  const session = fixture();
  session.select(["sheet", "receipt", "sheet", "book", "missing"]);
  assert.deepEqual(session.getSnapshot().selection, ["sheet", "receipt"]);
  session.toggle("bag");
  assert.deepEqual(session.getSnapshot().selection, ["receipt", "bag"]);
  session.changeView({ kind: "all" });
  assert.equal(session.getSnapshot().collapsed.has("bag"), false);
  session.select(["book"]);
  session.changeView({ kind: "inbox" });
  assert.equal(session.getSnapshot().collapsed.has("bag"), true);
  assert.deepEqual(session.getSnapshot().selection, ["receipt", "bag"]);
  session.changeView({ kind: "all" });
  assert.deepEqual(session.getSnapshot().selection, ["book"]);
  session.select([]);
  session.changeView({ kind: "inbox" });
  session.changeView({ kind: "all" });
  assert.deepEqual(session.getSnapshot().selection, []);
  const previous = session.getSnapshot();
  session.changeView({ kind: "project", id: "unavailable" });
  assert.equal(session.getSnapshot(), previous);
});

test("AT-16 capture, two-item indent, tag, date, relocation and completion keep identity", () => {
  const session = fixture();
  session.changeView({ kind: "project", id: "project" });
  session.toggle("destination");
  session.changeView({ kind: "inbox" });
  assert.ok(
    session.run({
      type: "capture",
      parentId: INBOX,
      titles: ["Bench kit", "Cable roll\nField book"],
    }),
  );
  const [kit, cable, book] = session.getSnapshot().selection;
  session.select([cable, book]);
  assert.ok(session.run({ type: "indent", ids: [cable, book] }));
  assert.ok(
    session.run({
      type: "setTag",
      ids: [cable, book],
      tagId: "field",
      enabled: true,
    }),
  );
  assert.ok(session.run({ type: "setDue", ids: [cable], due: "2026-11-24" }));
  session.select([kit]);
  assert.ok(session.run({ type: "move", ids: [kit], parentId: "destination" }));
  const moved = session.getSnapshot();
  assert.deepEqual(moved.view, { kind: "project", id: "project" });
  assert.deepEqual(moved.selection, [kit]);
  assert.equal(moved.collapsed.has("destination"), false);
  session.undo();
  assert.deepEqual(session.getSnapshot().view, { kind: "inbox" });
  assert.deepEqual(session.getSnapshot().selection, [kit]);
  session.redo();
  assert.equal(session.getSnapshot().workspace, moved.workspace);
  session.changeView({ kind: "tag", id: "field" });
  const tagged = session.getSnapshot();
  const ids = visibleRows(tagged.workspace, tagged.view, tagged.collapsed).map(
    ({ task }) => task.id,
  );
  assert.ok(ids.includes(cable) && ids.includes(book));
  const originalCable = tagged.workspace.tasks.find(
    (task) => task.id === cable,
  );
  assert.equal(originalCable?.parentId, kit);
  assert.equal(originalCable?.due, "2026-11-24");
  session.changeView({ kind: "project", id: "project" });
  assert.ok(session.run({ type: "complete", ids: [kit] }));
  assert.equal(effectiveDone(session.getSnapshot().workspace, cable), true);
  session.undo();
  assert.equal(effectiveDone(session.getSnapshot().workspace, cable), false);
  session.redo();
  assert.equal(effectiveDone(session.getSnapshot().workspace, kit), true);
  assert.equal(effectiveDone(tagged.workspace, kit), false);
});

test("undo invoked from a compatible second view keeps that view", () => {
  const session = fixture();
  session.select(["sheet"]);
  session.run({ type: "rename", id: "sheet", title: "Revised sheet" });
  session.changeView({ kind: "tag", id: "field" });
  session.undo();
  assert.deepEqual(session.getSnapshot().view, { kind: "tag", id: "field" });
  assert.deepEqual(session.getSnapshot().selection, ["sheet"]);
  session.redo();
  assert.deepEqual(session.getSnapshot().view, { kind: "tag", id: "field" });
  assert.equal(
    session.getSnapshot().workspace.tasks.find((task) => task.id === "sheet")
      ?.title,
    "Revised sheet",
  );
});

test("rejected and unchanged edits preserve data, selection, and redo", () => {
  const session = fixture();
  session.select(["sheet"]);
  session.run({ type: "rename", id: "sheet", title: "Revision" });
  session.undo();
  const original = session.getSnapshot();
  assert.equal(
    session.run({ type: "move", ids: ["bag"], parentId: "sheet" }),
    false,
  );
  assert.ok(session.getSnapshot().notice?.text);
  assert.equal(session.getSnapshot().workspace, original.workspace);
  assert.equal(session.getSnapshot().selection, original.selection);
  assert.equal(
    session.run({ type: "rename", id: "sheet", title: "sheet" }),
    true,
  );
  assert.equal(session.getSnapshot().canRedo, true);
  assert.equal(session.getSnapshot().canUndo, false);
  session.run({ type: "setDue", ids: ["sheet"], due: "2026-11-24" });
  assert.equal(session.getSnapshot().canRedo, false);
  const branch = session.getSnapshot();
  session.redo();
  assert.equal(session.getSnapshot(), branch);
});

test("a filter change drops absent selection and undo restores it", () => {
  const session = fixture();
  session.changeView({ kind: "tag", id: "field" });
  assert.deepEqual(session.getSnapshot().selection, ["sheet"]);
  session.run({
    type: "setTag",
    ids: ["sheet"],
    tagId: "field",
    enabled: false,
  });
  assert.deepEqual(session.getSnapshot().selection, []);
  assert.deepEqual(session.getSnapshot().view, { kind: "tag", id: "field" });
  session.undo();
  assert.deepEqual(session.getSnapshot().selection, ["sheet"]);
});

test("subscriptions see atomic changes and late dismissal cannot hide a newer error", () => {
  const session = fixture();
  const other = fixture();
  const notices: string[] = [];
  const unsubscribe = session.subscribe(() => {
    notices.push(session.getSnapshot().notice?.text ?? "");
  });
  session.run({ type: "capture", parentId: INBOX, titles: ["Captured"] });
  const first = session.getSnapshot().notice;
  session.run({ type: "rename", id: "missing", title: "Another" });
  const error = session.getSnapshot().notice;
  session.dismissNotice(first);
  assert.equal(session.getSnapshot().notice, error);
  assert.equal(notices.length, 2);
  session.dismissNotice(error);
  assert.equal(session.getSnapshot().notice, null);
  assert.equal(notices.length, 3);
  unsubscribe();
  session.undo();
  assert.equal(notices.length, 3);
  assert.equal(other.getSnapshot().canUndo, false);
  assert.equal(other.getSnapshot().workspace.tasks.length, 5);
});
