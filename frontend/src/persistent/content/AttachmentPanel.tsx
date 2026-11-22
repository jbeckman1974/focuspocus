import { useState } from "react";
import type { Content } from "./transport.ts";

interface Props {
  base: string;
  content: Content;
  disabled: boolean;
  remove(id: string): void;
  upload(file: File): void;
}

export function AttachmentPanel({
  base,
  content,
  disabled,
  remove,
  upload,
}: Props) {
  const [previewId, setPreview] = useState<string>();
  const [file, setFile] = useState<File>();
  const preview = content.files.find((f) => f.id === previewId);
  const url = (id: string) => base + "/files/" + encodeURIComponent(id);
  return (
    <>
      <h4>Attachments</h4>
      <ul>
        {content.files.map((attachment) => (
          <li key={attachment.id}>
            <a
              href={url(attachment.id) + "/download"}
              download={attachment.name}
            >
              Download {attachment.name}
            </a>
            {" · "}
            {attachment.size} bytes
            {attachment.previewable && (
              <button type="button" onClick={() => setPreview(attachment.id)}>
                Preview {attachment.name}
              </button>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => remove(attachment.id)}
            >
              Remove {attachment.name}
            </button>
          </li>
        ))}
      </ul>
      {preview && (
        <figure>
          <img
            alt={preview.name}
            style={{ maxWidth: "100%" }}
            src={url(preview.id) + "/preview"}
          />
          <button type="button" onClick={() => setPreview(undefined)}>
            Close preview
          </button>
        </figure>
      )}
      <label>
        Attach file
        <input
          type="file"
          disabled={disabled}
          onChange={(e) => setFile(e.currentTarget.files?.[0])}
        />
      </label>
      {file && file.size > content.maxFileBytes && (
        <p role="status">File exceeds the {content.maxFileBytes} byte limit.</p>
      )}
      <button
        type="button"
        disabled={disabled || !file || file.size > content.maxFileBytes}
        onClick={() => {
          if (file) upload(file);
        }}
      >
        Upload file
      </button>
    </>
  );
}
