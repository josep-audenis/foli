import { describe, expect, it } from "vitest";
import { createDocument } from "../v3/document.js";
import { insertText } from "./commands.js";
import { createEditor } from "./editor.js";
import { acceptChangesById, rejectChangesById, trackedChanges } from "./review.js";
import { TextSelection } from "./selection.js";

describe("accepting and rejecting changes by id (23.8)", () => {
  it("resolves the changes named and only those", () => {
    const editor = createEditor({
      document: createDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "one two" }] }],
      }),
      author: "Me",
      trackChanges: true,
    });
    const typeAt = (pos: number, text: string) => {
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
      editor.run(insertText(text));
    };
    typeAt(1, "A");
    typeAt(9, "B");
    const [first, second] = trackedChanges(editor.state.doc);
    expect(editor.run(acceptChangesById([first?.id as number]))).toBe(true);
    expect(trackedChanges(editor.state.doc).map((c) => c.id)).toEqual([second?.id]);
    expect(editor.run(rejectChangesById([second?.id as number]))).toBe(true);
    expect(editor.state.doc.textContent).toBe("Aone two");
    expect(editor.run(acceptChangesById([999]))).toBe(false);
  });
});
