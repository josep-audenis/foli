import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { parseDocument } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { insertPicture, selectedPicture, setPictureAlt, setPictureSize } from "./pictures.js";
import { NodeSelection, TextSelection } from "./selection.js";
import { CellSelection } from "./tables.js";

/** Picture commands (10.8, ADR-0006). */

const DOT = "data:image/png;base64,iVBORw0KGgo=";
const editorOf = (content: NodeJSON[], tracking = false) =>
  createEditor({
    document: {
      schemaVersion: 4,
      section: {},
      defaults: {},
      styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      content: { type: "doc", content },
    },
    ...(tracking ? { author: "Me", trackChanges: true } : {}),
  });
type Editor = ReturnType<typeof editorOf>;
const p = (text: string): NodeJSON => ({ type: "paragraph", content: [{ type: "text", text }] });
const dot = { contentType: "image/png", data: DOT, width: 914400, height: 457200 };
const caret = (editor: Editor, pos: number) =>
  editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
const inline = (editor: Editor) =>
  (editor.getDocument().content.content?.[0]?.content ?? []).map((n) =>
    n.type === "picture" ? `[${String(n.attrs?.alt ?? "")}]` : n.text,
  );

describe("insertPicture", () => {
  it("inserts at the caret, its image a new resource, the caret after it", () => {
    const editor = editorOf([p("abcd")]);
    caret(editor, 3);
    expect(editor.run(insertPicture({ ...dot, alt: "A dot" }))).toBe(true);
    expect(inline(editor)).toEqual(["ab", "[A dot]", "cd"]);
    const document = editor.getDocument();
    expect(document.resources?.["foli-picture-1"]).toEqual({ contentType: "image/png", data: DOT });
    expect(editor.state.selection.head).toBe(4);
    expect(() => parseDocument(document)).not.toThrow();
    // A second one gets its own key.
    editor.run(insertPicture({ ...dot, alt: "Another" }));
    expect(Object.keys(editor.getDocument().resources ?? {})).toEqual([
      "foli-picture-1",
      "foli-picture-2",
    ]);
  });

  it("asks for alt text unless the picture is decorative", () => {
    const editor = editorOf([p("ab")]);
    caret(editor, 2);
    expect(editor.run(insertPicture({ ...dot }))).toBe(false);
    expect(editor.run(insertPicture({ ...dot, alt: "  " }))).toBe(false);
    expect(editor.run(insertPicture({ ...dot, decorative: true }))).toBe(true);
    const picture = editor.getDocument().content.content?.[0]?.content?.[1];
    expect(picture?.attrs).toMatchObject({ decorative: true });
  });

  it("refuses an image the document cannot hold", () => {
    const editor = editorOf([p("ab")]);
    caret(editor, 2);
    const refused = [
      { ...dot, alt: "x", contentType: "text/html" },
      { contentType: "image/png", url: "javascript:alert(1)", width: 10, height: 10, alt: "x" },
      { contentType: "image/png", width: 10, height: 10, alt: "x" },
      { ...dot, alt: "x", width: 0 },
    ];
    for (const picture of refused) expect(editor.run(insertPicture(picture))).toBe(false);
    expect(
      editor.run(
        insertPicture({
          contentType: "image/png",
          width: 10,
          height: 10,
          url: "https://x.test/a.png",
          alt: "x",
        }),
      ),
    ).toBe(true);
  });

  it("is a tracked insertion while tracking; rejecting it removes the picture", () => {
    const editor = editorOf([p("ab")], true);
    caret(editor, 2);
    editor.run(insertPicture({ ...dot, alt: "A dot" }));
    const picture = editor.getDocument().content.content?.[0]?.content?.[1];
    expect(picture?.marks?.[0]).toMatchObject({ type: "insertion", attrs: { author: "Me" } });
    editor.commands.rejectAllChanges();
    expect(inline(editor)).toEqual(["ab"]);
  });

  it("is one undo step", () => {
    const editor = editorOf([p("ab")]);
    caret(editor, 2);
    editor.run(insertPicture({ ...dot, alt: "A dot" }));
    editor.commands.undo();
    expect(inline(editor)).toEqual(["ab"]);
  });
});

describe("a picture's size and alt text", () => {
  const withPicture = (tracking = false) => {
    const editor = editorOf([p("abcd")], tracking);
    caret(editor, 3);
    editor.run(insertPicture({ ...dot, alt: "A dot" }));
    editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 3)));
    return editor;
  };

  it("change, the picture still selected", () => {
    const editor = withPicture();
    expect(selectedPicture(editor.state)?.pos).toBe(3);
    expect(editor.run(setPictureSize(3, 457200, 228600))).toBe(true);
    expect(selectedPicture(editor.state)?.node.attrs).toMatchObject({
      width: 457200,
      height: 228600,
    });
    expect(editor.run(setPictureAlt(3, "A small dot"))).toBe(true);
    expect(selectedPicture(editor.state)?.node.attrs.alt).toBe("A small dot");
    expect(editor.run(setPictureAlt(3, "", true))).toBe(true);
    expect(selectedPicture(editor.state)?.node.attrs).toMatchObject({
      alt: null,
      decorative: true,
    });
  });

  it("refuse what the model cannot hold, and anything but a picture", () => {
    const editor = withPicture();
    expect(editor.run(setPictureSize(3, 0, 10))).toBe(false);
    expect(editor.run(setPictureSize(3, 1.5, 10))).toBe(false);
    expect(editor.run(setPictureAlt(3, " "))).toBe(false);
    expect(editor.run(setPictureSize(1, 10, 10))).toBe(false);
  });

  it("size does not change while tracking; alt text does", () => {
    const editor = withPicture(true);
    expect(editor.run(setPictureSize(3, 457200, 228600))).toBe(false);
    expect(editor.run(setPictureAlt(3, "A small dot"))).toBe(true);
  });
});

describe("review findings", () => {
  it("never carries a tracked change of the text around it", () => {
    const editor = editorOf([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "gone",
            marks: [{ type: "deletion", attrs: { id: 1, author: "Other" } }],
          },
        ],
      },
    ]);
    caret(editor, 3);
    expect(editor.run(insertPicture({ ...dot, alt: "A dot" }))).toBe(true);
    const picture = editor
      .getDocument()
      .content.content?.[0]?.content?.find((n) => n.type === "picture");
    expect(picture?.marks ?? []).toEqual([]);
  });

  it("refuses alt text and titles the model cannot hold, and a data: URL of another type", () => {
    const editor = editorOf([p("ab")]);
    caret(editor, 2);
    expect(editor.run(insertPicture({ ...dot, alt: "x".repeat(70_000) }))).toBe(false);
    expect(editor.run(insertPicture({ ...dot, alt: "x", title: 5 as unknown as string }))).toBe(
      false,
    );
    expect(
      editor.run(insertPicture({ ...dot, alt: "x", data: "data:image/svg+xml,%3Csvg/%3E" })),
    ).toBe(false);
  });

  it("replaces only the anchor cell's content over selected cells", () => {
    const cell = (text: string): NodeJSON => ({ type: "tableCell", content: [p(text)] });
    const row = (...cells: NodeJSON[]): NodeJSON => ({ type: "tableRow", content: cells });
    const editor = editorOf([
      p("x"),
      { type: "table", content: [row(cell("a1"), cell("b1")), row(cell("a2"), cell("b2"))] },
      p("y"),
    ]);
    const cellPos = (text: string) => {
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at < 0 && node.type.name === "tableCell" && node.textContent === text) at = pos;
      });
      return at;
    };
    editor.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, cellPos("a1"), cellPos("b2")),
      ),
    );
    expect(editor.run(insertPicture({ ...dot, alt: "A dot" }))).toBe(true);
    const texts: string[] = [];
    editor.state.doc.child(1).forEach((r) => {
      r.forEach((c) => {
        texts.push(c.textContent);
      });
    });
    expect(texts).toEqual(["", "b1", "a2", "b2"]);
    expect(editor.state.doc.child(1).child(0).child(0).firstChild?.firstChild?.type.name).toBe(
      "picture",
    );
  });

  it("changes alt text only when it changes; a decorative picture has none", () => {
    const editor = editorOf([p("abcd")]);
    caret(editor, 3);
    editor.run(insertPicture({ ...dot, alt: "A dot" }));
    expect(editor.run(setPictureAlt(3, "A dot"))).toBe(false);
    expect(editor.run(setPictureAlt(3, "A dot", true))).toBe(true);
    expect(editor.state.doc.nodeAt(3)?.attrs).toMatchObject({ alt: null, decorative: true });
  });
});
