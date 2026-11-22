import type { Snapshot } from "../api.ts";
import type { OfflineContent } from "../content/offlineContent.ts";
import type { Write } from "../writes.ts";

export type Guard = {
  key: string;
  value: string;
  predecessors: string[];
};

export type QueueEntry = {
  id: string;
  protocol: 1;
  generation: string;
  grant: string;
  expiresAt: string;
  write: Write;
  content?: OfflineContent;
  guards: Guard[];
  affects: string[];
  dependencies: string[];
  description: string;
  before: string;
  state: "queued" | "sent" | "conflict";
  reason: string;
  // Set before the first transmission. The original envelope also includes
  // client-generated identities and the signed context used for receipt lookup.
  transmitted: boolean;
};

export interface QueueNotice {
  id: string;
  description: string;
  status: QueueEntry["state"] | "blocked";
  reason: string;
  base: string;
  draft: string;
  current: string;
  content?: OfflineContent;
}

export const rows = (s: Snapshot) => [
  ...s.tasks,
  ...s.projects,
  ...(s.folders ?? []),
  ...s.tags,
];

export interface ReviewedContent {
  itemId: string;
  itemVersion: number;
  generation: string;
  grantId: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

// A newer client may have stored an envelope this version cannot replay.
// Keep unknown records opaque until the current member reviews the partition.
export function supportedQueue(value: unknown): value is QueueEntry[] {
  return (
    Array.isArray(value) &&
    value.every((row) => {
      if (
        !record(row) ||
        row.protocol !== 1 ||
        typeof row.id !== "string" ||
        typeof row.description !== "string" ||
        typeof row.before !== "string" ||
        !["queued", "sent", "conflict"].includes(String(row.state)) ||
        typeof row.reason !== "string" ||
        typeof row.transmitted !== "boolean" ||
        typeof row.generation !== "string" ||
        typeof row.grant !== "string" ||
        typeof row.expiresAt !== "string" ||
        !strings(row.dependencies) ||
        !strings(row.affects) ||
        !Array.isArray(row.guards) ||
        !row.guards.every(
          (g) =>
            record(g) &&
            typeof g.key === "string" &&
            typeof g.value === "string" &&
            strings(g.predecessors),
        )
      )
        return false;
      const write = row.write;
      if (
        !record(write) ||
        typeof write.name !== "string" ||
        !record(write.intent) ||
        typeof write.intent.type !== "string" ||
        !record(write.envelope) ||
        write.envelope.operationId !== row.id ||
        typeof write.envelope.context !== "string" ||
        !Number.isSafeInteger(write.envelope.expectedRevision as number) ||
        !record(write.envelope.payload)
      )
        return false;
      return (
        row.content === undefined ||
        (record(row.content) &&
          ["save", "upload", "remove"].includes(String(row.content.action)) &&
          typeof row.content.itemId === "string" &&
          Number.isSafeInteger(row.content.itemVersion as number))
      );
    })
  );
}
