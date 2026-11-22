import type { Entry } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";

export type FilingPolicy = "project" | "tag" | "both" | "either";
export type TagStatus = "active" | "held" | "dropped";
export type LifecycleChange =
  | { name: "duplicate" | "delete" | "ungroup"; payload: { ids: string[] } }
  | { name: "restore" | "retrieve" | "move"; payload: { ids: string[]; parentId?: string } }
  | { name: "archive"; payload: { ids: string[]; before: string } }
  | { name: "edit-tag"; payload: {id: string; title?: string; status?: TagStatus; exclusive?: boolean; parentId?: string | null} }
  | { name: "assign-filing"; payload: {ids: string[]; projectId: string | null} }
  | { name: "set-filing-policy"; payload: {policy: FilingPolicy} }
  | { name: "file-inbox"; payload: Record<string, never> };

export interface ShelfItem extends Entry {
  kind: "folder" | "project" | "group" | "action";
  parentId: string;
}

export type FolderEntry = Entry & {parentId?: string | null; position?: number};

export function directoryRows<T extends FolderEntry>(entries: T[], root: string | null): {entry:T; depth:number}[] {
  const children = new Map<string | null,T[]>();
  for (const entry of entries) {
    const parentId = entry.parentId ?? root;
    const siblings = children.get(parentId) ?? [];
    siblings.push(entry);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a,b) => (a.position ?? 0) - (b.position ?? 0));
  }
  const stack = (children.get(root) ?? []).map(entry => ({entry,depth:0})).reverse();
  const result: {entry:T; depth:number}[] = [];
  while(stack.length) {
    const row = stack.pop()!;
    result.push(row);
    const nested = children.get(row.entry.id) ?? [];
    for(let i=nested.length-1;i>=0;i--) stack.push({entry:nested[i]!,depth:row.depth+1});
  }
  return result;
}

export function hasEligibleFiling(snapshot: Snapshot) {
  const policy = snapshot.filingPolicy ?? "project";
  return snapshot.tasks.some(task => {
    if (task.parentId !== "inbox") return false;
    const project = Boolean(task.filingProjectId);
    const tag = task.tags.length > 0;
    switch (policy) {
      case "project": return project;
      case "tag": return tag;
      case "both": return project && tag;
      case "either": return project || tag;
    }
  });
}
