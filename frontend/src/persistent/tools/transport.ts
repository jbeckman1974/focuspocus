import { HttpError } from "../api.ts";

export class WorkspaceFailure extends HttpError {
  readonly conflicts: string[];
  constructor(status: number, message: string, conflicts: string[]) {
    super(status, message);
    this.conflicts = conflicts;
  }
}

export interface WorkspaceIdentity {
  actorId: number;
  csrf: string;
  workspaceId: string;
}

export function workspaceClient(identity: WorkspaceIdentity, signal: AbortSignal) {
  const root = "/api/v1/workspaces/" + encodeURIComponent(identity.workspaceId) + "/";
  async function request(path: string, options: RequestInit = {}) {
    const url = path.startsWith("/api/v1/sharing/") ? path : root + path;
    const headers = new Headers(options.headers);
    headers.set("X-FocusPocus-Actor", String(identity.actorId));
    if (options.method && options.method !== "GET") headers.set("X-CSRFToken", identity.csrf);
    const response = await fetch(url, {
      ...options, headers, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
      credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const conflicts: string[] = Array.isArray(data?.conflicts)
        ? data.conflicts.flatMap((item: {reason?: string} | null) => typeof item?.reason === "string" ? [item.reason] : [])
        : [];
      throw new WorkspaceFailure(response.status, typeof data?.error === "string" ? data.error : "The request failed.", conflicts);
    }
    return response;
  }
  async function json<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await request(path, options);
    return response.status === 204 ? undefined as T : response.json();
  }
  function post<T>(path: string, payload: object): Promise<T> {
    return json(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
  }
  return {json, post, request, signal, identity};
}

export type WorkspaceClient = ReturnType<typeof workspaceClient>;
