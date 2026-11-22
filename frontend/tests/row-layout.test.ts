import assert from "node:assert/strict";
import test from "node:test";
import { RowLayout } from "../src/components/outline/rowLayout.ts";

test("10,000 variable-height rows have gapless offsets at every boundary", () => {
  const ids = Array.from({ length: 10_000 }, (_, index) => String(index));
  const measured = new Map(
    ids.filter((_, i) => i % 5 === 0).map((id) => [id, 93.5]),
  );
  const layout = new RowLayout(ids, measured, 42);
  let offset = 0;
  for (const [index, id] of ids.entries()) {
    const height = measured.get(id) ?? 42;
    assert.equal(layout.offsets[index], offset);
    assert.equal(layout.indexAt(offset), index);
    assert.equal(layout.indexAt(offset + height - 0.125), index);
    offset += height;
  }
  assert.equal(layout.offsets.at(-1), offset);
  assert.equal(layout.indexAt(-11), 0);
  assert.equal(layout.indexAt(offset), 9999);
  assert.equal(new RowLayout([], new Map(), 42).indexAt(0), -1);
});

test("the mounted viewport keeps distant active, draft and drag source IDs in DOM order", () => {
  const ids = Array.from({ length: 10_000 }, (_, index) => String(index));
  const layout = new RowLayout(ids, new Map(), 40);
  const indices = layout.mounted(5000 * 40, 400, [
    "9999",
    "2",
    "4999",
    "missing",
    undefined,
    "2",
  ]);
  assert.equal(indices[0], 2);
  assert.equal(indices.at(-1), 9999);
  assert.deepEqual(
    indices.slice(1, -1),
    Array.from({ length: 23 }, (_, i) => i + 4994),
  );
  assert.ok(layout.mounted(0, 400, []).every((i) => i < 25));
  assert.ok(
    layout.mounted(1_000_000, 400, []).every((i) => i >= 9993 && i < 10_000),
  );
});
