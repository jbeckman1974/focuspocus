import {
  HttpError,
  readSession,
} from "../api.ts";
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
  "/api/v1/workspaces/" +
  encodeURIComponent(workspace) +
  "/content/items/" +
  encodeURIComponent(item);

export class ContentReadOnly extends HttpError {}

export async function identity(
  workspace: string,
  actor: number,
  signal: AbortSignal,
  write = false,
) {
  const session = await readSession(signal);
  const membership = session.workspaces.find((w) => w.id === workspace);
  if (session.user?.id !== actor || !membership)
    throw new HttpError(401, "Account or workspace access changed.");
  if (write && !["editor", "owner"].includes(membership.role))
    throw new ContentReadOnly(
      403,
      "Your workspace is read-only. The draft is still available.",
    );
  return session.csrfToken;
}
