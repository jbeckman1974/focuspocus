import assert from "node:assert/strict";
import test from "node:test";
import { prepare } from "../src/persistent/writes.ts";
import { outlineQuery, projectedRows, visibleSelection } from "../src/persistent/rules.ts";
import type { OutlineResult } from "../src/persistent/rules.ts";
import type { Snapshot } from "../src/persistent/api.ts";

const snapshot: Snapshot = {
  workspaceId: "office", generation: "generation", context: "context", cursor: "cursor", revision: 5,
  projects: [{id:"p",title:"Project",version:1}], tags: [],
  tasks: ["g","a","b","c"].map((id,index) => ({
    id,title:id,parentId:index === 1 || index === 2 ? "g" : "p",kind:index === 0 ? "group" : "action",
    tags:[], due:null,done:false,version:1,
  })),
};

function result(ids: string[]): OutlineResult {
  const rows = ids.map(id => snapshot.tasks.find(task => task.id === id)!).map(task => ({...task, context:task.kind==="group"}));
  return { workspaceId:snapshot.workspaceId, revision:5, rows, matchIds:ids.filter(id => id!=="g"), count:ids.filter(id => id!=="g").length };
}

test("scopes project and tag availability to the same UUID the sidebar selected", () => {
  assert.deepEqual(Object.fromEntries(new URLSearchParams(outlineQuery({kind:"project",id:"p"},"first-available"))), {view:"projects",projectId:"p",availability:"first-available"});
  assert.deepEqual(Object.fromEntries(new URLSearchParams(outlineQuery({kind:"tag",id:"t"},"remaining"))), {view:"tags",tagId:"t",availability:"remaining"});
});

test("filtered rows follow server order, preserve visible selection and collapse ancestors", () => {
  const selected = ["a", "b", "c"];
  const response = result(["c","g","a"]);
  const rows = projectedRows(snapshot,response,new Set());
  assert.deepEqual(rows.map(row => [row.task.id,row.depth,row.hasChildren]), [["c",0,false],["g",0,true],["a",1,false]]);
  assert.deepEqual(visibleSelection(rows,selected), ["a","c"]);
  assert.deepEqual(visibleSelection(projectedRows(snapshot,response,new Set(["g"])), selected), ["c"]);
});

test("project modes use the normal retryable command envelope", () => {
  const command = prepare({type:"set-properties",ids:["p"],properties:{mode:"single-action",autoComplete:false}},snapshot,()=>"operation");
  assert.equal(command.name,"set-properties");
  assert.deepEqual(command.envelope, { context:"context",expectedRevision:5,operationId:"operation",payload:{ids:["p"],mode:"single-action",autoComplete:false}});
});
