import { titleText, calendarDate } from "../../outline/values.ts";
import { editItems, changeStatus } from "./queueItems.ts";
import { patchDueDay, patchSchedule, projectDue } from "./queueDue.ts";
import { rows } from "./queueTypes.ts";
import { applyCommand } from "../../outline/commands.ts";
import type { Snapshot } from "../api.ts";
import type { Write } from "../writes.ts";
import type { QueueEntry } from "./queueTypes.ts";

const projectionVersion = 1;

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
    case "setDue": {
      const day = calendarDate(intent.due);
      const next = editItems(snapshot, intent.ids, (row) =>
        patchDueDay(row, day, snapshot),
      );
      return projectDue(next, intent.ids);
    }
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
      let index = 0;
      const result = applyCommand(snapshot, intent, () => ids[index++] ?? "");
      const tasks = result.workspace.tasks.map((row) =>
        "version" in row ? row : { ...row, version: 0 },
      ) as Snapshot["tasks"];
      const changed =
        intent.type === "capture" || intent.type === "group" ? ids : intent.ids;
      return projectDue({ ...snapshot, tasks }, changed);
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
      const next = { ...snapshot, [key]: [...(snapshot[key] ?? []), entry] };
      return intent.type === "tag" ? next : projectDue(next, [entry.id]);
    }
    case "set-properties": {
      const { status, ...properties } = intent.properties;
      const next = editItems(snapshot, intent.ids, (row) => {
        if ("inProgress" in properties) {
          if (typeof properties.inProgress !== "boolean")
            throw new Error("In progress must be true or false.");
          if (row.kind !== "action" && row.kind !== "group")
            throw new Error(
              "Only actions and groups have an in-progress state.",
            );
        }
        return properties;
      });
      return status ? changeStatus(next, intent.ids, status) : next;
    }
    case "set-schedule": {
      const patch = intent.changes.schedule;
      const next = editItems(snapshot, intent.ids, (row) => ({
        ...(patch ? patchSchedule(row, patch, snapshot) : {}),
        ...(intent.changes.durationMinutes === undefined
          ? {}
          : { durationMinutes: intent.changes.durationMinutes }),
      }));
      return patch && "due" in patch ? projectDue(next, intent.ids) : next;
    }
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
          ...(schedule ? patchSchedule(row, schedule, snapshot) : {}),
          ...(tags ? { tags: [...direct] } : {}),
        };
      });
      const dated =
        schedule && "due" in schedule ? projectDue(next, intent.ids) : next;
      return status ? changeStatus(dated, intent.ids, status) : dated;
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
      // The server owns recurrence and other unevaluated rules.
      // The queue records the verb and input until the committed snapshot arrives.
      return snapshot;
  }
}

export function projectQueue(confirmed: Snapshot, queue: QueueEntry[]) {
  let result = confirmed;
  const blocked = new Set<string>();
  const applied: string[] = [];
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
        continue;
      }
    }
    applied.push(entry.id);
  }
  return applied.length
    ? {
        ...result,
        localOperationIds: applied,
        localProjectionVersion: projectionVersion,
      }
    : result;
}

export function restoreProjection(
  confirmed: Snapshot,
  saved: Snapshot,
  queue: QueueEntry[],
) {
  return queue.length && saved.localProjectionVersion !== projectionVersion
    ? projectQueue(confirmed, queue)
    : saved;
}
