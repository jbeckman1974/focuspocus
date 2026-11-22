import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMark,
  plainText,
  replaceText,
  type NoteDocument,
} from "../src/persistent/content/document.ts";

test("preserves rich spans while editing other paragraphs", () => {
  const note: NoteDocument = {
    paragraphs: [[{ text: "Café" }], [{ text: "Bench, β" }]],
  };
  const marked = applyMark(note, 0, 4, "bold");
  const linked = applyMark(
    marked,
    5,
    10,
    "link",
    "https://example.invalid/bench",
  );
  const edited = replaceText(linked, "Café\nBench, β!");
  assert.equal(plainText(edited), "Café\nBench, β!");
  assert.deepEqual(edited.paragraphs[0], [{ text: "Café", bold: true }]);
  assert.deepEqual(edited.paragraphs[1][0], {
    text: "Bench",
    link: "https://example.invalid/bench",
  });
  assert.deepEqual(note.paragraphs[0], [{ text: "Café" }]);
});

test("marks a range across paragraphs and removes just the requested mark", () => {
  const note = replaceText({ paragraphs: [] }, "A\nB");
  const styled = applyMark(applyMark(note, 0, 3, "italic"), 0, 3, "bold");
  const toggled = applyMark(styled, 2, 3, "bold");
  assert.deepEqual(toggled.paragraphs, [
    [{ text: "A", italic: true, bold: true }],
    [{ text: "B", italic: true }],
  ]);
  assert.equal(plainText(replaceText(toggled, "")), "");
});

test("replacing an emoji keeps complete code points in each formatted run", () => {
  // The first pair shares a leading surrogate, the second a trailing surrogate.
  for (const [before, after] of [
    ["😀", "😁"],
    ["𐀀", "𐐀"],
  ]) {
    const note = { paragraphs: [[{ text: `A${before}B`, bold: true }]] };
    const edited = replaceText(note, `A${after}B`);
    assert.deepEqual(edited.paragraphs[0], [
      { text: "A", bold: true },
      { text: after },
      { text: "B", bold: true },
    ]);
  }
});

test("formatting expands a partial UTF-16 selection to the whole emoji", () => {
  const note = { paragraphs: [[{ text: "A😀B" }]] };
  for (const [start, end] of [
    [1, 2],
    [2, 3],
  ]) {
    assert.deepEqual(applyMark(note, start, end, "italic").paragraphs[0], [
      { text: "A" },
      { text: "😀", italic: true },
      { text: "B" },
    ]);
  }
});

test("toggles a mark off across formatted paragraphs and empty lines", () => {
  const original = {
    paragraphs: [[{ text: "A", italic: true }], [], [{ text: "B" }]],
  };
  const end = plainText(original).length;
  const bold = applyMark(original, 0, end, "bold");
  assert.deepEqual(applyMark(bold, 0, end, "bold"), original);
});
