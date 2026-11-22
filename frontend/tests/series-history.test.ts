import assert from "node:assert/strict";
import test from "node:test";
import { CommandHistory } from "../src/persistent/history.ts";
import { parseMonthDays, withFrequency } from "../src/persistent/repeat.ts";
import type { Receipt } from "../src/persistent/api.ts";

const receipt = (id: string): Receipt => ({
  operationId: id,
  contextId: "ctx",
  revision: 1,
  selection: ["a"],
  undoable: true,
});

test("redo references the compensation receipt and a new edit ends the redo branch", () => {
  const history = new CommandHistory();
  history.acknowledge("capture", receipt("a"));
  history.acknowledge("set-repeat", receipt("b"));
  assert.deepEqual(history.acknowledge("undo", receipt("ub")), {
    undo: receipt("a"),
    redo: receipt("ub"),
  });
  assert.deepEqual(history.acknowledge("redo", receipt("rb")), {
    undo: receipt("rb"),
    redo: null,
  });
  history.acknowledge("undo", receipt("urb"));
  assert.deepEqual(history.acknowledge("move", receipt("m")), {
    undo: receipt("m"),
    redo: null,
  });
  assert.deepEqual(history.clear(), { undo: null, redo: null });
});
test("monthly pattern admits the final day and excludes ambiguous or duplicate values", () => {
  assert.deepEqual(parseMonthDays("1, 20, -1"), [1, 20, -1]);
  for (const raw of ["", "32", "0", "-2", "1,1", "1x", "2,"])
    assert.throws(() => parseMonthDays(raw));
});
test("switching frequency removes incompatible masks while preserving ending and anchor", () => {
  assert.deepEqual(
    withFrequency(
      {
        schedule: "regular",
        unit: "month",
        interval: 2,
        monthDays: [31],
        anchor: "planned",
        count: 5,
      },
      "week",
    ),
    {
      schedule: "regular",
      unit: "week",
      interval: 2,
      anchor: "planned",
      count: 5,
    },
  );
});
