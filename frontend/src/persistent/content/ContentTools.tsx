import { useEffect, useRef, useState } from "react";
import { actorRequest, HttpError, type Snapshot } from "../api.ts";
import { emptyNote, type NoteDocument } from "./document.ts";
import { NoteEditor } from "./NoteEditor.tsx";
import { ContentReadOnly, contentUrl, fileWrite, identity, noteWrite, unlinkWrite, type Attachment, type Content } from "./transport.ts";

type Props = { snapshot: Snapshot; itemId: string; readOnly: boolean; actorId: number };
type PendingWrite = { send: (csrf: string, signal: AbortSignal) => Promise<unknown>; action: "save" | "upload" | "remove" };

export function ContentTools(props: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Notes and files…</button>
    {open && <ContentDialog key={[props.actorId, props.snapshot.workspaceId, props.itemId].join("/")}
      {...props} close={() => setOpen(false)} />}
  </>;
}

function ContentDialog({ snapshot, itemId, readOnly, actorId, close }: Props & { close: () => void }) {
  const [content, setContent] = useState<Content>();
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

  function hide() {
    setDenied(true); setNote(emptyNote); setContent(undefined); setFile(null); setPreview(undefined); setRetry(undefined);
  }
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    async function load() {
      try {
        await identity(snapshot.workspaceId, actorId, controller.signal);
        const current = await actorRequest<Content>(actorId, base, { signal: controller.signal });
        if (!controller.signal.aborted) { setContent(current); setNote(current.document); }
      } catch (error) {
        if (!controller.signal.aborted) { hide(); setMessage(error instanceof Error ? error.message : "Content unavailable."); }
      }
    }
    void load();
    return () => controller.abort();
  }, [actorId, base, snapshot.workspaceId]);

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
      if (!signal.aborted) { setMasked(false); setMessage(""); }
      return true;
    } catch (error) {
      if (!signal.aborted) handleAccessFailure(error);
      return false;
    }
  }

  async function write(make: () => Promise<PendingWrite> | PendingWrite) {
    const signal = life.current?.signal;
    if (!signal || signal.aborted || locked.current || readOnly || lostWrite || denied || masked) return;
    locked.current = true;
    setBusy(true); setConflict(false); setMessage("");
    let attempt: PendingWrite | undefined;
    try {
      attempt = await make();
      const csrf = await identity(snapshot.workspaceId, actorId, signal, true);
      await attempt.send(csrf, signal);
      const current = await actorRequest<Content>(actorId, base, { signal });
      if (signal.aborted) return;
      setContent(current);
      if (attempt.action === "save") setNote(current.document);
      if (attempt.action === "upload") { setFile(null); if (fileInput.current) fileInput.current.value = ""; }
      if (attempt.action === "remove") setPreview(undefined);
      setRetry(undefined); setMessage("Saved.");
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof HttpError && (error.status === 401 || error.status === 403 || error.status === 404)) {
        // Revalidate both principal and item access before preserving any private draft.
        if (!await accessCheck(signal)) return;
        if (error instanceof ContentReadOnly) {
          setLostWrite(true); setRetry(undefined); setMessage(error.message); return;
        }
      }
      if (signal.aborted) return;
      if (error instanceof HttpError && [409, 412].includes(error.status)) {
        setConflict(true); setRetry(undefined);
      } else if (!(error instanceof HttpError) || error.status >= 500 || error.status === 403) setRetry(attempt);
      else setRetry(undefined);
      setMessage(error instanceof Error ? error.message : "The write could not be confirmed.");
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
      if (!signal.aborted) { setContent(current); setConflict(false); setMessage("Latest version loaded. Review your draft before saving."); }
    } catch (error) {
      if (!signal.aborted) handleAccessFailure(error);
    }
  }
  const disabled = readOnly || lostWrite || busy || conflict || Boolean(retry);
  return <dialog ref={dialog} aria-label="Notes and files" className="fp-dialog schedule-dialog" aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
    <h3>Notes and files</h3>
    {message && <p role="status">{message}</p>}
    {denied ? <p>Item content is unavailable.</p> : masked ?
      <button type="button" onClick={() => { if (life.current) void accessCheck(life.current.signal); }}>Verify access</button> : content ? <>
      <NoteEditor value={note} change={setNote} disabled={disabled} />
      <button type="button" disabled={disabled} onClick={() => void write(() => ({ send: noteWrite(actorId, snapshot, itemId, content, note), action: "save" }))}>Save note</button>
      {conflict && <button type="button" onClick={() => void compare()}>Compare latest version</button>}
      {!conflict && message.startsWith("Latest version") && <details><summary>Saved note for comparison</summary><NoteEditor value={content.document} change={() => {}} disabled /></details>}
      <h4>Attachments</h4>
      <ul>{content.files.map((attachment) => {
        const url = base + "/files/" + encodeURIComponent(attachment.id);
        return <li key={attachment.id}><a href={url + "/download"} download={attachment.name}>Download {attachment.name}</a>
          {" · "}{attachment.size} bytes
          {attachment.previewable && <button type="button" onClick={() => setPreview(attachment)}>Preview {attachment.name}</button>}
          <button type="button" disabled={disabled} onClick={() => void write(() => ({ send: unlinkWrite(actorId, snapshot, itemId, content, attachment.id), action: "remove" }))}>Remove {attachment.name}</button>
        </li>;
      })}</ul>
      {preview && content.files.some((f) => f.id === preview.id) && <figure><img alt={preview.name} style={{ maxWidth: "100%" }} src={base + "/files/" + encodeURIComponent(preview.id) + "/preview"} />
        <button type="button" onClick={() => setPreview(undefined)}>Close preview</button></figure>}
      <label>Attach file<input ref={fileInput} type="file" disabled={disabled} onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} /></label>
      {file && file.size > content.maxFileBytes && <p role="status">File exceeds the {content.maxFileBytes} byte limit.</p>}
      <button type="button" disabled={disabled || !file || file.size > content.maxFileBytes} onClick={() => {
        if (file) void write(async () => ({ send: await fileWrite(actorId, snapshot, itemId, content, file), action: "upload" }));
      }}>Upload file</button>
      {retry && <button type="button" disabled={busy || readOnly} onClick={() => void write(() => retry)}>Retry same write</button>}
    </> : <p>Loading…</p>}
    <button type="button" disabled={busy} onClick={close}>Close</button>
  </dialog>;
}
