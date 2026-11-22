import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../src/persistent/api.ts";
import type { Receipt, Snapshot, WorkspaceApi } from "../src/persistent/api.ts";
import { WorkspaceChannel } from "../src/persistent/channel.ts";
import { prepare } from "../src/persistent/writes.ts";

const first: Snapshot = {
  workspaceId: "office", generation: "generation-one", revision: 2,
  context: "context-one", cursor: "cursor-two", projects: [], tags: [], tasks: [],
};

function fixture(custom: Partial<WorkspaceApi> = {}) {
  let revoked = false;
  let snapshot = first;
  let submissions: object[] = [];
  const api: WorkspaceApi = {
    snapshot: async () => snapshot,
    changes: async () => ({ revision: snapshot.revision, changes: [] }),
    submit: async (_name, envelope) => {
      submissions.push(envelope);
      return {operationId: "capture", contextId: "context", revision: 3, selection: ["task"], undoable: false};
    },
    ...custom,
  };
  const channel = new WorkspaceChannel(api, () => { revoked = true; });
  return { channel, submissions, revoked: () => revoked, replace: (value: Snapshot) => { snapshot = value; } };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("a lost response is retried with exactly the original operation, IDs, context and preconditions", async () => {
  const attempts: object[] = [];
  const fake = fixture({ submit: async (_name, envelope) => {
    attempts.push(envelope);
    if (attempts.length === 1) throw new TypeError("disconnected");
    return { operationId: "capture", contextId: "c", revision: 3, selection: ["task"], undoable: false };
  } });
  await fake.channel.tick();
  assert.equal(fake.channel.run({type:"capture",parentId:"inbox",titles:["Bench","Cable"]}), true);
  await settle();
  assert.equal(fake.channel.getSnapshot().phase, "uncertain");
  fake.channel.discard();
  assert.equal(fake.channel.getSnapshot().phase, "uncertain");
  assert.equal(fake.channel.run({type:"project",title:"X"}), false);
  fake.channel.retry();
  await settle();
  assert.equal(attempts[0], attempts[1]);
  assert.equal(fake.channel.getSnapshot().phase, "ready");
});

test("concurrent edits preserve draft and require explicit fresh write after resnapshot", async () => {
  let target = first;
  let fail = true;
  const attempts: {name:string; envelope:object}[] = [];
  const fake = fixture({
    snapshot: async () => target,
    submit: async (name,envelope) => {
      attempts.push({name,envelope});
      if (fail) throw new HttpError(409,"Changed by another browser.");
      return {operationId:"second", contextId:"two", revision:5, selection:["task"], undoable:false};
    },
  });
  await fake.channel.tick();
  target = {...first, context:"new-context", revision:4, cursor:"cursor-four"};
  fake.channel.run({type:"rename",id:"task",title:"Original client draft"}, first);
  await settle();
  const state = fake.channel.getSnapshot();
  assert.equal(state.phase, "conflict");
  assert.equal(state.conflictFresh, true);
  assert.equal(state.pending?.envelope.payload.title,"Original client draft");
  assert.equal(state.pending?.envelope.expectedRevision,2);
  assert.equal(state.snapshot?.revision,4);
  assert.equal(attempts.length,1);
  fail = false;
  fake.channel.reapply();
  await settle();
  assert.equal(attempts.length,2);
  assert.notDeepEqual(attempts[0].envelope,attempts[1].envelope);
  assert.equal((attempts[1].envelope as {expectedRevision:number}).expectedRevision,4);
  assert.equal(fake.channel.getSnapshot().phase,"ready");
});

test("stale cursor triggers snapshot, revoked access drops all private content",async()=>{
  let expired = true;
  const fake = fixture({ changes: async () => {
    throw new HttpError(expired ? 410 : 404, "Unavailable");
  }});
  await fake.channel.tick();
  fake.replace({...first, generation:"two",revision:0,cursor:"new"});
  await fake.channel.tick();
  assert.equal(fake.channel.getSnapshot().snapshot?.generation,"two");
  expired=false;
  await fake.channel.tick();
  assert.equal(fake.channel.getSnapshot().snapshot,null);
  assert.equal(fake.revoked(),true);
});

test("a late read from before a write cannot roll back the acknowledged state",async()=>{
  let resolvePoll!: (result:{revision:number;changes:unknown[]})=>void;
  const fake = fixture({ changes: () => new Promise(resolve => {resolvePoll=resolve;}) });
  await fake.channel.tick();
  const reading=fake.channel.tick();
  fake.channel.run({type:"project",title:"Field notes"});
  await settle();
  assert.equal(fake.channel.getSnapshot().phase,"acknowledged");
  resolvePoll({revision:first.revision,changes:[]});
  await reading;
  fake.replace({...first,revision:3});
  await fake.channel.tick();
  assert.equal(fake.channel.getSnapshot().phase,"ready");
  assert.equal(fake.channel.getSnapshot().snapshot?.revision,3);
});

test("completion undo uses the prior receipt and a new operation ID",()=>{
  const receipt:Receipt={operationId:"old-op",contextId:"old-context",revision:1,selection:["t"],undoable:true};
  const write=prepare({type:"undo",receipt}, first, ()=>"new-op");
  assert.equal(write.envelope.operationId,"new-op");
  assert.deepEqual(write.envelope.payload,{operationId:"old-op",contextId:"old-context"});
});
