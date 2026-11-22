import type { NoteDocument } from "./document.ts";

const MAX_CHARACTERS = 2000;

export function noteExcerpt(note: NoteDocument) {
  const characters: string[] = [];
  for (const [index, paragraph] of note.paragraphs.entries()) {
    if (index > 0) characters.push("\n");
    if (characters.length > MAX_CHARACTERS) break;
    for (const run of paragraph) {
      for (const character of run.text) {
        if (characters.length === MAX_CHARACTERS)
          return characters.join("") + "…";
        characters.push(character);
      }
    }
  }
  if (characters.length > MAX_CHARACTERS)
    return characters.slice(0, MAX_CHARACTERS).join("") + "…";
  return characters.join("");
}
