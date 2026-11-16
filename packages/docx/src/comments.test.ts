import { readFileSync } from "node:fs";
import { createDocument, createEditor } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);

describe("comments made in the editor", () => {
  const exercise = (editor: ReturnType<typeof createEditor>) => {
    editor.select(1, 4);
    editor.commands.addComment("First\nsecond line", { initials: "AU" });
    const id = Math.max(...editor.getDocument().comments.map((c) => c.id));
    editor.commands.replyToComment(id, "A reply", { author: "Other" });
    editor.commands.resolveComment(id);
    return id;
  };
  /** The comments as Word keeps them: text, author, thread, state. */
  const view = (comments: ReturnType<ReturnType<typeof createEditor>["getDocument"]>["comments"]) =>
    comments.map((c) => ({
      id: c.id,
      author: c.author,
      initials: c.initials,
      parent: c.parent,
      done: c.done ?? false,
      text: c.content.map((p) => (p.content ?? []).map((n) => n.text ?? "").join("")),
    }));

  it("come back from a new package with their thread and state", async () => {
    const editor = createEditor({
      document: createDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Commented text" }] }],
      }),
      author: "Author One",
    });
    exercise(editor);
    const again = await importDocx(await exportDocx(editor.getDocument()));
    expect(view(again.document.comments)).toEqual(view(editor.getDocument().comments));
    expect(again.document.content).toEqual(editor.getDocument().content);
  });

  it("come back from a corpus package that has comments already", async () => {
    const imported = await importDocx(
      new Uint8Array(readFileSync(new URL("02-services-agreement-redlined.docx", CORPUS))),
    );
    const editor = createEditor({ document: imported.document, author: "Author One" });
    const before = imported.document.comments.length;
    exercise(editor);
    const again = await importDocx(await exportDocx(editor.getDocument(), imported.package));
    expect(again.document.comments).toHaveLength(before + 2);
    expect(view(again.document.comments)).toEqual(view(editor.getDocument().comments));
  });
});
