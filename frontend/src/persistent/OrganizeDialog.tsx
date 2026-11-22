import { useEffect, useRef, useState } from "react";
import type { View } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";
import type { FilingPolicy, LifecycleChange, TagStatus } from "./lifecycle.ts";
import type { Intent } from "./writes.ts";
import { DateDefaultsForm } from "./DateDefaultsForm.tsx";
import { Shelf } from "./Shelf.tsx";
import type { ShelfPage } from "./Shelf.tsx";

export function OrganizeDialog({snapshot,view,selection,run,close}: {
  snapshot: Snapshot; view:View; selection:string[]; run:(intent: Intent,base:Snapshot)=>boolean; close:()=>void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [page,setPage]=useState<ShelfPage | "selection">("selection");
  const [destination,setDestination]=useState("");
  const [filename,setFilename]=useState("");
  const [message,setMessage]=useState("");
  const tag = view.kind==="tag" ? snapshot.tags.find(entry => entry.id===view.id) : undefined;
  const containerId = view.kind==="project" || view.kind==="folder" ? view.id : null;
  const ids = selection.length ? selection : containerId ? [containerId] : [];
  const containers = [...(snapshot.folders ?? []),...snapshot.projects,...snapshot.tasks.filter(task=>task.kind==="group")];
  const [base] = useState(snapshot);
  useEffect(()=>{
    const element=dialog.current;
    element?.showModal();
    return ()=>element?.close();
  },[]);
  function submit(change: LifecycleChange, revision = base.revision) {
    if(run({type:"lifecycle",change},{...base,revision})) close();
    else setMessage("Finish the pending change before organizing these items.");
  }
  return <dialog className="fp-dialog organize-dialog" ref={dialog} onCancel={event=>{event.preventDefault();close();}} aria-labelledby="organize-heading">
    <header><h2 id="organize-heading">Organize workspace</h2><button onClick={close}>Close</button></header>
    <nav aria-label="Organization tools">{([["selection","Selection"],["trash","Trash"],["archive","Archive"],["preview","Archive by date"]] as const).map(([value,label])=>
      <button key={value} aria-pressed={page===value} onClick={()=>setPage(value)}>{label}</button>
    )}</nav>
    {message && <p role="alert">{message}</p>}
    {page !== "selection" ? <Shelf key={page} page={page} snapshot={snapshot} submit={submit}/> : <>
      {ids.length > 0 && <fieldset><legend>{ids.length===1 ? "Selected item" : `${ids.length} selected items`}</legend>
        <button onClick={()=>submit({name:"duplicate",payload:{ids}})}>Duplicate selection</button>
        <button onClick={()=>submit({name:"delete",payload:{ids}})}>Move to Trash</button>
        {selection.length>0 && selection.every(id=>snapshot.tasks.some(t=>t.id===id && t.kind==="group")) && <button onClick={()=>submit({name:"ungroup",payload:{ids}})}>Ungroup</button>}
        <label>Destination<select value={destination} onChange={event=>setDestination(event.currentTarget.value)}>
          <option value="">Choose destination</option><option value="root">Project list</option><option value="inbox">Inbox</option>
          {containers.filter(item=>!ids.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        <button disabled={!destination} onClick={()=>submit({name:"move",payload:{ids,parentId:destination}})}>Move selection</button>
      </fieldset>}
      <fieldset><legend>Folders</legend><label>Folder name<input value={filename} onChange={event=>setFilename(event.currentTarget.value)}/></label>
        <button disabled={!filename.trim()} onClick={()=>{if(run({type:"folder",title:filename.trim(),parentId:view.kind==="folder"?view.id:"root"},base)) close();}}>Create folder</button>
      </fieldset>
      {tag && <fieldset><legend>Tag settings</legend>
        <label>Tag status<select value={tag.status ?? "active"} onChange={event=>submit({name:"edit-tag",payload:{id:tag.id,status:event.currentTarget.value as TagStatus}})}>
          <option value="active">Active</option><option value="held">On hold</option><option value="dropped">Dropped</option>
        </select></label>
        <label>Parent tag<select value={tag.parentId ?? ""} onChange={event=>submit({name:"edit-tag",payload:{id:tag.id,parentId:event.currentTarget.value || null}})}>
          <option value="">No parent</option>{snapshot.tags.filter(t=>t.id!==tag.id).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
        </select></label>
        <label><input type="checkbox" checked={tag.exclusive ?? false} onChange={event=>submit({name:"edit-tag",payload:{id:tag.id,exclusive:event.currentTarget.checked}})}/>Mutually exclusive child tags</label>
      </fieldset>}
      <DateDefaultsForm base={base} submit={intent=>{if(run(intent,base)) close();}}/>
      {view.kind==="inbox" && <fieldset><legend>Inbox filing</legend>
        <label>File items with<select value={snapshot.filingPolicy ?? "project"} onChange={event=>submit({name:"set-filing-policy",payload:{policy:event.currentTarget.value as FilingPolicy}})}>
          <option value="project">A project</option><option value="tag">A tag</option><option value="both">A project and a tag</option><option value="either">A project or a tag</option>
        </select></label>
        {selection.length>0 && <label>Assigned project<select value={snapshot.tasks.find(t=>t.id===selection[0])?.filingProjectId ?? ""} onChange={event=>submit({name:"assign-filing",payload:{ids:selection,projectId:event.currentTarget.value || null}})}>
          <option value="">No project</option>{snapshot.projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
        </select></label>}
        <button onClick={()=>submit({name:"file-inbox",payload:{}})}>Clean Up Inbox</button>
      </fieldset>}
    </>}
  </dialog>;
}
