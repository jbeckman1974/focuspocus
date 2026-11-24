import assert from "node:assert/strict";
import test from "node:test";
import { indexWorkspace } from "../src/outline/tree.ts";
import { numberedChoices, projectLocations } from "../src/outline/directory.ts";
import { newTask } from "../src/outline/values.ts";
import type { Snapshot } from "../src/persistent/api.ts";
import { project } from "../src/persistent/offline/queueProjection.ts";
import { prepare } from "../src/persistent/writes.ts";

test("duplicate choices reserve literal labels and use separate sibling scopes", () => {
  const entries = ["A", "A", "A (1 of 2)", "A (1 of 2) · 2", "A"].map(
    (title, index) => ({
      id: String(index),
      parentId: index === 4 ? "other" : "group",
      title,
    }),
  );
  const choices = numberedChoices(entries, true);
  assert.deepEqual(
    choices.map(({ title }) => title),
    ["A (1 of 2) · 3", "A (2 of 2)", "A (1 of 2)", "A (1 of 2) · 2", "A"],
  );
  assert.deepEqual(
    choices.map(({ id }) => id),
    entries.map(({ id }) => id),
  );
});

test("generated project qualifiers stay distinguishable from literal project names", () => {
  const projects = [
    "A",
    "A",
    "A (1 of 2)",
    "Inbox",
    "Inbox (project)",
    "North / Survey",
    "Survey",
    "Survey",
  ].map((title, index) => ({
    id: "p" + index,
    title,
    parentId: index === 6 ? "f" : "root",
  }));
  const locations = projectLocations({
    projects,
    folders: [{ id: "f", title: "North" }],
  });
  const titles = [...locations.values()].map((entry) => entry.title);
  assert.equal(new Set(titles).size, projects.length + 1);
  assert.equal(locations.get("inbox")?.title, "Inbox");
  for (const project of projects)
    assert.ok(locations.get(project.id)?.title.includes(project.title));
});

test("locations follow nested groups, project renames and offline moves by identity", () => {
  function savedTask(
    id: string,
    parentId: string,
    title: string,
  ): Snapshot["tasks"][number] {
    return {
      ...newTask(id, parentId, title),
      effective: undefined,
      version: 1,
    };
  }
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
      savedTask("a", "g", "Review drawing"),
      savedTask("b", "p2", "Review drawing"),
      savedTask("c", "inbox", "Review drawing"),
      { ...savedTask("g", "p1", "Fieldwork"), kind: "group" },
      savedTask("d", "p3", "Review drawing"),
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
