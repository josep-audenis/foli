import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { createDocument, parseDocument, SCHEMA_VERSION } from "../v3/document.js";
import { coverPageId, insertBlankPage, insertCoverPage, removeCoverPage } from "./cover.js";
import { createEditor } from "./editor.js";
import { undo } from "./history.js";
import { setTrackChanges } from "./track.js";

const p = (text: string): NodeJSON => ({ type: "paragraph", content: [{ type: "text", text }] });
const editorOf = () =>
  createEditor({
    document: {
      ...createDocument(),
      schemaVersion: SCHEMA_VERSION,
      styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
      content: { type: "doc", content: [p("Body")] },
    },
  });
const blocks = (editor: ReturnType<typeof editorOf>) => editor.getDocument().content.content ?? [];

describe("Insert ▸ Cover Page (35.6)", () => {
  it("puts Word's cover building block first: a Cover Pages control, its fields, a page break", () => {
    const editor = editorOf();
    expect(editor.run(insertCoverPage("Banded"))).toBe(true);
    const id = coverPageId(editor.state);
    expect(id).not.toBeNull();
    const doc = editor.getDocument();
    const cover = doc.controls?.[id as string];
    expect(cover?.kind).toBe("other");
    expect(cover?.ext).toContain('<w:docPartGallery w:val="Cover Pages"/><w:docPartUnique/>');
    const inCover = blocks(editor).filter((b) =>
      (b.attrs?.controls as string[] | undefined)?.includes(id as string),
    );
    expect(inCover).toHaveLength(6);
    // A band of the accent fixed on the page, behind the text.
    const band = inCover[0]?.content?.[0];
    expect(band).toMatchObject({
      type: "shape",
      attrs: { float: { wrap: "behind", horizontal: { relativeTo: "page" } } },
    });
    // The fields as content controls showing their placeholders.
    const aliases = Object.values(doc.controls ?? {})
      .map((c) => c.alias)
      .filter(Boolean);
    expect(aliases).toEqual(["Title", "Subtitle", "Author", "Date"]);
    expect(JSON.stringify(inCover)).toContain("[Document title]");
    expect(inCover.at(-1)?.content?.map((n) => n.type)).toEqual(["pageBreak"]);
    expect(blocks(editor).at(-1)).toEqual(p("Body"));
    expect(() => parseDocument(editor.getDocument())).not.toThrow();
    editor.run(undo);
    expect(blocks(editor)).toEqual([p("Body")]);
    expect(coverPageId(editor.state)).toBeNull();
  });

  it("replaces the current cover, as Word's, and removes it", () => {
    const editor = editorOf();
    editor.run(insertCoverPage("Sidebar"));
    editor.run(insertCoverPage("Simple"));
    const doc = editor.getDocument();
    const covers = Object.values(doc.controls ?? {}).filter((c) => c.kind === "other");
    expect(covers).toHaveLength(1);
    expect(Object.values(doc.controls ?? {}).filter((c) => c.alias === "Title")).toHaveLength(1);
    expect(blocks(editor).some((b) => b.content?.some((n) => n.type === "shape"))).toBe(false);
    expect(editor.run(removeCoverPage)).toBe(true);
    expect(blocks(editor)).toEqual([p("Body")]);
    expect(editor.getDocument().controls ?? {}).toEqual({});
    expect(editor.run(removeCoverPage)).toBe(false);
  });

  it("is not inserted while tracking", () => {
    const editor = editorOf();
    editor.run(setTrackChanges(true));
    expect(editor.run(insertCoverPage("Banded"))).toBe(false);
  });
});

describe("Insert ▸ Blank Page (35.6)", () => {
  it("puts two page breaks at the selection, one undo step", () => {
    const editor = editorOf();
    editor.select(3);
    expect(editor.run(insertBlankPage)).toBe(true);
    expect(blocks(editor)[0]?.content?.map((n) => n.type)).toEqual([
      "text",
      "pageBreak",
      "pageBreak",
      "text",
    ]);
    expect(editor.state.selection.from).toBe(5);
    editor.run(undo);
    expect(blocks(editor)).toEqual([p("Body")]);
  });
});
