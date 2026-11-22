import assert from "node:assert/strict";
import { test } from "node:test";
import { nearestRank, series, switches, type Evidence } from "./evidence.ts";

test("the 48th of fifty samples sets p95 without changing source order", () => {
  const samples = Array.from({ length: 50 }, (_, i) => 50 - i);
  assert.equal(nearestRank(samples, 0.95), 48);
  assert.equal(nearestRank([137], 0.95), 137);
  assert.equal(samples[0], 50);
});
test("each real switch direction records fifty measured samples after its own five warm-ups", async () => {
  const results = new Map<
    string,
    { budget: number; warm: number[]; timed: number[] }
  >();
  const evidence: Evidence = {
    record(name, budget, warm, timed) {
      results.set(name, { budget, warm, timed });
    },
    observe() {},
    phase() {},
    finish() {
      return [];
    },
  };
  const history: string[] = [];
  const counts: Record<string, number> = { A: 0, B: 0 };
  const cases = Object.keys(counts).map((name) => ({
    name,
    run: async () => {
      history.push(name);
      return ++counts[name];
    },
  }));
  await switches(evidence, cases);
  assert.equal(history.join(""), "AB".repeat(55));
  await series(evidence, "input", 100, async (i) => i + 1);
  for (const name of ["A", "B", "input"]) {
    assert.deepEqual(results.get(name), {
      budget: name === "input" ? 100 : 500,
      warm: [1, 2, 3, 4, 5],
      timed: Array.from({ length: 50 }, (_, i) => i + 6),
    });
  }
});
