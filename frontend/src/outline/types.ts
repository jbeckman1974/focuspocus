export const INBOX = "inbox";

export interface Entry {
  id: string;
  title: string;
}

export interface Task extends Entry {
  parentId: string;
  kind: "action" | "group";
  tags: string[];
  due: string | null;
  done: boolean;
}

export interface Workspace {
  // Filtering this array by parentId gives the manual order of that parent's children.
  tasks: Task[];
  projects: Entry[];
  tags: Entry[];
}

export type View =
  | { kind: "inbox" }
  | { kind: "all" }
  | { kind: "project"; id: string }
  | { kind: "tag"; id: string };

export type Command =
  | { type: "capture"; parentId: string; titles: string[] }
  | { type: "rename"; id: string; title: string }
  | { type: "setTitle"; ids: string[]; title: string }
  | { type: "setTag"; ids: string[]; tagId: string; enabled: boolean }
  | { type: "setDue"; ids: string[]; due: string | null }
  | { type: "group"; ids: string[]; title: string }
  | { type: "indent" | "outdent"; ids: string[] }
  | { type: "complete" | "reopen"; ids: string[] }
  | { type: "move"; ids: string[]; parentId: string; beforeId?: string };

export interface CommandResult {
  workspace: Workspace;
  selection: string[];
}

export interface OutlineRow {
  task: Task;
  depth: number;
  hasChildren: boolean;
}
