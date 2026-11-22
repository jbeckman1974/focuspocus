import { useEffect, useRef, useState } from "react";
import { actorRequest, HttpError, type Snapshot } from "../api.ts";
import { emptyNote, type NoteDocument } from "./document.ts";
import { NoteEditor } from "./NoteEditor.tsx";
import { describeUpload, sendContentRequest, type OfflineContent, type StageContent } from "./offlineContent.ts";
import { useTrustedItem } from "./useTrustedItem.ts";
import {
  ContentReadOnly,
  contentUrl,
  identity,
  type Attachment,
  type Content,
} from "./transport.ts";

type Props = {
  snapshot: Snapshot;
  itemId: string;
  readOnly: boolean;
  actorId: number;
  stageContent?: StageContent;
};
type PendingWrite = {
  change: OfflineContent;
  bytes: Blob | null;
  base: Snapshot;
  envelope: {context:string; operationId:string; expectedRevision:number};
};

export function ContentTools(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Notes and files…
      </button>
      {open && (
        <ContentDialog
          key={[props.actorId, props.snapshot.workspaceId, props.itemId, props.stageContent ? "trusted" : "online"].join("/")}
          {...props}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ContentDialog({
  snapshot,
  itemId,
  readOnly,
  actorId,
  close,
  stageContent,
}: Props & { close: () => void }) {
  const [online, setContent] = useState<Content>();
  const trusted = Boolean(stageContent);
  const {item:saved,error:storageError} = useTrustedItem(trusted, actorId, snapshot, itemId);
  const content = trusted ? saved?.base : online;
  const noteBase = useRef<Content | undefined>(undefined);
  const [note, setNote] = useState<NoteDocument>(emptyNote);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Attachment>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState<PendingWrite>();
  const [denied, setDenied] = useState(false);
  const [masked, setMasked] = useState(false);
  const [lostWrite, setLostWrite] = useState(false);
  const life = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const base = contentUrl(snapshot.workspaceId, itemId);

  useEffect(() => {
    if (trusted && !noteBase.current) setNote(saved?.draft ?? emptyNote);
  }, [saved, trusted]);

  function hide() {
    noteBase.current = undefined;
    setDenied(true);
    setNote(emptyNote);
    setContent(undefined);
    setFile(null);
    setPreview(undefined);
    setRetry(undefined);
  }
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    async function load() {
      try {
        await identity(snapshot.workspaceId, actorId, controller.signal);
        const current = await actorRequest<Content>(actorId, base, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setContent(current);
          setNote(current.document);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          hide();
          setMessage(
            error instanceof Error ? error.message : "Content unavailable.",
          );
        }
      }
    }
    if (!trusted) void load();
    return () => controller.abort();
  }, [actorId, base, snapshot.workspaceId, trusted]);

  function handleAccessFailure(error: unknown) {
    if (error instanceof HttpError && [401, 403, 404].includes(error.status)) {
      hide();
      setMessage("Account or item access changed.");
    } else {
      setMasked(true);
      setMessage("Reconnect to verify access to this draft.");
    }
  }

  async function accessCheck(signal: AbortSignal) {
    try {
      await identity(snapshot.workspaceId, actorId, signal);
      await actorRequest<Content>(actorId, base, { signal });
      if (!signal.aborted) {
        setMasked(false);
        setMessage("");
      }
      return true;
    } catch (error) {
      if (!signal.aborted) handleAccessFailure(error);
      return false;
    }
  }

  function prepare(change:OfflineContent, bytes: Blob | null = null): PendingWrite {
    const revision = (change.action === "save" ? noteBase.current : undefined)?.revision ?? content!.revision;
    return {change,bytes,base:{...snapshot,revision},envelope:{context:snapshot.context,operationId:crypto.randomUUID(),expectedRevision:revision}};
  }

  async function write(make: () => Promise<PendingWrite> | PendingWrite) {
    const signal = life.current?.signal;
    if (
      !signal ||
      signal.aborted ||
      locked.current ||
      readOnly ||
      lostWrite ||
      denied ||
      masked
    )
      return;
    locked.current = true;
    setBusy(true);
    setConflict(false);
    setMessage("");
    let attempt: PendingWrite | undefined;
    try {
      attempt = await make();
      if (stageContent) {
        await stageContent(attempt.change, attempt.bytes, attempt.base);
        if (signal.aborted) return;
        if (attempt.change.action === "save") noteBase.current = undefined;
        if (attempt.change.action === "upload") {
          setFile(null);
          if (fileInput.current) fileInput.current.value = "";
        }
        setMessage(attempt.change.action === "upload" ? "File saved on this device for sync." : "Change saved on this device for sync.");
        return;
      }
      const csrf = await identity(snapshot.workspaceId, actorId, signal, true);
      await sendContentRequest(actorId,snapshot.workspaceId,attempt.change,attempt.bytes,attempt.envelope,csrf,signal);
      const current = await actorRequest<Content>(actorId, base, { signal });
      if (signal.aborted) return;
      setContent(current);
      if (attempt.change.action === "save") { noteBase.current = undefined; setNote(current.document); }
      if (attempt.change.action === "upload") {
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
      }
      if (attempt.change.action === "remove") setPreview(undefined);
      setRetry(undefined);
      setMessage("Saved.");
    } catch (error) {
      if (signal.aborted) return;
      if (trusted) {
        setMessage(error instanceof Error ? error.message : "The change could not be saved on this device.");
        return;
      }
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403 || error.status === 404)
      ) {
        // Revalidate both principal and item access before preserving any private draft.
        if (!(await accessCheck(signal))) return;
        if (error instanceof ContentReadOnly) {
          setLostWrite(true);
          setRetry(undefined);
          setMessage(error.message);
          return;
        }
      }
      if (signal.aborted) return;
      if (error instanceof HttpError && [409, 412].includes(error.status)) {
        setConflict(true);
        setRetry(undefined);
      } else if (
        !(error instanceof HttpError) ||
        error.status >= 500 ||
        error.status === 403
      )
        setRetry(attempt);
      else setRetry(undefined);
      setMessage(
        error instanceof Error
          ? error.message
          : "The write could not be confirmed.",
      );
    } finally {
      locked.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  async function compare() {
    const signal = life.current?.signal;
    if (!signal) return;
    try {
      await identity(snapshot.workspaceId, actorId, signal);
      const current = await actorRequest<Content>(actorId, base, { signal });
      if (!signal.aborted) {
        setContent(current);
        noteBase.current = current;
        setConflict(false);
        setMessage("Latest version loaded. Review your draft before saving.");
      }
    } catch (error) {
      if (!signal.aborted) handleAccessFailure(error);
    }
  }
  const disabled = readOnly || lostWrite || busy || conflict || Boolean(retry);
  return (
    <dialog
      ref={dialog}
      aria-label="Notes and files"
      className="fp-dialog schedule-dialog"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <h3>Notes and files</h3>
      {message && <p role="status">{message}</p>}
      {storageError && <p role="alert">{storageError}</p>}
      {denied || storageError ? (
        <p>Item content is unavailable.</p>
      ) : masked ? (
        <button
          type="button"
          onClick={() => {
            if (life.current) void accessCheck(life.current.signal);
          }}
        >
          Verify access
        </button>
      ) : content ? (
        <>
          {trusted && saved && !saved.known && <p>Connect to load the existing note and file list. You can attach a file now.</p>}
          <NoteEditor value={note} change={(value) => {noteBase.current ??= content;setNote(value);}} disabled={disabled || (trusted && !saved?.known)} />
          <button
            type="button"
            disabled={disabled || (trusted && !saved?.known)}
            onClick={() => void write(() => prepare({
              action:"save",itemId,itemVersion:(noteBase.current ?? content).itemVersion,document:note,
            }))}
          >
            Save note
          </button>
          {conflict && (
            <button type="button" onClick={() => void compare()}>
              Compare latest version
            </button>
          )}
          {!conflict && message.startsWith("Latest version") && (
            <details>
              <summary>Saved note for comparison</summary>
              <NoteEditor value={content.document} change={() => {}} disabled />
            </details>
          )}
          {saved && saved.pending.length > 0 && <ul aria-label="Content changes on this device">
            {saved.pending.map(({id,content:change,state,reason}) => <li key={id}>
              {change?.action === "upload" ? change.name : change?.action === "save" ? "Note" : "Attachment removal"}
              {" · "}{state === "conflict" ? reason : "Awaiting sync"}
            </li>)}
          </ul>}
          <h4>Attachments</h4>
          <ul>
            {content.files.map((attachment) => {
              const url = base + "/files/" + encodeURIComponent(attachment.id);
              return (
                <li key={attachment.id}>
                  <a href={url + "/download"} download={attachment.name}>
                    Download {attachment.name}
                  </a>
                  {" · "}
                  {attachment.size} bytes
                  {attachment.previewable && (
                    <button
                      type="button"
                      onClick={() => setPreview(attachment)}
                    >
                      Preview {attachment.name}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void write(() => prepare({
                      action:"remove",itemId,itemVersion:content.itemVersion,fileId:attachment.id,
                    }))}
                  >
                    Remove {attachment.name}
                  </button>
                </li>
              );
            })}
          </ul>
          {preview && content.files.some((f) => f.id === preview.id) && (
            <figure>
              <img
                alt={preview.name}
                style={{ maxWidth: "100%" }}
                src={
                  base + "/files/" + encodeURIComponent(preview.id) + "/preview"
                }
              />
              <button type="button" onClick={() => setPreview(undefined)}>
                Close preview
              </button>
            </figure>
          )}
          <label>
            Attach file
            <input
              ref={fileInput}
              type="file"
              disabled={disabled}
              onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
            />
          </label>
          {file && file.size > content.maxFileBytes && (
            <p role="status">
              File exceeds the {content.maxFileBytes} byte limit.
            </p>
          )}
          <button
            type="button"
            disabled={disabled || !file || file.size > content.maxFileBytes}
            onClick={() => {
              if (file)
                void write(async () => prepare(
                  await describeUpload(itemId,content.itemVersion,file,content.maxFileBytes),file,
                ));
            }}
          >
            Upload file
          </button>
          {retry && (
            <button
              type="button"
              disabled={busy || readOnly}
              onClick={() => void write(() => retry)}
            >
              Retry same write
            </button>
          )}
        </>
      ) : (
        <p>Loading…</p>
      )}
      <button type="button" disabled={busy} onClick={close}>
        Close
      </button>
    </dialog>
  );
}
