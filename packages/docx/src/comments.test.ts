import { readFileSync } from "node:fs";
import { commentMentions, createDocument, createEditor, mentionText } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";
import { docx } from "./testing/package.js";

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

  it("keep their mentions: @ and the name, linked to mailto: the address", async () => {
    const editor = createEditor({
      document: createDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Commented text" }] }],
      }),
    });
    editor.select(1, 4);
    const person = { name: "Jo Doe", email: "jo@example.com" };
    editor.commands.addComment([
      { type: "paragraph", content: [{ type: "text", text: "Ask " }, mentionText(person)] },
    ]);
    const again = await importDocx(await exportDocx(editor.getDocument()));
    expect(again.document.comments.map(commentMentions)).toEqual([[person]]);
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

describe("comments whose ids a file repeats (21.3, renumbered by parseDocument)", () => {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const anchored = (id: number, text: string) =>
    `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>${text}</w:t></w:r><w:commentRangeEnd w:id="${id}"/>` +
    `<w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;
  const comment = (id: number, author: string, text: string) =>
    `<w:comment w:id="${id}" w:author="${author}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;
  const file = () =>
    docx(anchored(1, "a") + anchored(1, "b") + anchored(2, "c"), {
      rels: `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>`,
      parts: {
        "word/comments.xml": `<w:comments xmlns:w="${W}">${comment(1, "A", "first")}${comment(1, "B", "second")}${comment(2, "C", "third")}</w:comments>`,
      },
    });

  it("are read each with an id of its own, its anchors following it", async () => {
    const { document } = await importDocx(await file());
    expect(document.comments.map((c) => [c.id, c.author])).toEqual([
      [1, "A"],
      [3, "B"],
      [2, "C"],
    ]);
    const ids = document.content.content?.map((p) =>
      (p.content ?? []).filter((n) => n.type !== "text").map((n) => n.attrs?.id),
    );
    expect(ids).toEqual([
      [1, 1, 1],
      [3, 3, 3],
      [2, 2, 2],
    ]);
  });

  it("are edited and resolved one at a time", async () => {
    const { document } = await importDocx(await file());
    const editor = createEditor({ document, author: "Me" });
    expect(editor.commands.resolveComment(2)).toBe(true);
    expect(editor.commands.resolveComment(3)).toBe(true);
    const by = (id: number) => editor.getDocument().comments.find((c) => c.id === id);
    expect([by(1)?.done, by(3)?.done, by(2)?.done]).toEqual([undefined, true, true]);
    expect(by(1)?.author).toBe("A");
    const again = await importDocx(await exportDocx(editor.getDocument()));
    expect(again.document.comments.map((c) => [c.id, c.author, c.done])).toEqual(
      editor.getDocument().comments.map((c) => [c.id, c.author, c.done]),
    );
    expect(again.document.content).toEqual(editor.getDocument().content);
  });
});
