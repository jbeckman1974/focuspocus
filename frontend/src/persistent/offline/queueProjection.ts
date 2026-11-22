import { titleText, calendarDate } from "../../outline/values.ts";
import { editItems, changeStatus } from "./queueItems.ts";
import { rows } from "./queueTypes.ts";
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
    case "rename":
    case "setTitle":
      return editItems(
        snapshot,
        intent.type === "rename" ? [intent.id] : intent.ids,
        () => ({ title: titleText(intent.title) }),
      );
    case "setDue":
      return editItems(snapshot, intent.ids, (row) => ({
        due: calendarDate(intent.due),
        schedule: {
          ...row.schedule,
          due: intent.due ? { kind: "date", value: intent.due } : null,
        },
      }));
    case "setTag":
      if (!snapshot.tags.some((tag) => tag.id === intent.tagId))
        throw new Error("Choose a workspace tag.");
      return editItems(snapshot, intent.ids, (row) => ({
        tags: intent.enabled
          ? [...new Set([...(row.tags ?? []), intent.tagId])]
          : (row.tags ?? []).filter((id) => id !== intent.tagId),
      }));
    case "complete":
    case "reopen":
      return changeStatus(
        snapshot,
        intent.ids,
        intent.type === "complete" ? "completed" : "active",
      );
    case "capture":
    case "group":
    case "indent":
    case "outdent":
    case "move": {
      const ids =
        intent.type === "capture"
          ? (payload.items as { id: string }[]).map((row) => row.id)
          : [String(payload.id)];
      const result = applyCommand(snapshot, intent, () => ids.shift() ?? "");
      const tasks = result.workspace.tasks.map((row) =>
        "version" in row ? row : { ...row, version: 0 },
      ) as Snapshot["tasks"];
      return { ...snapshot, tasks };
    }
    case "tag":
    case "folder":
    case "project": {
      const key =
        intent.type === "tag"
          ? "tags"
          : intent.type === "folder"
            ? "folders"
            : "projects";
      if (rows(snapshot).some((row) => row.id === payload.id))
        throw new Error(
          "The created item already exists. Compare its contents.",
        );
      const entry = {
        id: String(payload.id),
        title: titleText(intent.title),
        parentId: intent.parentId ?? "root",
        version: 0,
      };
      return { ...snapshot, [key]: [...(snapshot[key] ?? []), entry] };
    }
    case "set-properties": {
      const { status, ...properties } = intent.properties;
      const next = editItems(snapshot, intent.ids, () => properties);
      return status ? changeStatus(next, intent.ids, status) : next;
    }
    case "set-schedule":
      return editItems(snapshot, intent.ids, (row) => ({
        schedule: { ...row.schedule, ...intent.changes.schedule },
        ...(intent.changes.durationMinutes === undefined
          ? {}
          : { durationMinutes: intent.changes.durationMinutes }),
      }));
    case "bulk-inspect": {
      const { status, tags, schedule, ...fields } = intent.changes;
      const next = editItems(snapshot, intent.ids, (row) => {
        const direct = new Set(row.tags ?? []);
        for (const tag of tags ?? []) {
          if (tag.enabled) direct.add(tag.tagId);
          else direct.delete(tag.tagId);
        }
        return {
          ...fields,
          ...(schedule ? { schedule: { ...row.schedule, ...schedule } } : {}),
          ...(tags ? { tags: [...direct] } : {}),
        };
      });
      return status ? changeStatus(next, intent.ids, status) : next;
    }
    case "lifecycle":
      if (intent.change.name === "delete") {
        const removed = new Set(intent.change.payload.ids);
        const available = new Set(
          [
            ...snapshot.tasks,
            ...snapshot.projects,
            ...(snapshot.folders ?? []),
          ].map((row) => row.id),
        );
        if ([...removed].some((id) => !available.has(id)))
          throw new Error("The selected item no longer exists.");
        const children = new Map<string, string[]>();
        for (const row of [
          ...(snapshot.folders ?? []),
          ...snapshot.projects,
          ...snapshot.tasks,
        ]) {
          if (row.parentId) {
            if (!children.has(row.parentId)) children.set(row.parentId, []);
            children.get(row.parentId)!.push(row.id);
          }
        }
        for (const id of removed)
          for (const child of children.get(id) ?? []) removed.add(child);
        return {
          ...snapshot,
          tasks: snapshot.tasks.filter((row) => !removed.has(row.id)),
          projects: snapshot.projects.filter((row) => !removed.has(row.id)),
          folders: snapshot.folders?.filter((row) => !removed.has(row.id)),
        };
      }
      return snapshot;
    default:
      // The server owns recurrence, effective dates and other derived rules.
      // The queue records the verb and input until the committed snapshot arrives.
      return snapshot;
  }
}

export function projectQueue(confirmed: Snapshot, queue: QueueEntry[]) {
  let result = confirmed;
  const blocked = new Set<string>();
  for (const entry of queue) {
    if (
      entry.state === "conflict" ||
      entry.dependencies.some((id) => blocked.has(id))
    ) {
      blocked.add(entry.id);
      continue;
    }
    if (!entry.content) {
      try {
        result = project(result, entry.write);
      } catch {
        blocked.add(entry.id);
      }
    }
  }
  return result;
}
