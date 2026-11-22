import { useRef, useState } from "react";
import type {WorkspaceClient} from "./transport.ts";
import {useAction} from "./hooks.ts";

export function ExportPanel({client,owner,selection,choose}:{client:WorkspaceClient;owner:boolean;selection:string[];choose:(id:string)=>Promise<void>}) {
  const action=useAction();
  const [personal,setPersonal]=useState(false);
  const [selected,setSelected]=useState(false);
  const [restorePersonal,setRestorePersonal]=useState(false);
  const [account,setAccount]=useState(false);
  const [file,setFile]=useState<File>();
  const operation=useRef("");
  const [result,setResult]=useState<{workspaceId:string;counts:Record<string,number>}>();
  const [history,setHistory]=useState<{at:string;action:string;items:unknown[]}[]>();
  function download(path:string,name:string){
    void action.run(async()=>{
      const response=await client.request("portability/"+path);
      const blob=await response.blob();
      const access=await client.json<{role:string}>("sharing/");
      if(path!=="personal" && access.role!=="owner") throw new Error("Workspace ownership changed during the download.");
      client.signal.throwIfAborted();
      const url=URL.createObjectURL(blob),link=document.createElement("a");
      link.href=url;link.download="focuspocus-"+name;
      document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  }
  const query=new URLSearchParams();
  if(selected)selection.forEach(id=>query.append("id",id));
  return <>
    <h3>Export workspace data</h3>
    <button disabled={action.busy} onClick={()=>download("personal","personal.json")}>Download my settings</button>
    {owner && <>
      <fieldset><legend>Workspace bundle</legend><label><input type="checkbox" checked={personal} onChange={e=>setPersonal(e.target.checked)}/> Include my personal settings</label>
        <button disabled={action.busy} onClick={()=>download("bundle"+(personal?"?personal=1":""),"workspace.zip")}>Download workspace bundle</button></fieldset>
      <fieldset><legend>Readable CSV outline</legend><label><input type="checkbox" checked={selected} disabled={!selection.length} onChange={e=>setSelected(e.target.checked)}/> Selected rows only ({selection.length})</label>
        <button disabled={action.busy||(selected&&!selection.length)} onClick={()=>download("outline.csv?"+query.toString(),"outline.csv")}>Download outline CSV</button></fieldset>
      <form onSubmit={e=>{e.preventDefault();if(!file)return;void action.run(async()=>{
        if(!operation.current)operation.current=crypto.randomUUID();
        const params=new URLSearchParams();
        if(restorePersonal)params.set("personal","1");if(account && restorePersonal)params.set("accountSettings","1");
        const r=await client.json<{workspaceId:string;counts:Record<string,number>}>("portability/restore?"+params.toString(),{method:"POST",body:file,headers:{"Content-Type":"application/zip","X-Operation-Id":operation.current}});
        setResult(r);
      });}}>
        <h3>Restore into a new workspace</h3>
        <label>Workspace bundle <input type="file" accept=".zip,application/zip" onChange={e=>{setFile(e.target.files?.[0]);operation.current="";setResult(undefined);}}/></label>
        <label><input type="checkbox" checked={restorePersonal} onChange={e=>{setRestorePersonal(e.target.checked);setAccount(false);operation.current="";setResult(undefined);}}/> Restore personal workspace settings</label>
        <label><input type="checkbox" disabled={!restorePersonal} checked={account} onChange={e=>{setAccount(e.target.checked);operation.current="";setResult(undefined);}}/> Apply the bundle’s account-wide settings to my account</label>
        <button disabled={action.busy||!file||!!result}>Restore bundle</button>
      </form>
      {result && <><p role="status">Created a new workspace. {Object.entries(result.counts).map(([k,v])=>k+" "+v).join(" · ")}</p><button onClick={()=>void action.run(()=>choose(result.workspaceId))}>Open restored workspace</button></>}
      <button disabled={action.busy} onClick={()=>void action.run(async()=>{const r=await client.json<{history:NonNullable<typeof history>}>("portability/history");setHistory(r.history);})}>Show workspace history</button>
      {history && <ul aria-label="Workspace history">{history.map((h,i)=><li key={i}>{new Date(h.at).toLocaleString()} · {h.action}</li>)}</ul>}
    </>}
    {action.error && <p role="alert">{action.error}</p>}
  </>;
}
