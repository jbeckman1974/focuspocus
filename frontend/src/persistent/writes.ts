import type { Command } from "../outline/index.ts";
import type { Receipt, Snapshot } from "./api.ts";

export type Intent =
  | Command
  | { type: "project" | "tag"; title: string }
  | { type: "undo"; receipt: Receipt };

export interface Write {
  name: string;
  envelope: {
    context: string;
    expectedRevision: number;
    operationId: string;
    payload: Record<string, unknown>;
  };
  intent: Intent;
}

export function prepare(
  intent: Intent,
  snapshot: Snapshot,
  uuid: () => string = () => crypto.randomUUID(),
): Write {
  const envelope = {
    context: snapshot.context,
    expectedRevision: snapshot.revision,
    operationId: uuid(),
  };
  const command = (name: string, payload: Record<string, unknown>): Write => ({
    name,
    envelope: { ...envelope, payload },
    intent,
  });
  switch (intent.type) {
    case "project":
    case "tag":
      return command(intent.type === "project" ? "create-container" : "create-tag", {
        id: uuid(), title: intent.title,
      });
    case "capture":
      return command("capture", { parentId: intent.parentId, items: intent.titles.map(title => ({ id: uuid(), title })) });
    case "group":
      return command("group", { ids: intent.ids, id: uuid(), title: intent.title });
    case "rename":
      return command("bulk-edit", { ids: [intent.id], title: intent.title });
    case "setTitle":
      return command("bulk-edit", { ids: intent.ids, title: intent.title });
    case "setDue":
      return command("bulk-edit", { ids: intent.ids, due: intent.due });
    case "setTag":
      return command("set-tags", { ids: intent.ids, tagId: intent.tagId, enabled: intent.enabled });
    case "undo":
      return command("undo", { operationId: intent.receipt.operationId, contextId: intent.receipt.contextId });
    case "move":
      return command("move", { ids: intent.ids, parentId: intent.parentId, beforeId: intent.beforeId });
    default:
      return command(intent.type, { ids: intent.ids });
  }
}

export function describeDraft(intent: Intent, snapshot: Snapshot) {
  if (intent.type === "capture") return intent.titles.join(", ");
  if ("title" in intent) return intent.title;
  if (intent.type === "setDue") return intent.due ?? "Clear due date";
  if (intent.type === "move") {
    const place = [...snapshot.projects, ...snapshot.tasks].find(i => i.id === intent.parentId);
    return "Move to " + (place?.title ?? "Inbox");
  }
  if (intent.type === "setTag") {
    const tag = snapshot.tags.find(i=>i.id===intent.tagId);
    return (intent.enabled ? "Apply " : "Remove ") + (tag?.title ?? "tag");
  }
  return intent.type;
}
