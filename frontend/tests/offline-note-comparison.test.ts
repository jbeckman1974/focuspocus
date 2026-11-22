import assert from "node:assert/strict";
import test from "node:test";
import { noteExcerpt } from "../src/persistent/content/noteExcerpt.ts";
import {
  requireContentTarget,
  type AuthorizedContent,
} from "../src/persistent/content/authorizedContent.ts";

test("note comparisons show bounded Unicode text while retaining the complete rich draft", () => {
  const text = "😺".repeat(3000);
  const document = {
    paragraphs: [[{ text: "Bench <script>", bold: true }], [{ text }]],
  };
  const preview = noteExcerpt(document);
  assert.ok(preview.startsWith("Bench <script>\n😺"));
  assert.ok(preview.endsWith("😺…"));
  assert.equal(Array.from(preview).length, 2001);
  assert.equal(document.paragraphs[1][0].text, text);
});

test("a content response for a different task or workspace is rejected before comparison", () => {
  const workspaceId = crypto.randomUUID(),
    itemId = crypto.randomUUID();
  const response = { workspaceId, itemId } as AuthorizedContent;
  requireContentTarget(response, workspaceId, itemId);
  assert.throws(
    () => requireContentTarget(response, workspaceId, crypto.randomUUID()),
    /different task/,
  );
  assert.throws(
    () => requireContentTarget(response, crypto.randomUUID(), itemId),
    /different task/,
  );
});
