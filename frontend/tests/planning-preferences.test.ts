import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { Snapshot } from "../src/persistent/api.ts";
import { HttpError } from "../src/persistent/api.ts";
import {
  bulkPatch,
  bulkSelection,
} from "../src/persistent/preferences/bulk.ts";
import type { BulkValues } from "../src/persistent/preferences/bulk.ts";
import {
  applyAccountChanges,
  initialAccount,
  mergeAccountChanges,
} from "../src/persistent/preferences/types.ts";
import { PreferenceResource } from "../src/persistent/preferences/resource.ts";

const values: BulkValues = {
  title: "",
  flagged: "yes",
  status: "completed",
  durationMinutes: "",
  planned: "2026-11-30",
  defer: "",
  due: "2026-12-01",
};

test("mixed bulk controls send exactly the named fields and edited tag choices", () => {
  assert.deepEqual(bulkPatch(new Set(), values, { first: "" }), {});
  assert.deepEqual(
    bulkPatch(
      new Set(["flagged", "planned", "defer", "durationMinutes"]),
      values,
      { first: "", second: "remove", third: "add" },
    ),
    {
      flagged: true,
      durationMinutes: null,
      schedule: { defer: null, planned: { kind: "date", value: "2026-11-30" } },
      tags: [
        { tagId: "second", enabled: false },
        { tagId: "third", enabled: true },
      ],
    },
  );
  assert.throws(() => bulkPatch(new Set(["title"]), values, {}), /title/);
  assert.throws(
    () =>
      bulkPatch(
        new Set(["durationMinutes"]),
        { ...values, durationMinutes: "-2" },
        {},
      ),
    /minutes/,
  );
});

test("mixed summaries distinguish typed times and prefill only shared values", () => {
  const row: Snapshot["tasks"][number] = {
    id: "task1",
    title: "Survey",
    kind: "action",
    parentId: "inbox",
    version: 1,
    due: null,
    done: false,
    tags: [],
    durationMinutes: 12,
    flagged: false,
    schedule: {
      planned: { kind: "floating", value: "2026-11-01T01:30", fold: 0 },
    },
  };
  const other = {
    ...row,
    id: "task2",
    title: "Check survey",
    schedule: {
      planned: { kind: "floating", value: "2026-11-01T01:30", fold: 1 },
    },
  } satisfies Snapshot["tasks"][number];
  const selection = bulkSelection([row, other]);
  assert.equal(selection.labels.planned, "Mixed values");
  assert.equal(selection.labels.title, "Mixed values");
  assert.equal(selection.labels.flagged, "Unflagged");
  assert.equal(selection.values.durationMinutes, "12");
  assert.equal(selection.values.title, "");
});

test("queued clock edits merge independently and retain an explicit field reset", () => {
  const patch = mergeAccountChanges(
    { theme: "dark", dateDefaults: { due: "09:00", planned: "12:30" } },
    { dateDefaults: { due: null } },
  );
  assert.deepEqual(patch, {
    theme: "dark",
    dateDefaults: { due: null, planned: "12:30" },
  });
  assert.deepEqual(applyAccountChanges(initialAccount, patch).dateDefaults, {
    ...initialAccount.dateDefaults,
    planned: "12:30",
  });
});

interface Settings {
  density: string;
  theme: string;
}
const initial: Settings = { density: "comfortable", theme: "system" };
function waitForSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

const merge = <T extends Partial<Settings>>(
  old: T,
  patch: Partial<Settings>,
): T => ({ ...old, ...patch });

test("preference changes queue during the first read, serialize against new versions and retain the last edit", async () => {
  const first = waitForSignal();
  const second = waitForSignal();
  const calls: [number, Partial<Settings>][] = [];
  let saved = initial;
  const store = new PreferenceResource<Settings, Partial<Settings>>({
    initial,
    merge,
    apply: merge,
    read: async () => {
      await first.promise;
      return { version: 3, values: initial };
    },
    patch: async (version, patch) => {
      calls.push([version, patch]);
      if (version === 3) await second.promise;
      saved = merge(saved, patch);
      return { version: version + 1, values: saved };
    },
  });
  const loads = store.refresh();
  store.change({ theme: "light" });
  first.resolve();
  await nextTurn();
  store.change({ density: "compact" });
  store.change({ theme: "dark" });
  assert.deepEqual(store.snapshot().values, {
    density: "compact",
    theme: "dark",
  });
  second.resolve();
  await loads;
  assert.deepEqual(calls, [
    [3, { theme: "light" }],
    [4, { density: "compact", theme: "dark" }],
  ]);
  assert.deepEqual(store.snapshot(), {
    values: saved,
    message: "",
    failed: false,
  });
});

test("a preference version conflict retains local edits until explicit reload or reapply", async () => {
  for (const keep of [true, false]) {
    let saved = initial;
    let current = 0;
    const store = new PreferenceResource<Settings, Partial<Settings>>({
      initial,
      merge,
      apply: merge,
      read: async () => ({ version: current, values: saved }),
      patch: async (version, patch) => {
        if (current !== version)
          throw new HttpError(409, "Preferences changed.");
        saved = merge(saved, patch);
        return { version: ++current, values: saved };
      },
    });
    await store.refresh();
    current++;
    saved = { ...initial, theme: "light" };
    store.change({ density: "compact" });
    await nextTurn();
    assert.match(store.snapshot().message, /another browser/i);
    assert.equal(store.snapshot().values.density, "compact");
    await store.refresh();
    assert.equal(store.snapshot().failed, true);
    store.resolve(keep);
    await nextTurn();
    assert.deepEqual(store.snapshot().values, {
      theme: "light",
      density: keep ? "compact" : "comfortable",
    });
    assert.equal(store.snapshot().failed, false);
    assert.equal(current, keep ? 2 : 1);
  }
});

test("leaving the account during a read cancels queued preference edits", async () => {
  const ready = waitForSignal();
  let writes = 0;
  const store = new PreferenceResource<Settings, Partial<Settings>>({
    initial,
    merge,
    apply: merge,
    read: async () => {
      await ready.promise;
      return { version: 1, values: initial };
    },
    patch: async () => {
      writes++;
      return { version: 2, values: initial };
    },
  });
  const pending = store.refresh();
  store.change({ density: "compact" });
  store.stop();
  ready.resolve();
  await pending;
  assert.equal(writes, 0);
});
