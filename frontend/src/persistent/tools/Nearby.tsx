import { useState } from "react";
import type { Snapshot } from "../api.ts";
import type { WorkspaceClient } from "./transport.ts";
import { useAction, useResource } from "./hooks.ts";
import { distanceMeters } from "./distance.ts";
import type { Point } from "./distance.ts";

interface Place extends Point {tagId:string;title:string;radiusMeters:number;itemIds:string[]}
export function Nearby({client,snapshot,editable,openItem}:{client:WorkspaceClient;snapshot:Snapshot;editable:boolean;openItem:(id:string)=>void}){
  const data=useResource<{places:Place[]}>(client,"integrations/places"),action=useAction();
  const [point,setPoint]=useState<Point>();
  const [manual,setManual]=useState("");
  const [tag,setTag]=useState(""),[lat,setLat]=useState(""),[lon,setLon]=useState(""),[radius,setRadius]=useState("250");
  const places=data.data?.places??[];
  const origin=manual?places.find(p=>p.tagId===manual):point;
  const matches=origin?places.map(p=>({place:p,meters:distanceMeters(origin,p)})).filter(p=>p.meters<=p.place.radiusMeters).sort((a,b)=>a.meters-b.meters):[];
  const titles=new Map(snapshot.tasks.map(t=>[t.id,t.title]));
  async function locate(){
    if(!navigator.geolocation)throw new Error("Location is unavailable. Choose a saved place instead.");
    const result=await new Promise<GeolocationPosition>((ok,fail)=>navigator.geolocation.getCurrentPosition(ok,()=>fail(new Error("Location was unavailable or denied. Choose a saved place instead.")),{timeout:10000,maximumAge:30000}));
    client.signal.throwIfAborted();
    setPoint({latitude:result.coords.latitude,longitude:result.coords.longitude});setManual("");
  }
  return <><h3>Nearby tasks</h3>
    <button disabled={action.busy} onClick={()=>void action.run(locate)}>Use current location</button>
    <label>Or choose a saved place <select value={manual} onChange={e=>{setManual(e.target.value);setPoint(undefined);}}><option value="">Choose a place</option>{places.map(p=><option value={p.tagId} key={p.tagId}>{p.title}</option>)}</select></label>
    {origin && (matches.some(m=>m.place.itemIds.length)?matches.filter(m=>m.place.itemIds.length).map(({place,meters})=><section key={place.tagId}><h4>{place.title} · {Math.round(meters)} m</h4><ul>{place.itemIds.filter(i=>titles.has(i)).map(id=><li key={id}><button onClick={()=>openItem(id)}>{titles.get(id)}</button></li>)}</ul></section>):<p>No available tasks within these radii.</p>)}
    {editable && <form onSubmit={e=>{e.preventDefault();void action.run(async()=>{data.setData(await client.post<{places:Place[]}>("integrations/places",{tagId:tag,latitude:Number(lat),longitude:Number(lon),radiusMeters:Number(radius)}));});}}>
      <h4>Tag location</h4><label>Location tag <select required value={tag} onChange={e=>{setTag(e.target.value);const p=places.find(p=>p.tagId===e.target.value);setLat(p?String(p.latitude):"");setLon(p?String(p.longitude):"");setRadius(String(p?.radiusMeters??250));}}><option value="">Choose a tag</option>{snapshot.tags.map(t=><option value={t.id} key={t.id}>{t.title}</option>)}</select></label>
      <label>Latitude <input required type="number" step="any" min="-90" max="90" value={lat} onChange={e=>setLat(e.target.value)}/></label>
      <label>Longitude <input required type="number" step="any" min="-180" max="180" value={lon} onChange={e=>setLon(e.target.value)}/></label>
      <label>Radius in meters <input required type="number" min="1" max="100000" value={radius} onChange={e=>setRadius(e.target.value)}/></label>
      <button disabled={action.busy||!tag}>Save tag location</button>
      {places.some(p=>p.tagId===tag) && <button type="button" disabled={action.busy} onClick={()=>void action.run(async()=>{data.setData(await client.post<{places:Place[]}>("integrations/places",{tagId:tag,remove:true}));setLat("");setLon("");})}>Remove tag location</button>}
    </form>}
    {(action.error||data.error) && <p role="alert">{action.error||data.error} <button onClick={data.reload}>Refresh places</button></p>}
  </>;
}
