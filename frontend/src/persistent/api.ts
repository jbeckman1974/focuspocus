import type { RepeatRule,RepeatPreviewResult } from "./repeat.ts";
import type { Entry, Task } from "../outline/index.ts";

import type { DateDefaults } from "./schedule.ts";
import type { FilingPolicy, TagStatus } from "./lifecycle.ts";
import type { RuleFields } from "./rules.ts";

export interface Session {
  user: { id: number; username: string } | null;
  workspaces: { id: string; role: string }[];
  csrfToken: string;
}

export interface Snapshot {
  workspaceId: string;
  revision: number;
  generation: string;
  context: string;
  cursor: string;
  timeZone?: string;
  viewZone?: string;
  dateDefaults?: DateDefaults;
  nextDateBoundary?: string | null;
  resolvedCleanup?: "immediate" | "on-cleanup";
  filingPolicy?: FilingPolicy;
  tasks: (Task & RuleFields & { version: number; filingProjectId?:string|null })[];
  folders?: (Entry & RuleFields & { version: number })[];
  tags: (Entry & { version: number; parentId?: string|null; status?:TagStatus; exclusive?:boolean })[];
  projects: (Entry & RuleFields & { version: number })[];
}

export interface Receipt {
  operationId: string;
  contextId: string;
  revision: number;
  selection: string[];
  undoable: boolean;
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
): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const response = await fetch(url, {
    ...options,
    signal,
    mode: "same-origin",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { Accept: "application/json", ...options.headers },
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
    setViewZone(value:string) { viewZone=value; },
    previewRepeat: (item:string,rule:RepeatRule,completedAt:string|undefined,callerSignal:AbortSignal) =>
      jsonRequest<RepeatPreviewResult>(base+"/repeat-preview",{
        ...jsonPost(csrf,{id:item,rule,...(completedAt ? {completedAt}:{})}),
        signal:AbortSignal.any([signal,callerSignal])
      }),
    async verifySession() {
      const session = await readSession(signal);
      const membership = session.workspaces.find((space) => space.id === id);
      if (session.user?.id !== actorId || !membership) {
        throw new HttpError(403, "Workspace access changed.");
      }
      csrf = session.csrfToken;
      return membership.role === "owner" || membership.role === "editor";
    },
    snapshot: () => jsonRequest<Snapshot>(base + "/snapshot" + (viewZone ? "?viewZone="+encodeURIComponent(viewZone) : ""), { signal }),
    changes: (cursor: string) =>
      jsonRequest<{ revision: number; changes: unknown[]; resolvedCleanup?: "immediate"|"on-cleanup" }>(
        base + "/changes?after=" + encodeURIComponent(cursor),
        { signal },
      ),
    submit: (name: string, envelope: object) =>
      jsonRequest<Receipt>(base + "/commands/" + name, {
        ...jsonPost(csrf, envelope),
        signal,
      }),
  };
}

export type WorkspaceApi = ReturnType<typeof workspaceApi>;
