import { useEffect, useState } from "react";
import type { Snapshot } from "../api.ts";
import { useResource, useAction } from "./hooks.ts";
import type { WorkspaceClient } from "./transport.ts";
import { DeviceNotifications } from "./Notifications.tsx";

interface Calendar {source:string;label:string;status:string;lastSuccess:string|null}
interface Calendars {sources:{key:string;label:string}[];connections:Calendar[]}
interface Reminder {id:string;itemId:string;at:string;status:string;delivery:string}
interface Reminders {reminders:Reminder[];pushPublicKey:string|null}

export function CalendarPanel({client}:{client:WorkspaceClient}){
  const state=useResource<Calendars>(client,"integrations/calendars"),action=useAction();
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(!document.hidden)state.reload();},10000);
    return ()=>window.clearInterval(timer);
  },[state.reload]);
  function send(source:string,op:string){
    void action.run(async()=>{state.setData(await client.post<Calendars>("integrations/calendars",{source,action:op}));});
  }
  return <><h3>My read-only calendars</h3>
    {state.data && !state.data.sources.length && !state.data.connections.length && <p>No calendar sources are configured for this account.</p>}
    <ul>{state.data?.connections.map(c=><li key={c.source}><strong>{c.label}</strong> · {c.status.replaceAll("_"," ")}
      {c.lastSuccess && <> · Last refreshed {new Date(c.lastSuccess).toLocaleString()}</>}{" "}
      {c.status==="paused" ? <button disabled={action.busy} onClick={()=>send(c.source,"connect")}>Reconnect {c.label}</button>:<button disabled={action.busy} onClick={()=>send(c.source,"refresh")}>Refresh {c.label}</button>}{" "}
      <button disabled={action.busy} onClick={()=>send(c.source,"disconnect")}>Disconnect {c.label}</button></li>)}</ul>
    {state.data?.sources.filter(s=>!state.data?.connections.some(c=>c.source===s.key)).map(s=><button key={s.key} disabled={action.busy} onClick={()=>send(s.key,"connect")}>Connect {s.label}</button>)}
    <button disabled={action.busy} onClick={state.reload}>Check calendar status</button>
    {(state.error||action.error) && <p role="alert">{state.error||action.error}</p>}
  </>;
}
export function ReminderPanel({client,snapshot,selected}:{client:WorkspaceClient;snapshot:Snapshot;selected:string[]}){
  const state=useResource<Reminders>(client,"integrations/reminders"), action=useAction();
  const [itemId,setItem]=useState(snapshot.tasks.find(t=>selected.includes(t.id))?.id??"");
  const [when,setWhen]=useState("");
  const [id,setId]=useState(()=>crypto.randomUUID());
  const titles=new Map(snapshot.tasks.map(t=>[t.id,t.title]));
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(!document.hidden)state.reload();},15000);
    return ()=>window.clearInterval(timer);
  },[state.reload]);
  function command(r:Reminder,op:string){void action.run(async()=>state.setData(await client.post<Reminders>("integrations/reminders",{id:r.id,action:op})));}
  return <><h3>My reminders</h3>
    <form onSubmit={e=>{e.preventDefault();void action.run(async()=>{const date=new Date(when);if(!Number.isFinite(date.getTime()))throw new Error("Choose a valid local date and time.");
      state.setData(await client.post<Reminders>("integrations/reminders",{id,itemId,at:date.toISOString()}));setId(crypto.randomUUID());setWhen("");});}}>
      <label>Reminder task <select value={itemId} required onChange={e=>{setItem(e.target.value);setId(crypto.randomUUID());}}><option value="">Choose a task</option>{snapshot.tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      <label>Remind me at ({Intl.DateTimeFormat().resolvedOptions().timeZone}) <input type="datetime-local" required value={when} onChange={e=>{setWhen(e.target.value);setId(crypto.randomUUID());}}/></label>
      <button disabled={action.busy||!itemId||!when}>Add reminder</button>
    </form>
    <ul>{state.data?.reminders.map(r=><li key={r.id}>{titles.get(r.itemId)??"Task"} · {new Date(r.at).toLocaleString()} · {r.status.replaceAll("_"," ")} ({r.delivery.replaceAll("_"," ")}){" "}
      {r.status==="paused" && <button disabled={action.busy} onClick={()=>command(r,"resume")}>Resume reminder</button>}{" "}
      {!["cancelled","sent","delivered"].includes(r.status) && <button disabled={action.busy} onClick={()=>command(r,"cancel")}>Cancel reminder</button>}</li>)}</ul>
    <button disabled={action.busy} onClick={state.reload}>Refresh reminders</button>
    {(state.error||action.error) && <p role="alert">{state.error||action.error}</p>}
    {state.data && <DeviceNotifications client={client} publicKey={state.data.pushPublicKey}/>}
  </>;
}
