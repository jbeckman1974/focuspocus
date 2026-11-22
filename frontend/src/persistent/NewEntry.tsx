import { useEffect, useRef, useState } from "react";

export function NewEntry({ kind, initialTitle, onCreate, onClose }: {
  kind: "project" | "tag";
  initialTitle?: string;
  onCreate: (title: string) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(initialTitle ?? "");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="fp-dialog" aria-labelledby="new-entry-heading"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="new-entry-heading">{initialTitle === undefined ? "New" : "Rename"} {kind}</h2>
    <form onSubmit={event => { event.preventDefault(); if (title.trim() && onCreate(title.trim())) onClose(); }}>
      <label>{kind === "project" ? "Project name" : "Tag name"}
        <input autoFocus value={title} onChange={event => setTitle(event.target.value)} required /></label>
      <button type="submit" disabled={!title.trim()}>{initialTitle === undefined ? "Create" : "Rename"} {kind}</button>
      <button type="button" onClick={onClose}>Cancel</button>
    </form>
  </dialog>;
}
