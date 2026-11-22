import assert from "node:assert/strict";
import test from "node:test";
import {enrollSubscription} from "../src/persistent/tools/enrollment.ts";

function fixture() {
  const key = Uint8Array.of(4, 5, 6);
  let removed = 0, created = 0, actor = "first";
  const owners = new Map<string,string>([["old","first"]]);
  const old = {endpoint:"old",options:{applicationServerKey:key.buffer},unsubscribe:async()=>{removed++;return true;}};
  const manager = {
    getSubscription:async()=>old,
    subscribe:async({applicationServerKey}:{applicationServerKey:Uint8Array<ArrayBuffer>})=>{
      created++;
      return {...old,endpoint:"new",options:{applicationServerKey:applicationServerKey.buffer}};
    },
  };
  async function save(endpoint:string){
    if(owners.has(endpoint) && owners.get(endpoint)!==actor)throw new Error("endpoint already registered");
    owners.set(endpoint,actor);
  }
  return {key,manager,save,switchAccount:()=>{actor="second";},owners,counts:()=>[removed,created]};
}

test("a second account cannot reuse the first account’s endpoint and must explicitly replace it",async()=>{
  const f=fixture(),check=async()=>{};
  f.switchAccount();
  await assert.rejects(enrollSubscription(f.manager,f.key,false,check,f.save),/already registered/);
  assert.deepEqual(f.counts(),[0,0]);assert.equal(f.owners.get("old"),"first");
  await enrollSubscription(f.manager,f.key,true,check,f.save);
  assert.deepEqual(f.counts(),[1,1]);assert.equal(f.owners.get("new"),"second");
});
test("a changed VAPID key requires user-selected replacement and a fresh verified subscription",async()=>{
  const f=fixture(),rotated=Uint8Array.of(4,7,9);
  await assert.rejects(enrollSubscription(f.manager,rotated,false,async()=>{},f.save),/key changed/);
  assert.deepEqual(f.counts(),[0,0]);
  let checks=0;
  await enrollSubscription(f.manager,rotated,true,async()=>{checks++;},f.save);
  assert.deepEqual(f.counts(),[1,1]);assert.ok(checks>=3);
});
test("a switched or expired session cannot release an existing browser endpoint",async()=>{
  const f=fixture();
  let checks=0;
  await assert.rejects(enrollSubscription(f.manager,f.key,true,async()=>{if(++checks===2)throw new Error("lost access");},f.save),/lost access/);
  assert.deepEqual(f.counts(),[0,0]);
});
