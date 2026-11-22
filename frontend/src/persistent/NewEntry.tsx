import { useEffect, useRef, useState } from "react";

export function NewEntry({ kind, onCreate, onClose }: {
  kind: "project" | "tag";
  onCreate: (title: string) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="fp-dialog" aria-labelledby="new-entry-heading"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="new-entry-heading">New {kind}</h2>
    <form onSubmit={event => { event.preventDefault(); if (title.trim() && onCreate(title.trim())) onClose(); }}>
      <label>{kind === "project" ? "Project name" : "Tag name"}
        <input autoFocus value={title} onChange={event => setTitle(event.target.value)} required /></label>
      <button type="submit" disabled={!title.trim()}>Create {kind}</button>
      <button type="button" onClick={onClose}>Cancel</button>
    </form>
  </dialog>;
}
