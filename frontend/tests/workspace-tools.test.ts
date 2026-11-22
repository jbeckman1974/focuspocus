import assert from "node:assert/strict";
import test from "node:test";
import {
  workspaceClient,
  WorkspaceFailure,
} from "../src/persistent/tools/transport.ts";
import { distanceMeters } from "../src/persistent/tools/distance.ts";

test("Nearby uses geographic distance across the date line and handles coincident or opposite points", () => {
  const a = { latitude: 0, longitude: 179.999 },
    b = { latitude: 0, longitude: -179.999 };
  assert.equal(distanceMeters(a, a), 0);
  assert.ok(Math.abs(distanceMeters(a, b) - 222.39) < 0.5);
  assert.equal(distanceMeters(a, b), distanceMeters(b, a));
  assert.ok(
    distanceMeters(
      { latitude: 90, longitude: 0 },
      { latitude: -90, longitude: 0 },
    ) > 20_000_000,
  );
});

test("workspace tools pin the account, workspace, anti-forgery token and abort signal", async (t) => {
  const abort = new AbortController();
  const client = workspaceClient(
    { actorId: 17, workspaceId: "fixture", csrf: "test-only" },
    abort.signal,
  );
  const calls: { path: string; options: RequestInit }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      calls.push({ path: url, options });
      return Response.json({ workspaces: [] });
    },
  );
  await client.json("/api/v1/sharing/workspaces");
  await client.post("imports/example/commit", { operationId: "chosen" });
  const read = calls[0],
    write = calls[1];
  assert.equal(read.path, "/api/v1/sharing/workspaces");
  assert.equal(new Headers(read.options.headers).get("X-CSRFToken"), null);
  assert.equal(
    new Headers(read.options.headers).get("X-FocusPocus-Actor"),
    "17",
  );
  assert.equal(write.path, "/api/v1/workspaces/fixture/imports/example/commit");
  assert.equal(
    new Headers(write.options.headers).get("X-CSRFToken"),
    "test-only",
  );
  assert.equal(write.options.redirect, "error");
  assert.equal(write.options.mode, "same-origin");
  assert.equal(write.options.cache, "no-store");
  assert.deepEqual(JSON.parse(String(write.options.body)), {
    operationId: "chosen",
  });
  abort.abort();
  assert.equal(write.options.signal?.aborted, true);
});

test("a rejected rollback retains the server's concrete conflicts as text", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: "Later edits prevent rollback",
        conflicts: [{ reason: "moved" }, null, { reason: "renamed" }],
      },
      { status: 409 },
    ),
  );
  const client = workspaceClient(
    { actorId: 1, workspaceId: "test", csrf: "fixture" },
    new AbortController().signal,
  );
  await assert.rejects(
    client.post("imports/example/rollback", {}),
    (e) =>
      e instanceof WorkspaceFailure &&
      e.status === 409 &&
      e.conflicts.join(",") === "moved,renamed",
  );
});

import {editPlace,placeChange} from "../src/persistent/tools/placeDraft.ts";
test("a place edit keeps its source version and command identity across refresh and retry",()=>{
  const original={tagId:"tag",title:"Station",version:3,latitude:28.5,longitude:-82.4,radiusMeters:150,itemIds:[]};
  const draft={...editPlace("tag",3,original),radius:"80"};
  const attempt=placeChange(draft,false,"context1","op1");
  const next={...original,version:4,latitude:28.6};
  assert.deepEqual(attempt,{tagId:"tag",expectedVersion:3,context:"context1",operationId:"op1",latitude:28.5,longitude:-82.4,radiusMeters:80});
  const fresh=editPlace("tag",next.version,next);
  assert.equal(fresh.latitude,"28.6");
  assert.deepEqual(placeChange({...draft,version:4},true,"context2","op2"),{tagId:"tag",expectedVersion:4,context:"context2",operationId:"op2",remove:true});
});
