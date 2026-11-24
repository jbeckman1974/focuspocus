import assert from "node:assert/strict";
import test from "node:test";
import { indexWorkspace } from "../src/outline/tree.ts";
import { newTask } from "../src/outline/values.ts";
import type { Snapshot } from "../src/persistent/api.ts";
import { project } from "../src/persistent/offline/queueProjection.ts";
import { prepare } from "../src/persistent/writes.ts";

test("locations follow nested groups, project renames and offline moves by identity", () => {
  const base: Snapshot = {
    workspaceId: "w",
    generation: "g",
    cursor: "c",
    context: "ctx",
    revision: 1,
    folders: [
      { id: "f1", title: "North", version: 1 },
      { id: "f2", title: "South", version: 1 },
    ],
    projects: [
      { id: "p1", title: "Survey", parentId: "f1", version: 1 },
      { id: "p2", title: "Survey", parentId: "f2", version: 1 },
      { id: "p3", title: "Survey", parentId: "f2", version: 1 },
    ],
    tasks: [
      { ...newTask("a", "g", "Review drawing"), version: 1 },
      { ...newTask("b", "p2", "Review drawing"), version: 1 },
      { ...newTask("c", "inbox", "Review drawing"), version: 1 },
      { ...newTask("g", "p1", "Fieldwork"), kind: "group", version: 1 },
      { ...newTask("d", "p3", "Review drawing"), version: 1 },
    ],
    tags: [],
  };
  function locations(snapshot: Snapshot) {
    const { taskLocations } = indexWorkspace(snapshot);
    return ["a", "b", "c", "d"].map((id) => taskLocations.get(id)?.title);
  }
  assert.deepEqual(locations(base), [
    "North / Survey",
    "South / Survey (1 of 2)",
    "Inbox",
    "South / Survey (2 of 2)",
  ]);
  const moved = project(
    base,
    prepare({ type: "move", ids: ["g"], parentId: "p3" }, base),
  );
  assert.equal(indexWorkspace(moved).taskLocations.get("a")?.id, "p3");
  assert.equal(locations(moved)[0], "South / Survey (2 of 2)");
  const renamed = project(
    moved,
    prepare({ type: "rename", id: "p3", title: "Canal" }, moved),
  );
  assert.deepEqual(locations(renamed), [
    "Canal",
    "South / Survey",
    "Inbox",
    "Canal",
  ]);
  assert.equal(indexWorkspace(base).taskLocations.get("a")?.id, "p1");
  const staged = {
    ...base,
    tasks: base.tasks.map((task) =>
      task.id === "g"
        ? { ...task, parentId: "inbox", filingProjectId: "p2" }
        : task,
    ),
  };
  const pending = indexWorkspace(staged).taskLocations.get("a")!;
  assert.equal(pending.id, "inbox");
  assert.equal(pending.filingTarget?.title, "South / Survey (1 of 2)");
});
