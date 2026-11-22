import type { OfflineContent } from "./content/offlineContent.ts";
import type { RepeatRule, RepeatPreviewResult } from "./repeat.ts";
import type { Entry, Task } from "../outline/index.ts";

import type { DateDefaults } from "./schedule.ts";
import type { FilingPolicy, TagStatus } from "./lifecycle.ts";
import type { RuleFields } from "./rules.ts";

export interface Session {
  authMode?: "local" | "oidc";
  user: { id: number; username: string } | null;
  workspaces: { id: string; role: string }[];
  csrfToken: string;
}

export interface Snapshot {
  workspaceId: string;
  revision: number;
  generation: string;
  context: string;
  offlineGrant?: {
    id: string;
    membershipId?: string;
    protocol: number;
    expiresAt: string;
  };
  cursor: string;
  timeZone?: string;
  viewZone?: string;
  dateDefaults?: DateDefaults;
  nextDateBoundary?: string | null;
  perspectiveVersion?: number;
  focusScopeIds?: string[];
  resolvedCleanup?: "immediate" | "on-cleanup";
  filingPolicy?: FilingPolicy;
  tasks: (Task &
    RuleFields & { version: number; filingProjectId?: string | null })[];
  folders?: (Entry & RuleFields & { version: number })[];
  tags: (Entry & {
    version: number;
    parentId?: string | null;
    status?: TagStatus;
    exclusive?: boolean;
  })[];
  projects: (Entry & RuleFields & { version: number })[];
}

export interface Receipt {
  operationId: string;
  contextId: string;
  revision: number;
  selection: string[];
  undoable: boolean;
  versions?: Record<string, number>;
}

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function jsonRequest<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(url, {
    ...options,
    signal,
    mode: "same-origin",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new HttpError(
      response.status,
      typeof body?.error === "string" ? body.error : "Request failed.",
    );
  }
  return response.json();
}

export function jsonPost(csrf: string, body: object): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
    body: JSON.stringify(body),
  };
}

export function readSession(signal?: AbortSignal) {
  return jsonRequest<Session>("/api/v1/session", { signal });
}

export function actorRequest<T>(
  actorId: number,
  url: string,
  options: RequestInit = {},
  timeoutMs?: number,
) {
  const headers = new Headers(options.headers);
  headers.set("X-FocusPocus-Actor", String(actorId));
  return jsonRequest<T>(url, { ...options, headers }, timeoutMs);
}

export function workspaceApi(
  id: string,
  actorId: number,
  initialCsrf: string,
  signal: AbortSignal,
) {
  let csrf = initialCsrf;
  let viewZone = "";
  const base = "/api/v1/workspaces/" + encodeURIComponent(id);
  return {
    setViewZone(value: string) {
      viewZone = value;
    },
    previewRepeat: (
      item: string,
      rule: RepeatRule,
      completedAt: string | undefined,
      callerSignal: AbortSignal,
    ) =>
      actorRequest<RepeatPreviewResult>(actorId, base + "/repeat-preview", {
        ...jsonPost(csrf, {
          id: item,
          rule,
          ...(completedAt ? { completedAt } : {}),
        }),
        signal: AbortSignal.any([signal, callerSignal]),
      }),
    async verifySession() {
      const session = await readSession(signal);
      if (!session.user)
        throw new HttpError(401, "Sign in again to verify your workspace.");
      const membership = session.workspaces.find((space) => space.id === id);
      if (session.user?.id !== actorId || !membership) {
        throw new HttpError(403, "Workspace access changed.");
      }
      csrf = session.csrfToken;
      return membership.role === "owner" || membership.role === "editor";
    },
    snapshot: () =>
      actorRequest<Snapshot>(
        actorId,
        base +
          "/snapshot" +
          (viewZone ? "?viewZone=" + encodeURIComponent(viewZone) : ""),
        { signal },
      ),
    changes: (cursor: string) =>
      actorRequest<{
        revision: number;
        changes: unknown[];
        perspectiveVersion?: number;
        resolvedCleanup?: "immediate" | "on-cleanup";
      }>(actorId, base + "/changes?after=" + encodeURIComponent(cursor), {
        signal,
      }),
    submitContent: async (
      content: OfflineContent,
      bytes: Blob | null,
      envelope: {
        context: string;
        operationId: string;
        expectedRevision: number;
      },
    ) => {
      const { sendOfflineContent } =
        await import("./content/offlineContent.ts");
      return sendOfflineContent(actorId, id, content, bytes, envelope, signal);
    },
    submit: (name: string, envelope: object) =>
      actorRequest<Receipt>(actorId, base + "/commands/" + name, {
        ...jsonPost(csrf, envelope),
        signal,
      }),
  };
}

type OnlineApi = ReturnType<typeof workspaceApi>;
export type WorkspaceApi = Omit<OnlineApi, "submitContent"> &
  Partial<Pick<OnlineApi, "submitContent">>;
