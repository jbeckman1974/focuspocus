import assert from "node:assert/strict";
import test from "node:test";
import { cachedItem } from "../src/persistent/content/cachedItem.ts";
import { emptyNote } from "../src/persistent/content/document.ts";
import {
  describeUpload, sendOfflineContent,
} from "../src/persistent/content/offlineContent.ts";
import { HttpError, type Snapshot } from "../src/persistent/api.ts";

function snapshot(id: string, withTask: boolean): Snapshot {
  return {
    workspaceId: crypto.randomUUID(), generation:crypto.randomUUID(),revision:2,
    context:crypto.randomUUID(), cursor:crypto.randomUUID(),projects:[],tags:[],
    tasks: withTask ? [{id,kind:"action",parentId:"inbox",title:"Field notes",version:2} as Snapshot["tasks"][number]]:[],
  };
}

test("an unopened existing task can stage an attachment without inventing a note", () => {
  const id = crypto.randomUUID();
  const confirmed = snapshot(id,true);
  const data = {confirmed,projection:confirmed,queue:[],content:{}};
  assert.equal(cachedItem(data,id).known,false);
  assert.equal(cachedItem(data,id).base.itemVersion,2);
  assert.equal(cachedItem({...data,confirmed:{...confirmed,tasks:[]}},id).known,true);
  assert.throws(()=>cachedItem({...data,projection:{...confirmed,tasks:[]}},id),/unavailable/);
});

test("pending notes survive reopening; a different task's draft stays outside the editor", () => {
  const id=crypto.randomUUID(),other=crypto.randomUUID();
  const confirmed=snapshot(id,true);
  const document={paragraphs:[[{text:"First draft"}]]};
  const entry={id:crypto.randomUUID(),content:{action:"save" as const,itemId:id,itemVersion:2,document},state:"queued" as const,reason:""};
  const record={confirmed,projection:confirmed,
    content:{[id]:{revision:1,itemVersion:1,maxFileBytes:123,document:emptyNote,files:[]}},
    queue:[entry,{...entry,id:crypto.randomUUID(),content:{...entry.content,itemId:other,document:emptyNote}}]};
  const result=cachedItem(record,id);
  assert.deepEqual(result.draft,document);
  assert.deepEqual(result.pending,[entry]);
  assert.equal(result.base.revision,1);
  assert.equal(result.base.itemVersion,1);
});

test("restarted uploads send identical bytes, checksum, identity and preconditions with freshly verified sessions",async (t)=>{
  const actor=3,workspace=crypto.randomUUID(),itemId=crypto.randomUUID();
  const bytes=new File([new Uint8Array([0,104,255])],"Field café.bin");
  const content=await describeUpload(itemId,7,bytes,1000);
  const envelope={context:crypto.randomUUID(),operationId:crypto.randomUUID(),expectedRevision:9};
  const writes:{headers:Headers;body:Uint8Array;url:string}[]=[];
  const antiForgery:string[]=[];
  t.mock.method(globalThis,"fetch",async (url:string,options:RequestInit)=>{
    if(url==="/api/v1/session"){
      const csrfToken=crypto.randomUUID();antiForgery.push(csrfToken);
      return Response.json({user:{id:actor},workspaces:[{id:workspace,role:"editor"}],csrfToken});
    }
    writes.push({headers:new Headers(options.headers),url,body:new Uint8Array(await (options.body as Blob).arrayBuffer())});
    if(writes.length===1) throw new TypeError("The receipt was interrupted");
    return Response.json({operationId:envelope.operationId,revision:10});
  });
  const signal=new AbortController().signal;
  await assert.rejects(sendOfflineContent(actor,workspace,content,bytes,envelope,signal),/interrupted/);
  const copied=structuredClone({content,envelope,bytes});
  const result=await sendOfflineContent(actor,workspace,copied.content,copied.bytes,copied.envelope,signal);
  assert.equal(result.operationId,envelope.operationId);
  assert.equal(writes.length,2);
  assert.equal(antiForgery.length,2);
  for(const [index,write] of writes.entries()){
    assert.equal(write.url,`/api/v1/workspaces/${workspace}/content/items/${itemId}/files`);
    assert.deepEqual(write.body,new Uint8Array([0,104,255]));
    assert.equal(write.headers.get("X-CSRFToken"),antiForgery[index]);
    assert.equal(write.headers.get("X-FocusPocus-Actor"),String(actor));
    assert.equal(write.headers.get("X-Workspace-Revision"),"9");
    assert.equal(write.headers.get("X-Item-Version"),"7");
    assert.equal(write.headers.get("X-Operation-Id"),envelope.operationId);
    for(const name of ["X-Write-Context","X-File-Id","X-File-Sha256","X-File-Name","X-File-Type"])
      assert.equal(write.headers.get(name),writes[0].headers.get(name));
  }
  await assert.rejects(sendOfflineContent(actor,workspace,content,new Blob([new Uint8Array([0,0,0])]),envelope,signal),/checksum/);
  assert.equal(writes.length,2);
});

test("expired identity or read-only membership stops upload before any data leaves the device",async(t)=>{
  const workspace=crypto.randomUUID(),actor=4,id=crypto.randomUUID();
  const bytes=new File(["offline"],"survey.txt");
  const change=await describeUpload(id,1,bytes,100);
  const envelope={context:crypto.randomUUID(),operationId:crypto.randomUUID(),expectedRevision:2};
  const signal=new AbortController().signal;
  let role="viewer";
  let current=actor;
  t.mock.method(globalThis,"fetch",async (url:string)=>{
    assert.equal(url,"/api/v1/session");
    return Response.json({user:{id:current},workspaces:[{id:workspace,role}],csrfToken:crypto.randomUUID()});
  });
  await assert.rejects(sendOfflineContent(actor,workspace,change,bytes,envelope,signal),(e)=>e instanceof HttpError && e.status===403);
  role="editor";current++;
  await assert.rejects(sendOfflineContent(actor,workspace,change,bytes,envelope,signal),(e)=>e instanceof HttpError && e.status===401);
  await assert.rejects(describeUpload(id,1,bytes,2),/limit/);
  await assert.rejects(describeUpload(id,1,new File([],"a/b"),2),/filename/);
});
