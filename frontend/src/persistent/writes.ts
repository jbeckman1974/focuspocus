import type { RepeatChange } from "./repeat.ts";
import type { Command } from "../outline/index.ts";
import type { Receipt, Snapshot } from "./api.ts";

import type { DateChanges, DateDefaults } from "./schedule.ts";
import type { LifecycleChange } from "./lifecycle.ts";
import type { Properties } from "./rules.ts";

export type Intent =
  | { type: "set-schedule"; ids:string[]; changes:DateChanges }
  | { type: "set-date-settings"; timeZone: string; dateDefaults: DateDefaults }
  | { type: "repeat"; change:RepeatChange }
  | { type: "lifecycle"; change: LifecycleChange }
  | { type: "folder"; title: string; parentId: string }
  | { type: "set-properties"; ids: string[]; properties: Properties }
  | Command
  | { type: "project" | "tag"; title: string; parentId?: string }
  | { type: "undo" | "redo"; receipt: Receipt };

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
    case "set-schedule":
      return command(intent.type,{ids:intent.ids,...intent.changes});
    case "set-date-settings":
      return command(intent.type,{timeZone:intent.timeZone,dateDefaults:intent.dateDefaults});
    case "repeat":
    case "lifecycle":
      return command(intent.change.name, intent.change.payload);
    case "folder":
      return command("create-container",{id:uuid(),kind:"folder",title:intent.title,parentId:intent.parentId});
    case "set-properties":
      return command(intent.type, {ids: intent.ids, ...intent.properties});
    case "project":
    case "tag":
      return command(
        intent.type === "project" ? "create-container" : "create-tag",
        {
          id: uuid(),
          title: intent.title,
          ...(intent.parentId ? {parentId:intent.parentId}:{}),
        },
      );
    case "capture":
      return command("capture", {
        parentId: intent.parentId,
        items: intent.titles.map((title) => ({ id: uuid(), title })),
      });
    case "group":
      return command("group", {
        ids: intent.ids,
        id: uuid(),
        title: intent.title,
      });
    case "rename":
      return command("bulk-edit", { ids: [intent.id], title: intent.title });
    case "setTitle":
      return command("bulk-edit", { ids: intent.ids, title: intent.title });
    case "setDue":
      return command("bulk-edit", { ids: intent.ids, due: intent.due });
    case "setTag":
      return command("set-tags", {
        ids: intent.ids,
        tagId: intent.tagId,
        enabled: intent.enabled,
      });
    case "undo":
    case "redo":
      return command(intent.type, {
        operationId: intent.receipt.operationId,
        contextId: intent.receipt.contextId,
      });
    case "move":
      return command("move", {
        ids: intent.ids,
        parentId: intent.parentId,
        beforeId: intent.beforeId,
      });
    default:
      return command(intent.type, { ids: intent.ids });
  }
}

export function describeDraft(intent: Intent, snapshot: Snapshot) {
  if (intent.type === "set-schedule") return JSON.stringify(intent.changes);
  if (intent.type === "set-date-settings") return "Date defaults in "+intent.timeZone;
  if (intent.type === "repeat" || intent.type === "lifecycle") return intent.change.name.replaceAll("-", " ");
  if (intent.type === "set-properties") return Object.entries(intent.properties).map(([field, value]) => field + " " + String(value)).join(", ");
  if (intent.type === "capture") return intent.titles.join(", ");
  if ("title" in intent) return intent.title;
  if (intent.type === "setDue") return intent.due ?? "Clear due date";
  if (intent.type === "move") {
    const place = [...snapshot.projects, ...snapshot.tasks].find(
      (i) => i.id === intent.parentId,
    );
    return "Move to " + (place?.title ?? "Inbox");
  }
  if (intent.type === "setTag") {
    const tag = snapshot.tags.find((i) => i.id === intent.tagId);
    return (intent.enabled ? "Apply " : "Remove ") + (tag?.title ?? "tag");
  }
  return intent.type;
}
