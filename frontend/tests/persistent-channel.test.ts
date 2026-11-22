import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, workspaceApi } from "../src/persistent/api.ts";
import type { Receipt, Snapshot, WorkspaceApi } from "../src/persistent/api.ts";
import { WorkspaceChannel } from "../src/persistent/channel.ts";
import { prepare } from "../src/persistent/writes.ts";

const first: Snapshot = {
  workspaceId: "office",
  generation: "generation-one",
  revision: 2,
  context: "context-one",
  cursor: "cursor-two",
  projects: [],
  tags: [],
  tasks: [],
};

function fixture(custom: Partial<WorkspaceApi> = {}) {
  let revoked = false;
  let snapshot = first;
  let submissions: object[] = [];
  const api: WorkspaceApi = {
    previewRepeat: async () => ({revision:2,next:null,remaining:0}),
    setViewZone: () => {},
    verifySession: async () => true,
    snapshot: async () => snapshot,
    changes: async () => ({ revision: snapshot.revision, changes: [] }),
    submit: async (_name, envelope) => {
      submissions.push(envelope);
      return {
        operationId: "capture",
        contextId: "context",
        revision: 3,
        selection: ["task"],
        undoable: false,
      };
    },
    ...custom,
  };
  const channel = new WorkspaceChannel(api, () => {
    revoked = true;
  });
  return {
    channel,
    submissions,
    revoked: () => revoked,
    replace: (value: Snapshot) => {
      snapshot = value;
    },
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a lost response is retried with exactly the original operation, IDs, context and preconditions", async () => {
  const attempts: object[] = [];
  const fake = fixture({
    submit: async (_name, envelope) => {
      attempts.push(envelope);
      if (attempts.length === 1) throw new TypeError("disconnected");
      return {
        operationId: "capture",
        contextId: "c",
        revision: 3,
        selection: ["task"],
        undoable: false,
      };
    },
  });
  await fake.channel.tick();
  assert.equal(
    fake.channel.run({
      type: "capture",
      parentId: "inbox",
      titles: ["Bench", "Cable"],
    }),
    true,
  );
  await settle();
  assert.equal(fake.channel.getSnapshot().phase, "uncertain");
  fake.channel.discard();
  assert.equal(fake.channel.getSnapshot().phase, "uncertain");
  assert.equal(fake.channel.run({ type: "project", title: "X" }), false);
  fake.replace({ ...first, revision: 3 });
  fake.channel.retry();
  await settle();
  assert.equal(attempts[0], attempts[1]);
  assert.equal(fake.channel.getSnapshot().phase, "ready");
});

test("concurrent edits preserve draft and require explicit fresh write after resnapshot", async () => {
  let target = first;
  let fail = true;
  const attempts: { name: string; envelope: object }[] = [];
  const fake = fixture({
    snapshot: async () => target,
    submit: async (name, envelope) => {
      attempts.push({ name, envelope });
      if (fail) throw new HttpError(409, "Changed by another browser.");
      return {
        operationId: "second",
        contextId: "two",
        revision: 5,
        selection: ["task"],
        undoable: false,
      };
    },
  });
  await fake.channel.tick();
  target = {
    ...first,
    context: "new-context",
    revision: 4,
    cursor: "cursor-four",
  };
  fake.channel.run(
    { type: "rename", id: "task", title: "Original client draft" },
    first,
  );
  await settle();
  const state = fake.channel.getSnapshot();
  assert.equal(state.phase, "conflict");
  assert.equal(state.conflictFresh, true);
  assert.equal(state.pending?.envelope.payload.title, "Original client draft");
  assert.equal(state.pending?.envelope.expectedRevision, 2);
  assert.equal(state.snapshot?.revision, 4);
  assert.equal(attempts.length, 1);
  fail = false;
  target = { ...target, revision: 5 };
  fake.channel.reapply();
  await settle();
  assert.equal(attempts.length, 2);
  assert.notDeepEqual(attempts[0].envelope, attempts[1].envelope);
  assert.equal(
    (attempts[1].envelope as { expectedRevision: number }).expectedRevision,
    4,
  );
  assert.equal(fake.channel.getSnapshot().phase, "ready");
});

test("stale cursor triggers snapshot, revoked access drops all private content", async () => {
  let expired = true;
  const fake = fixture({
    changes: async () => {
      throw new HttpError(expired ? 410 : 404, "Unavailable");
    },
  });
  await fake.channel.tick();
  fake.replace({ ...first, generation: "two", revision: 0, cursor: "new" });
  await fake.channel.tick();
  assert.equal(fake.channel.getSnapshot().snapshot?.generation, "two");
  expired = false;
  await fake.channel.tick();
  assert.equal(fake.channel.getSnapshot().snapshot, null);
  assert.equal(fake.revoked(), true);
});

test("a late read from before a write cannot roll back the acknowledged state", async () => {
  let resolvePoll!: (result: { revision: number; changes: unknown[] }) => void;
  const fake = fixture({
    changes: () =>
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
  });
  await fake.channel.tick();
  const reading = fake.channel.tick();
  fake.channel.run({ type: "project", title: "Field notes" });
  await settle();
  assert.equal(fake.channel.getSnapshot().phase, "acknowledged");
  resolvePoll({ revision: first.revision, changes: [] });
  await reading;
  fake.replace({ ...first, revision: 3 });
  await fake.channel.tick();
  assert.equal(fake.channel.getSnapshot().phase, "ready");
  assert.equal(fake.channel.getSnapshot().snapshot?.revision, 3);
});

test("completion undo uses the prior receipt and a new operation ID", () => {
  const receipt: Receipt = {
    operationId: "old-op",
    contextId: "old-context",
    revision: 1,
    selection: ["t"],
    undoable: true,
  };
  const write = prepare({ type: "undo", receipt }, first, () => "new-op");
  assert.equal(write.envelope.operationId, "new-op");
  assert.deepEqual(write.envelope.payload, {
    operationId: "old-op",
    contextId: "old-context",
  });
});

test("missing target preserves the submitted title after confirming the same principal and workspace", async () => {
  let confirm!: (canWrite: boolean) => void;
  const fake = fixture({
    verifySession: () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
    submit: async () => {
      throw new HttpError(404, "Item unavailable.");
    },
  });
  await fake.channel.tick();
  fake.channel.run({ type: "rename", id: "vanished", title: "My draft" });
  await settle();
  assert.equal(fake.channel.getSnapshot().phase, "verifying");
  assert.equal(fake.channel.getSnapshot().snapshot, null);
  assert.equal(fake.channel.getSnapshot().pending, null);
  confirm(true);
  await settle();
  assert.equal(fake.channel.getSnapshot().phase, "rejected");
  assert.equal(
    fake.channel.getSnapshot().pending?.envelope.payload.title,
    "My draft",
  );
  assert.equal(fake.revoked(), false);
});

test("rotated CSRF retries the original command only after verified access", async () => {
  let checked = false;
  const submitted: object[] = [];
  const fake = fixture({
    verifySession: async () => {
      checked = true;
      return true;
    },
    submit: async (_name, envelope) => {
      submitted.push(envelope);
      if (!checked) throw new HttpError(403, "Refresh your session.");
      return {
        operationId: "edit",
        contextId: "ctx",
        revision: 2,
        selection: [],
        undoable: false,
      };
    },
  });
  await fake.channel.tick();
  fake.channel.run({ type: "setTitle", ids: ["a"], title: "Retained" });
  await settle();
  assert.equal(fake.channel.getSnapshot().phase, "retryable");
  fake.channel.retry();
  await settle();
  assert.equal(submitted[0], submitted[1]);
  assert.equal(fake.channel.getSnapshot().phase, "ready");
});

test("command error with changed account or revoked membership wipes the workspace and draft", async () => {
  const fake = fixture({
    verifySession: async () => {
      throw new HttpError(403, "Workspace access changed.");
    },
    submit: async () => {
      throw new HttpError(404, "Workspace unavailable.");
    },
  });
  await fake.channel.tick();
  fake.channel.run({
    type: "capture",
    parentId: "inbox",
    titles: ["Private entry"],
  });
  await settle();
  assert.equal(fake.revoked(), true);
  assert.equal(fake.channel.getSnapshot().snapshot, null);
  assert.equal(fake.channel.getSnapshot().pending, null);
});

test("transport renews the CSRF header only for the verified actor and workspace", async (t) => {
  const initial = crypto.randomUUID();
  let session = {
    user: { id: 12, username: "actor" },
    workspaces: [{ id: "office", role: "owner" }],
    csrfToken: crypto.randomUUID(),
  };
  const headers: (string | null)[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      if (url === "/api/v1/session") return Response.json(session);
      headers.push(new Headers(options.headers).get("X-CSRFToken"));
      return Response.json({});
    },
  );
  const api = workspaceApi("office", 12, initial, new AbortController().signal);
  await api.submit("complete", {});
  assert.equal(await api.verifySession(), true);
  await api.submit("complete", {});
  assert.deepEqual(headers, [initial, session.csrfToken]);

  session = {
    ...session,
    user: { id: 13, username: "different" },
    csrfToken: crypto.randomUUID(),
  };
  await assert.rejects(api.verifySession(), { status: 403 });
  session = { ...session, user: { id: 12, username: "actor" }, workspaces: [] };
  await assert.rejects(api.verifySession(), { status: 403 });
});

test("a same-revision personal setting received from the feed refreshes the snapshot", async () => {
  let reads = 0;
  const fake = fixture({
    snapshot: async () => ({...first, resolvedCleanup: ++reads === 1 ? "immediate" : "on-cleanup"}),
    changes: async () => ({revision: first.revision, changes: [], resolvedCleanup:"on-cleanup"}),
  });
  await fake.channel.tick();
  assert.equal(fake.channel.getSnapshot().snapshot?.resolvedCleanup,"immediate");
  await fake.channel.tick();
  assert.equal(fake.channel.getSnapshot().snapshot?.resolvedCleanup,"on-cleanup");
});

test("repeat previews send one versionless read with the current CSRF token", async t => {
  const csrf = crypto.randomUUID();
  const api = workspaceApi("office",1,csrf,new AbortController().signal);
  const rule={schedule:"regular" as const,unit:"week" as const,interval:1,weekdays:[1,3]};
  const fetcher=t.mock.method(globalThis,"fetch",async (url:RequestInfo|URL,init?:RequestInit)=>{
    assert.equal(url,"/api/v1/workspaces/office/repeat-preview");
    assert.equal(init?.credentials,"same-origin");
    assert.equal(new Headers(init?.headers).get("X-CSRFToken"),csrf);
    assert.deepEqual(JSON.parse(String(init?.body)),{id:"item",rule});
    return Response.json({revision:2,next:null,remaining:0});
  });
  const value=await api.previewRepeat("item",rule,undefined,new AbortController().signal);
  assert.equal(value.remaining,0);
  assert.equal(fetcher.mock.callCount(),1);
});
