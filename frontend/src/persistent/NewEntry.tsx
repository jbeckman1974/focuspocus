import { useEffect, useRef, useState } from "react";

export function NewEntry({
  kind,
  saving,
  initialTitle,
  onCreate,
  onClose,
}: {
  kind: "project" | "tag";
  saving: boolean;
  initialTitle?: string;
  onCreate: (title: string) => boolean | Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (submitted && !saving) onClose();
  }, [submitted, saving, onClose]);
  return (
    <dialog
      ref={dialog}
      className="fp-dialog"
      aria-labelledby="new-entry-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="new-entry-heading">
        {initialTitle === undefined ? "New" : "Rename"} {kind}
      </h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            !submitted &&
            !saving &&
            title.trim() &&
            (await onCreate(title.trim()))
          )
            setSubmitted(true);
        }}
      >
        <label>
          {kind === "project" ? "Project name" : "Tag name"}
          <input
            autoFocus
            readOnly={submitted || saving}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitted || saving || !title.trim()}>
          {initialTitle === undefined ? "Create" : "Rename"} {kind}
        </button>
        <button type="button" onClick={onClose}>
          {submitted || saving ? "Close" : "Cancel"}
        </button>
        {saving && <span role="status">Saving {kind}…</span>}
      </form>
    </dialog>
  );
}
