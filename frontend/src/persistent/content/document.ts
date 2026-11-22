export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  link?: string;
}
export interface NoteDocument {
  paragraphs: TextRun[][];
}
export const emptyNote: NoteDocument = { paragraphs: [] };

export function plainText(note: NoteDocument) {
  return note.paragraphs.map((p) => p.map((r) => r.text).join("")).join("\n");
}

function runs(note: NoteDocument): TextRun[] {
  return note.paragraphs.flatMap((paragraph, index) =>
    index ? [{ text: "\n" }, ...paragraph] : paragraph,
  );
}

function sliceRuns(items: TextRun[], start: number, end: number) {
  const out: TextRun[] = [];
  let offset = 0;
  for (const run of items) {
    const left = Math.max(0, start - offset);
    const right = Math.min(run.text.length, end - offset);
    if (right > left) out.push({ ...run, text: run.text.slice(left, right) });
    offset += run.text.length;
    if (offset >= end) break;
  }
  return out;
}

function collect(items: TextRun[]): NoteDocument {
  const paragraphs: TextRun[][] = [[]];
  for (const run of items) {
    run.text.split("\n").forEach((text, index) => {
      if (index) paragraphs.push([]);
      if (!text) return;
      const last = paragraphs[paragraphs.length - 1];
      const before = last[last.length - 1];
      if (before && before.bold === run.bold && before.italic === run.italic && before.link === run.link)
        before.text += text;
      else last.push({ ...run, text });
    });
  }
  return { paragraphs };
}

export function replaceText(note: NoteDocument, replacement: string) {
  const original = plainText(note);
  let left = 0;
  while (left < original.length && left < replacement.length && original[left] === replacement[left]) left++;
  let oldEnd = original.length;
  let newEnd = replacement.length;
  while (oldEnd > left && newEnd > left && original[oldEnd - 1] === replacement[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const segments = runs(note);
  return collect([
    ...sliceRuns(segments, 0, left),
    { text: replacement.slice(left, newEnd) },
    ...sliceRuns(segments, oldEnd, original.length),
  ]);
}

export function applyMark(note: NoteDocument, start: number, end: number, key: "bold" | "italic" | "link", url?: string) {
  if (end <= start) return note;
  const segments = runs(note);
  const selection = sliceRuns(segments, start, end);
  const remove = key !== "link" && selection.every((run) => run[key]);
  for (const run of selection) {
    if (key === "link") {
      if (url) run.link = url;
      else delete run.link;
    } else if (remove) delete run[key];
    else run[key] = true;
  }
  return collect([...sliceRuns(segments, 0, start), ...selection, ...sliceRuns(segments, end, Infinity)]);
}
