import { applyCommand } from "../../outline/commands.ts";
import type { Snapshot } from "../api.ts";
import type { Write } from "../writes.ts";
import type { QueueEntry } from "./queueTypes.ts";

// The confirmed server revision stays fixed until an actual receipt arrives.
// New IDs always come from the prepared envelope, including after a restart.
export function project(snapshot: Snapshot, write: Write): Snapshot {
  const { intent } = write;
  const payload = write.envelope.payload;
  switch (intent.type) {
    case "capture":
    case "rename":
    case "setTitle":
    case "setDue":
    case "setTag":
    case "complete":
    case "reopen":
    case "group":
    case "indent":
    case "outdent":
    case "move": {
      const ids = intent.type === "capture"
        ? (payload.items as {id:string}[]).map(row => row.id)
        : [String(payload.id)];
      const result = applyCommand(snapshot, intent, () => ids.shift() ?? "");
      const versions = new Map(snapshot.tasks.map(row => [row.id, row.version]));
      const tasks = result.workspace.tasks.map(row => ({
        ...row,
        version: versions.get(row.id) ?? 0,
      })) as Snapshot["tasks"];
      return { ...snapshot, tasks };
    }
    case "tag":
    case "folder":
    case "project": {
      const key = intent.type === "tag" ? "tags" : intent.type === "folder" ? "folders" : "projects";
      const entry = {id:String(payload.id), title:intent.title, parentId:intent.parentId ?? "root", version:0};
      return {...snapshot, [key]:[...(snapshot[key] ?? []), entry]};
    }
    case "set-properties":
      return {...snapshot, tasks:snapshot.tasks.map(row=>intent.ids.includes(row.id)?{...row,...intent.properties}:row)};
    case "set-schedule":
      return {...snapshot,tasks:snapshot.tasks.map(row=>intent.ids.includes(row.id)?{...row,schedule:{...row.schedule,...intent.changes.schedule},...(intent.changes.durationMinutes===undefined?{}:{durationMinutes:intent.changes.durationMinutes})}:row)};
    case "lifecycle":
      if(intent.change.name==="delete"){
        const removed = new Set(intent.change.payload.ids);
        const children = new Map<string,string[]>();
        for(const row of [...(snapshot.folders ?? []),...snapshot.projects,...snapshot.tasks]){
          if(row.parentId) children.set(row.parentId,[...(children.get(row.parentId) ?? []),row.id]);
        }
        for(const id of removed) for(const child of children.get(id)??[]) removed.add(child);
        return {...snapshot, tasks:snapshot.tasks.filter(row=>!removed.has(row.id)),projects:snapshot.projects.filter(row=>!removed.has(row.id)),folders:snapshot.folders?.filter(row=>!removed.has(row.id))};
      }
      return snapshot;
    default:
      // The server owns recurrence, effective dates and other derived rules.
      // The queue records the verb and input until the committed snapshot arrives.
      return snapshot;
  }
}

export function projectQueue(confirmed:Snapshot, queue:QueueEntry[]){
  let result=confirmed;
  const blocked=new Set<string>();
  for(const entry of queue){
    if(entry.state==="conflict" || entry.dependencies.some(id=>blocked.has(id))){
      blocked.add(entry.id);
      continue;
    }
    if(!entry.content){
      try{result=project(result,entry.write);}
      catch{blocked.add(entry.id);}
    }
  }
  return result;
}
