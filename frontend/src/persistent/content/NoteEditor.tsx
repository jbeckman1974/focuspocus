import { useRef, useState } from "react";
import { applyMark, plainText, replaceText, type NoteDocument } from "./document.ts";

export function NoteEditor({ value, change, disabled }: { value: NoteDocument; change: (note: NoteDocument) => void; disabled: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [link, setLink] = useState<string | null>(null);
  function apply(key: "bold" | "italic" | "link", url?: string) {
    change(applyMark(value, ...range, key, url));
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(...range);
    });
  }
  return (
    <section aria-label="Item note">
      <label>Note text<textarea ref={input} rows={6} disabled={disabled}
        value={plainText(value)} onChange={(e) => change(replaceText(value, e.currentTarget.value))}
        onSelect={(e) => setRange([e.currentTarget.selectionStart, e.currentTarget.selectionEnd])} /></label>
      <div role="group" aria-label="Format selected note text">
        <button type="button" disabled={disabled || range[0] === range[1]} onClick={() => apply("bold")}>Bold</button>
        <button type="button" disabled={disabled || range[0] === range[1]} onClick={() => apply("italic")}>Italic</button>
        <button type="button" disabled={disabled || range[0] === range[1]} onClick={() => setLink("")}>Add link</button>
      </div>
      {link !== null && <div>
        <label>Link URL<input type="url" value={link} onChange={(e) => setLink(e.currentTarget.value)} /></label>
        <button type="button" disabled={disabled || !/^https?:\/\//i.test(link)} onClick={() => { apply("link", link); setLink(null); }}>Apply link</button>
        <button type="button" onClick={() => setLink(null)}>Cancel link</button>
      </div>}
      <div aria-label="Formatted note">
        {value.paragraphs.map((parts, i) => <p key={i}>{parts.map((part, j) => {
          let text = <span>{part.text}</span>;
          if (part.bold) text = <strong>{text}</strong>;
          if (part.italic) text = <em>{text}</em>;
          if (part.link && /^https?:\/\//i.test(part.link)) text = <a href={part.link} rel="noreferrer noopener" target="_blank">{text}</a>;
          return <span key={j}>{text}</span>;
        })}</p>)}
      </div>
    </section>
  );
}
