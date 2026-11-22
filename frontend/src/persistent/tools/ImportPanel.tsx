import { useRef, useState } from "react";
import type { Snapshot } from "../api.ts";
import type { WorkspaceClient } from "./transport.ts";
import { WorkspaceFailure } from "./transport.ts";
import { useAction, useResource } from "./hooks.ts";

interface Batch {id:string; format:string;status:string;sourceSha256:string;rowCount:number}
interface Preview extends Batch {
  expectedRevision:number;encoding:string;canCommit:boolean;
  rows:{line:number;title:string;kind:string;parentLine:number|null;sourceId:string|null;state:string;fields:Record<string,unknown>}[];
  issues:{line:number|null;field:string;category:string;message:string}[];
}
type Transition = "commit"|"rollback"|"abort";
export function ImportPanel({client,snapshot,refresh}:{client:WorkspaceClient;snapshot:Snapshot;refresh:()=>Promise<void>}) {
  const list=useResource<{batches:Batch[]}>(client,"imports/");
  const action=useAction();
  const [format,setFormat]=useState("taskpaper");
  const [file,setFile]=useState<File>();
  const [batch,setBatch]=useState<Preview>();
  const [stale,setStale]=useState(false);
  const [rollback,setRollback]=useState(false);
  const receipt=useRef<{key:string;operationId:string;context:string}|undefined>(undefined);
  function show(next:Preview){setBatch(next);setStale(false);setRollback(false);receipt.current=undefined;}
  function select(id:string){void action.run(async()=>{show(await client.json<Preview>("imports/"+encodeURIComponent(id)));});}
  function transition(name:Transition){
    if(!batch)return;
    void action.run(async()=>{
      const key=[batch.id,name,batch.expectedRevision].join("/");
      if(receipt.current?.key!==key)receipt.current={key,operationId:crypto.randomUUID(),context:snapshot.context};
      try {
        const r=await client.post<Preview>("imports/"+batch.id+"/"+name,{
          operationId:receipt.current.operationId,context:receipt.current.context,expectedRevision:batch.expectedRevision,
        });
        show(r);list.reload();await refresh();
      } catch(e) { if(e instanceof WorkspaceFailure && e.status===409) setStale(true);throw e; }
    });
  }
  return <>
    <h3>Import an outline</h3>
    <form onSubmit={e=>{e.preventDefault();if(!file)return;void action.run(async()=>{
      if(file.size>512*1024)throw new Error("Choose a file of 512 KiB or less.");
      show(await client.json<Preview>("imports/?format="+format,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file})); list.reload();
    });}}>
      <label>Source format <select value={format} onChange={e=>setFormat(e.target.value)}><option value="taskpaper">TaskPaper</option><option value="csv">CSV</option></select></label>
      <label>Source file <input type="file" onChange={e=>setFile(e.target.files?.[0])}/></label>
      <button disabled={!file||action.busy}>Preview import</button>
    </form>
    {(action.error||list.error) && <p role="alert">{action.error||list.error}</p>}
    {list.data && list.data.batches.length>0 && <label>Previous imports <select value={batch?.id??""} disabled={action.busy} onChange={e=>{if(e.target.value)select(e.target.value);}}>
      <option value="">Choose an import</option>{list.data.batches.map(b=><option key={b.id} value={b.id}>{b.format.toUpperCase()} · {b.rowCount} rows · {b.status} · {b.sourceSha256.slice(0,8)}</option>)}
    </select></label>}
    {batch && <section aria-label="Import comparison"><h3>Import comparison</h3>
      <p role="status">{batch.status} · {batch.rowCount} rows · {batch.encoding}</p>
      {batch.issues.length>0 ? <><h4>Field changes and omissions</h4><ul>{batch.issues.map((i,n)=><li key={n}>{i.line ? "Line "+i.line+" · " : ""}{i.field} · {i.category} · {i.message}</li>)}</ul></>:<p>No field losses reported.</p>}
      {batch.rows.length>0 && <div className="scroll-table"><table><caption>Source rows and planned values</caption><thead><tr><th>Line</th><th>Title</th><th>Kind</th><th>Parent line</th><th>Result</th><th>Fields</th></tr></thead>
        <tbody>{batch.rows.map((row,i)=><tr key={i}><td>{row.line}</td><td>{row.title}</td><td>{row.kind}</td><td>{row.parentLine??"—"}</td><td>{row.state}</td><td><details><summary>Values</summary><dl>{Object.entries(row.fields).map(([name,v])=><div key={name}><dt>{name}</dt><dd>{typeof v==="object"?JSON.stringify(v):String(v)}</dd></div>)}</dl></details></td></tr>)}</tbody></table></div>}
      <div className="actions">
        <button disabled={action.busy} onClick={()=>select(batch.id)}>Refresh comparison</button>
        {batch.status==="staged" && <><button disabled={action.busy||stale||!batch.canCommit} onClick={()=>transition("commit")}>Commit import</button><button disabled={action.busy||stale} onClick={()=>transition("abort")}>Discard preview</button></>}
        {batch.status==="committed" && (rollback?<><button disabled={action.busy||stale} onClick={()=>transition("rollback")}>Confirm rollback</button><button onClick={()=>setRollback(false)}>Keep import</button></>:<button onClick={()=>setRollback(true)}>Roll back import…</button>)}
      </div>
    </section>}
  </>;
}
