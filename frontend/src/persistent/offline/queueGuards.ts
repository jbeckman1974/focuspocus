import type { Receipt, Snapshot } from "../api.ts";
import type { Write } from "../writes.ts";
import { rows, type Guard, type QueueEntry } from "./queueTypes.ts";

function children(snapshot:Snapshot,parent:string) {
  return [...snapshot.tasks,...snapshot.projects,...(snapshot.folders??[])]
    .filter(row=>(row.parentId??"root")===parent).map(row=>row.id);
}

export function resourceValue(snapshot:Snapshot,key:string):string {
  if(key==="workspace") return String(snapshot.revision);
  const id=key.slice(key.indexOf(":")+1);
  if(key.startsWith("list:")) return JSON.stringify(children(snapshot,id));
  const row=rows(snapshot).find(row=>row.id===id);
  return row ? String(row.version) : "absent";
}

export function writeScopes(write:Write,snapshot:Snapshot,contentItem?:string) {
  const p=write.envelope.payload;
  const ids=new Set<string>();
  const lists=new Set<string>();
  const id=(value:unknown)=> {if(typeof value==="string" && !["inbox","root"].includes(value))ids.add(value);};
  const list=(value:unknown)=> {if(typeof value==="string"){lists.add(value); id(value);}};
  if(contentItem) id(contentItem);
  else {
    if(Array.isArray(p.ids)) p.ids.forEach(id);
    id(p.id); id(p.tagId); id(p.beforeId);
    switch(write.name){
      case "capture":
        list(p.parentId);
        (p.items as {id:string}[]).forEach(row=>id(row.id));
        break;
      case "create-container":
        list(p.parentId??"root");break;
      case "create-tag":
      case "bulk-edit":
      case "set-tags":
      case "set-note":
        break;
      case "move":
      case "delete":
      case "group":
      case "indent":
      case "outdent": {
        list(p.parentId);
        const all=[...snapshot.tasks,...snapshot.projects,...(snapshot.folders??[])];
        const selected=new Set(Array.isArray(p.ids)?p.ids as string[]:[]);
        const byId=new Map(all.map(row=>[row.id,row]));
        for(const selectedId of selected){
          const row=byId.get(selectedId);
          if(row)list(row.parentId??"root");
        }
        // Parent edits, inserted siblings and new descendants can all alter
        // the meaning of a structural change made against the previous tree.
        const descendants=new Map<string,string[]>();
        for(const row of all){
          const parent=row.parentId??"root";
          if(!descendants.has(parent))descendants.set(parent,[]);
          descendants.get(parent)!.push(row.id);
        }
        for(const selectedId of selected){
          list(selectedId);
          for(const child of descendants.get(selectedId)??[])selected.add(child);
        }
        break;
      }
      default:
        // Server-owned rules may consult data beyond the listed rows.
        return ["workspace"];
    }
  }
  return [...[...ids].map(v=>"row:"+v), ...[...lists].map(v=>"list:"+v)];
}

function overlaps(first:string[],second:string[]) {
  return first.includes("workspace") || second.includes("workspace") || first.some(key=>second.includes(key));
}

export function prerequisites(snapshot:Snapshot,keys:string[],queue:QueueEntry[]){
  const dependencies=queue.filter(entry=>overlaps(entry.affects,keys)).map(entry=>entry.id);
  const guards:Guard[]=keys.map(key=>({
    key,
    value:resourceValue(snapshot,key),
    predecessors:queue.filter(entry=>overlaps(entry.affects,[key])).map(entry=>entry.id),
  }));
  return {guards, dependencies};
}

export function changedResources(guards:Guard[],current:Snapshot,receipts:Record<string,Receipt>){
  return guards.filter(guard=>{
    let expected=guard.value;
    if(guard.key==="workspace"){
      for(const predecessor of guard.predecessors){
        const receipt=receipts[predecessor];if(receipt)expected=String(receipt.revision);
      }
    }else if(guard.key.startsWith("row:")){
      for(const predecessor of guard.predecessors){
        const version=receipts[predecessor]?.versions?.[guard.key.slice(4)];
        if(version!==undefined)expected=String(version);
      }
    }
    return expected!==resourceValue(current,guard.key);
  });
}

export function comparison(snapshot:Snapshot,keys:string[]){
  const data=rows(snapshot);
  return keys.slice(0,12).map(key=>{
    if(key==="workspace")return "Workspace revision "+snapshot.revision;
    if(key.startsWith("list:")){
      const members=children(snapshot,key.slice(5));
      const names=members.slice(0,6).map(id=>data.find(row=>row.id===id)?.title??id);
      return "Order: "+(names.join(", ")||"empty")+(members.length>6?"…":"");
    }
    const row=data.find(row=>row.id===key.slice(4));
    return row?row.title+" (version "+row.version+")":"Item absent";
  }).join(" · ");
}
