import type { Entry } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";

export type FilingPolicy = "project" | "tag" | "both" | "either";
export type TagStatus = "active" | "held" | "dropped";
export type LifecycleChange =
  | { name: "set-resolved-cleanup"; payload:{mode:"immediate"|"on-cleanup"} }
  | { name: "duplicate" | "delete" | "ungroup"; payload: { ids: string[] } }
  | {
      name: "restore" | "retrieve" | "move";
      payload: { ids: string[]; parentId?: string };
    }
  | { name: "archive"; payload: { ids: string[]; before: string } }
  | {
      name: "edit-tag";
      payload: {
        id: string;
        title?: string;
        status?: TagStatus;
        exclusive?: boolean;
        parentId?: string | null;
      };
    }
  | {
      name: "assign-filing";
      payload: { ids: string[]; projectId: string | null };
    }
  | { name: "set-filing-policy"; payload: { policy: FilingPolicy } }
  | { name: "file-inbox"; payload: Record<string, never> };

export interface ShelfItem extends Entry {
  kind: "folder" | "project" | "group" | "action";
  parentId: string;
}

export function hasEligibleFiling(snapshot: Snapshot) {
  const policy = snapshot.filingPolicy ?? "project";
  return snapshot.tasks.some((task) => {
    if (task.parentId !== "inbox") return false;
    const project = Boolean(task.filingProjectId);
    const tag = task.tags.length > 0;
    switch (policy) {
      case "project":
        return project;
      case "tag":
        return tag;
      case "both":
        return project && tag;
      case "either":
        return project || tag;
    }
  });
}
