import { HttpError, jsonPost, jsonRequest, readSession, type Snapshot } from "../api.ts";
import type { NoteDocument } from "./document.ts";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  sha256: string;
  mediaType: string;
  previewable: boolean;
}
export interface Content {
  revision: number;
  maxFileBytes: number;
  itemVersion: number;
  document: NoteDocument;
  files: Attachment[];
}
export const contentUrl = (workspace: string, item: string) =>
  "/api/v1/workspaces/" + encodeURIComponent(workspace) + "/content/items/" + encodeURIComponent(item);

export async function identity(workspace: string, actor: number, signal: AbortSignal) {
  const session = await readSession(signal);
  if (session.user?.id !== actor || !session.workspaces.some((w) => w.id === workspace))
    throw new HttpError(401, "Account or workspace access changed.");
  return session.csrfToken;
}

export function noteWrite(snapshot: Snapshot, item: string, base: Content, doc: NoteDocument) {
  const body = { context: snapshot.context, operationId: crypto.randomUUID(), expectedRevision: base.revision,
    payload: { id: item, itemVersion: base.itemVersion, document: doc } };
  return (csrf: string, signal: AbortSignal) =>
    jsonRequest("/api/v1/workspaces/" + encodeURIComponent(snapshot.workspaceId) + "/commands/set-note", {
      ...jsonPost(csrf, body), signal,
    });
}

export async function fileWrite(snapshot: Snapshot, item: string, base: Content, file: File) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  const fixed = { "Content-Type": "application/octet-stream", "X-File-Type": file.type || "application/octet-stream",
    "X-File-Sha256": Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    "X-Write-Context": snapshot.context, "X-Operation-Id": crypto.randomUUID(),
    "X-File-Id": crypto.randomUUID(), "X-File-Name": encodeURIComponent(file.name),
    "X-Workspace-Revision": String(base.revision), "X-Item-Version": String(base.itemVersion) };
  return (csrf: string, signal: AbortSignal) =>
    jsonRequest(contentUrl(snapshot.workspaceId, item) + "/files", {
      method: "POST", headers: { ...fixed, "X-CSRFToken": csrf }, body: file, signal,
    });
}

export function unlinkWrite(snapshot: Snapshot, item: string, base: Content, fileId: string) {
  const body = { context: snapshot.context, operationId: crypto.randomUUID(), expectedRevision: base.revision,
    payload: { id: item, itemVersion: base.itemVersion, fileId } };
  return (csrf: string, signal: AbortSignal) =>
    jsonRequest("/api/v1/workspaces/" + encodeURIComponent(snapshot.workspaceId) + "/commands/remove-file", {
      ...jsonPost(csrf, body), signal,
    });
}
