import { strict as assert } from "node:assert";
import { test } from "node:test";
import { workspaceOption } from "../src/persistent/tools/workspaceNames.ts";

test("workspace names identify same-name restores and remain stable across picker ordering", () => {
  const spaces = [
    { id: "01234567-aaaa-4888-8888-000000000001", name: "Team" },
    { id: "01234567-bbbb-4888-8888-000000000001", name: "Team" },
    { id: "ffffffff-aaaa-4888-8888-000000000001", name: "Team" },
    { id: "abababab-aaaa-4888-8888-000000000001", name: "Private" },
  ];
  const labels = spaces.map((space) => workspaceOption(space, spaces));
  assert.deepEqual(labels, ["Team · 01234567-a", "Team · 01234567-b", "Team · ffffffff", "Private"]);
  assert.deepEqual(spaces.map((space) => workspaceOption(space, [...spaces].reverse())), labels);
});
