import {useState} from "react";
import type {Snapshot} from "../api.ts";
import {useAction} from "./hooks.ts";
import {editPlace,placeChange} from "./placeDraft.ts";
import type {PlaceDraft,Places} from "./placeDraft.ts";
import {WorkspaceFailure,type WorkspaceClient} from "./transport.ts";

export function PlaceEditor({client,snapshot,data,accept,reload}:{client:WorkspaceClient;snapshot:Snapshot;data:Places|undefined;accept:(r:Places)=>void;reload:()=>void}) {
  const action=useAction();
  const [draft,setDraft]=useState<PlaceDraft>();
  const [attempt,setAttempt]=useState<ReturnType<typeof placeChange>>();
  const [conflict,setConflict]=useState(false);
  const saved=data?.places.find(p=>p.tagId===draft?.tagId);
  const tag=snapshot.tags.find(t=>t.id===draft?.tagId);
  const latestVersion=Math.max(tag?.version??0,saved?.version??0);
  const currentData = !!data && data.revision>=snapshot.revision && (!saved || saved.version>= (tag?.version??0));
  const changed=!!draft && (conflict || latestVersion>draft.version);

  function choose(tagId:string) {
    const entry=snapshot.tags.find(t=>t.id===tagId);
    const place=data?.places.find(p=>p.tagId===tagId);
    setDraft(entry ? editPlace(entry.id,place?.version??entry.version,place) : undefined);
    setConflict(false);setAttempt(undefined);
  }
  function send(body:ReturnType<typeof placeChange>) {
    setAttempt(body);
    void action.run(async()=>{
      try {
        const next=await client.post<Places>("integrations/places",body);
        accept(next);
        const result=next.places.find(p=>p.tagId===body.tagId);
        setDraft(result?editPlace(result.tagId,result.version,result):undefined);
        setConflict(false);setAttempt(undefined);
      } catch(e){
        if(e instanceof WorkspaceFailure && e.status===409){
          setConflict(true);setAttempt(undefined);reload();
        } else if(e instanceof WorkspaceFailure && e.status<500) {
          setAttempt(undefined);
        }
        throw e;
      }
    });
  }
  function edit(field:"latitude"|"longitude"|"radius",value:string){
    if(draft)setDraft({...draft,[field]:value});
  }
  return <form onSubmit={e=>{e.preventDefault();if(draft && !changed && !attempt)send(placeChange(draft,false,snapshot.context,crypto.randomUUID()));}}>
    <h4>Tag location</h4>
    <label>Location tag <select required disabled={!!attempt || action.busy || !data || data.revision<snapshot.revision} value={draft?.tagId??""} onChange={e=>choose(e.target.value)}>
      <option value="">Choose a tag</option>{snapshot.tags.map(t=><option value={t.id} key={t.id}>{t.title}</option>)}
    </select></label>
    <label>Latitude <input required type="number" step="any" min="-90" max="90" disabled={!draft||!!attempt} value={draft?.latitude??""} onChange={e=>edit("latitude",e.target.value)}/></label>
    <label>Longitude <input required type="number" step="any" min="-180" max="180" disabled={!draft||!!attempt} value={draft?.longitude??""} onChange={e=>edit("longitude",e.target.value)}/></label>
    <label>Radius in meters <input required type="number" min="1" max="100000" disabled={!draft||!!attempt} value={draft?.radius??"250"} onChange={e=>edit("radius",e.target.value)}/></label>
    {changed && !attempt && <fieldset><legend>Location changed since editing began</legend>
      <p>{saved ? "Current location: "+saved.latitude+", "+saved.longitude+" · "+saved.radiusMeters+" m" : "No saved location is present."}</p>
      <button type="button" disabled={!tag||!currentData||action.busy} onClick={()=>choose(tag!.id)}>Load current location</button>
      <button type="button" disabled={!tag||!currentData||latestVersion<= (draft?.version??0)||action.busy} onClick={()=>{if(draft){setDraft({...draft,version:latestVersion});setConflict(false);}}}>Keep my edits against this version</button>
    </fieldset>}
    {attempt && !action.busy ? <button type="button" onClick={()=>send(attempt)}>Retry same location change</button> :
      <button disabled={action.busy||!draft||!!attempt||changed}>Save tag location</button>}
    {saved && draft && <button type="button" disabled={action.busy||!!attempt||changed} onClick={()=>send(placeChange(draft,true,snapshot.context,crypto.randomUUID()))}>Remove tag location</button>}
    {action.error && <p role="alert">{action.error}</p>}
  </form>;
}
