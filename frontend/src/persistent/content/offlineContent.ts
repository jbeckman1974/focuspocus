import { actorRequest, HttpError, jsonPost, type Receipt } from "../api.ts";
import { contentUrl, identity } from "./transport.ts";
import { knownFileLimit } from "./fileLimit.ts";
import type { NoteDocument } from "./document.ts";

interface Target {
  itemId: string;
  itemVersion: number;
}

export type OfflineContent = Target &
  (
    | { action: "save"; document: NoteDocument; originalText?: string }
    | { action: "remove"; fileId: string }
    | {
        action: "upload";
        fileId: string;
        name: string;
        mediaType: string;
        size: number;
        sha256: string;
      }
  );

interface ContentEnvelope {
  context: string;
  operationId: string;
  expectedRevision: number;
}

export type StageContent = (
  content: OfflineContent,
  bytes: Blob | null,
  base: import("../api.ts").Snapshot,
) => Promise<void>;

async function checksum(bytes: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await bytes.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function describeUpload(
  itemId: string,
  itemVersion: number,
  file: File,
  maximumBytes: number,
): Promise<OfflineContent> {
  if (
    !file.name ||
    file.name.trim() !== file.name ||
    Array.from(file.name).length > 200 ||
    [".", ".."].includes(file.name) ||
    /[/\\\p{C}]/u.test(file.name)
  )
    throw new Error("Choose a printable filename without a path.");
  if (!knownFileLimit(maximumBytes))
    throw new Error(
      "Connect to verify the attachment size limit before choosing a file.",
    );
  if (file.size > maximumBytes)
    throw new Error("The file exceeds the per-attachment limit.");
  return {
    action: "upload",
    itemId,
    itemVersion,
    fileId: crypto.randomUUID(),
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    size: file.size,
    sha256: await checksum(file),
  };
}

// The queue fixes this envelope before its first transmission. Only the
// anti-CSRF token and abort signal are reacquired for subsequent attempts.
export async function sendContentRequest(
  actorId: number,
  workspaceId: string,
  content: OfflineContent,
  bytes: Blob | null,
  envelope: ContentEnvelope,
  csrf: string,
  signal: AbortSignal,
): Promise<Receipt> {
  signal.throwIfAborted();
  if (content.action === "upload") {
    if (
      !bytes ||
      bytes.size !== content.size ||
      (await checksum(bytes)) !== content.sha256
    )
      throw new HttpError(
        422,
        "The saved file is missing or its checksum has changed.",
      );
    signal.throwIfAborted();
    return actorRequest<Receipt>(
      actorId,
      contentUrl(workspaceId, content.itemId) + "/files",
      {
        method: "POST",
        signal,
        body: bytes,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-CSRFToken": csrf,
          "X-File-Type": content.mediaType,
          "X-File-Sha256": content.sha256,
          "X-Write-Context": envelope.context,
          "X-Operation-Id": envelope.operationId,
          "X-File-Id": content.fileId,
          "X-File-Name": encodeURIComponent(content.name),
          "X-Workspace-Revision": String(envelope.expectedRevision),
          "X-Item-Version": String(content.itemVersion),
        },
      },
      300000,
    );
  }
  const command = content.action === "save" ? "set-note" : "remove-file";
  const payload = {
    id: content.itemId,
    itemVersion: content.itemVersion,
    ...(content.action === "save"
      ? { document: content.document }
      : { fileId: content.fileId }),
  };
  return actorRequest<Receipt>(
    actorId,
    "/api/v1/workspaces/" +
      encodeURIComponent(workspaceId) +
      "/commands/" +
      command,
    {
      ...jsonPost(csrf, { ...envelope, payload }),
      signal,
    },
  );
}

export async function sendOfflineContent(
  actorId: number,
  workspaceId: string,
  content: OfflineContent,
  bytes: Blob | null,
  envelope: ContentEnvelope,
  signal: AbortSignal,
): Promise<Receipt> {
  const csrf = await identity(workspaceId, actorId, signal, true);
  return sendContentRequest(
    actorId,
    workspaceId,
    content,
    bytes,
    envelope,
    csrf,
    signal,
  );
}
