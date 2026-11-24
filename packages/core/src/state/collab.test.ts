import { describe, expect, it } from "vitest";
import type { MarkJSON } from "../model/index.js";
import { AddMarkStep, Step } from "../transform/steps.js";
import { createDocument, type FoliDocument, SCHEMA_VERSION } from "../v3/document.js";
import { collab, receiveTransaction, sendableSteps } from "./collab.js";
import { createEditor } from "./editor.js";

/** "abcdefg" with "de" marked `mark`: text nodes "abc", "de", "fg" (positions 1, 4, 6). */
const document = (mark: MarkJSON): FoliDocument => ({
  ...createDocument(),
  schemaVersion: SCHEMA_VERSION,
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "abc" },
          { type: "text", text: "de", marks: [mark] },
          { type: "text", text: "fg" },
        ],
      },
    ],
  },
});

describe("an unconfirmed mark step taken back (collab.ts inverseOf)", () => {
  it.each([
    ["the same mark", { type: "bold" }, { type: "bold" }],
    [
      "a mark of the same type with other attributes",
      { type: "color", attrs: { value: "FF0000" } },
      { type: "color", attrs: { value: "0000FF" } },
    ],
  ])("over text partly marked with %s gives back the document it was made on", (_, had, added) => {
    const doc = document(had as MarkJSON);
    const editor = createEditor({ document: doc, plugins: [collab({ clientID: 1 })] });
    const { schema } = editor.state;
    const before = editor.state.doc;
    // From "b" to "f": starts inside "abc", ends inside "fg".
    const mark = schema.markFromJSON(added as MarkJSON);
    editor.dispatch(editor.state.tr.step(new AddMarkStep(2, 7, mark)));
    expect(editor.state.doc.eq(before)).toBe(false);

    const other = createEditor({ document: doc, plugins: [collab({ clientID: 2 })] });
    other.select(8);
    other.commands.insertText("x");
    const json = (sendableSteps(other.state)?.steps ?? []).map((s) => s.toJSON());
    const theirs = json.map((s) => Step.fromJSON(schema, s));

    const tr = receiveTransaction(
      editor.state,
      theirs,
      theirs.map(() => 2),
    );
    // Its inverses come first, then theirs, then it again: before theirs, the document it was made on.
    expect(tr.docs[tr.steps.length - theirs.length - 1]?.eq(before)).toBe(true);
  });
});
