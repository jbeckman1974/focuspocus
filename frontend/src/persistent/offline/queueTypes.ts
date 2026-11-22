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
  content?:OfflineContent;
}

export const rows = (s: Snapshot) => [
  ...s.tasks,
  ...s.projects,
  ...(s.folders ?? []),
  ...s.tags,
];
