import type { Snapshot } from "./api.ts";
import type { LifecycleChange, FilingPolicy } from "./lifecycle.ts";

export function FilingControls({snapshot,selection,submit}: {
  snapshot:Snapshot; selection:string[];submit:(change:LifecycleChange)=>void;
}) {
      return <fieldset><legend>Inbox filing</legend>
        <label>File items with<select value={snapshot.filingPolicy ?? "project"} onChange={event=>submit({name:"set-filing-policy",payload:{policy:event.currentTarget.value as FilingPolicy}})}>
          <option value="project">A project</option><option value="tag">A tag</option><option value="both">A project and a tag</option><option value="either">A project or a tag</option>
        </select></label>
        {selection.length>0 && <label>Assigned project<select value={snapshot.tasks.find(t=>t.id===selection[0])?.filingProjectId ?? ""} onChange={event=>submit({name:"assign-filing",payload:{ids:selection,projectId:event.currentTarget.value || null}})}>
          <option value="">No project</option>{snapshot.projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
        </select></label>}
        <button onClick={()=>submit({name:"file-inbox",payload:{}})}>Clean Up Inbox</button>
      </fieldset>;
}
