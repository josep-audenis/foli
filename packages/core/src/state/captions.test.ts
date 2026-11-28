import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { createDocument, parseDocument, SCHEMA_VERSION } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { fieldsIn } from "./fields.js";
import {
  type FieldLayout,
  insertCaption,
  insertTableOfFigures,
  updateFields,
} from "./fieldupdate.js";
import { undo } from "./history.js";
import { insertPicture } from "./pictures.js";
import { NodeSelection } from "./selection.js";
import { CellSelection } from "./tables.js";

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const p = (...content: string[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content: content.map(text) } : {}),
});
const dot = {
  contentType: "image/png",
  data: "data:image/png;base64,iVBORw0KGgo=",
  width: 914400,
  height: 457200,
  alt: "A chart",
};
const editorOf = (content: NodeJSON[]) =>
  createEditor({
    document: {
      ...createDocument(),
      schemaVersion: SCHEMA_VERSION,
      styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
      section: { pageSize: { width: 11906, height: 16838 }, margins: { left: 1440, right: 1440 } },
      content: { type: "doc", content },
    },
  });
const blocks = (editor: Editor) => editor.getDocument().content.content ?? [];
const textOf = (block: NodeJSON | undefined) =>
  (block?.content ?? [])
    .map((n) => n.text ?? (n.type === "fieldCode" ? `{${n.attrs?.text}}` : ""))
    .join("");
const pagesEvery = (perPage: number, pages = 9): FieldLayout => ({
  pages,
  pageAt: (pos) => ({ number: Math.floor(pos / perPage) + 1, sectionPages: pages }),
});

describe("insertCaption (35.3)", () => {
  it("writes Word's caption below a selected picture: the Caption style, SEQ numbered", () => {
    const editor = editorOf([p("before"), p(), p("after")]);
    editor.select(9);
    expect(editor.run(insertPicture(dot))).toBe(true);
    let at = -1;
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "picture") at = pos;
    });
    editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)));
    expect(editor.run(insertCaption({ text: ": A chart" }))).toBe(true);
    const caption = blocks(editor)[2];
    expect(caption?.attrs).toEqual({ style: "Caption" });
    expect(textOf(caption)).toBe(String.raw`Figure { SEQ Figure \* ARABIC }1: A chart`);
    const style = editor.getDocument().styles.find((s) => s.id === "Caption");
    expect(style).toMatchObject({ name: "caption", basedOn: "Normal", next: "Normal" });
    expect(textOf(blocks(editor)[3])).toBe("after");
    // The caret at its end; one undo step.
    expect(editor.state.selection.$from.parentOffset).toBe(
      editor.state.selection.$from.parent.content.size,
    );
    editor.run(undo);
    expect(blocks(editor)).toHaveLength(3);
    expect(editor.getDocument().styles.some((s) => s.id === "Caption")).toBe(false);
    expect(() => parseDocument(editor.getDocument())).not.toThrow();
  });

  it("goes above the caret's table, kept with it, counting the label's captions before it", () => {
    const cell = (value: string): NodeJSON => ({ type: "tableCell", content: [p(value)] });
    const table: NodeJSON = {
      type: "table",
      attrs: { grid: [2000] },
      content: [{ type: "tableRow", content: [cell("x")] }],
    };
    const editor = editorOf([p("intro"), table, p()]);
    editor.select(2);
    editor.run(insertCaption({ label: "Table" }));
    // A first table caption, then one above the table.
    const inCell = (() => {
      let at = 0;
      editor.state.doc.descendants((n, pos) => {
        if (n.isText && n.text === "x") at = pos;
      });
      return at;
    })();
    editor.select(inCell);
    expect(
      editor.run(insertCaption({ label: "Table", position: "above", numbering: "ROMAN" })),
    ).toBe(true);
    const all = blocks(editor);
    const above = all.findIndex((b) => b.type === "table") - 1;
    expect(all[above]?.attrs).toEqual({ style: "Caption", keepNext: true });
    expect(textOf(all[above])).toBe(String.raw`Table { SEQ Table \* ROMAN }II`);
  });

  it("joins a label's words for SEQ, and leaves the label out when asked", () => {
    const editor = editorOf([p("text")]);
    editor.select(3);
    editor.run(insertCaption({ label: "Plan View", excludeLabel: true }));
    expect(textOf(blocks(editor)[1])).toBe(String.raw`{ SEQ Plan_View \* ARABIC }1`);
  });
});

describe("insertTableOfFigures (35.3)", () => {
  it("lists each caption of the label in the Table of Figures style", () => {
    const editor = editorOf([p(), p("one"), p("two")]);
    editor.select(6);
    editor.run(insertCaption({ text: ": First" }));
    editor.select(blocks(editor).length > 0 ? editor.state.doc.content.size - 1 : 0);
    editor.run(insertCaption({ label: "Table", text: ": Not listed" }));
    editor.run(insertCaption({ text: ": Second" }));
    editor.select(1);
    expect(editor.run(insertTableOfFigures({ layout: pagesEvery(1000) }))).toBe(true);
    const toc = fieldsIn(editor.state.doc).find((f) => f.name === "TOC");
    expect(toc?.instruction).toBe(String.raw`TOC \h \z \c "Figure"`);
    expect(toc?.result).toBe("Figure 1: First\t1\rFigure 2: Second\t1");
    expect(blocks(editor)[0]?.attrs?.style).toBe("TableofFigures");
    expect(editor.getDocument().styles.find((s) => s.id === "TableofFigures")?.name).toBe(
      "table of figures",
    );
    updateFields(editor, { layout: pagesEvery(1000) });
    expect(fieldsIn(editor.state.doc).find((f) => f.name === "TOC")?.result).toBe(
      "Figure 1: First\t1\rFigure 2: Second\t1",
    );
  });

  it("says Word's message when there is no caption", () => {
    const editor = editorOf([p()]);
    editor.select(1);
    editor.run(insertTableOfFigures({ label: "Equation" }));
    expect(fieldsIn(editor.state.doc)[0]?.result).toBe("No table of figures entries found.");
  });
});

describe("captions: review cases (35.3)", () => {
  it("keeps Word's table of figures by style (`\\c` with no label) as it is", () => {
    const fieldOf = (code: string, shown: string): NodeJSON[] => [
      { type: "fieldStart" },
      { type: "fieldCode", attrs: { text: ` ${code} ` } },
      { type: "fieldSeparator" },
      { type: "text", text: shown },
      { type: "fieldEnd" },
    ];
    const editor = editorOf([
      { type: "paragraph", content: fieldOf(String.raw`TOC \h \z \t "Caption" \c`, "kept") },
      p("after"),
    ]);
    const report = updateFields(editor, { layout: pagesEvery(1000) });
    expect(fieldsIn(editor.state.doc)[0]?.result).toBe("kept");
    expect(report.skipped).toMatchObject([{ reason: "unsupported-switch", detail: String.raw`\c` }]);
  });

  it("lists a label with quotes, as its SEQ names it", () => {
    const editor = editorOf([p(), p("text")]);
    editor.select(3);
    editor.run(insertCaption({ label: 'My "Fig"' }));
    expect(fieldsIn(editor.state.doc)[0]?.instruction).toBe(String.raw`SEQ My_Fig \* ARABIC`);
    editor.select(1);
    editor.run(insertTableOfFigures({ label: 'My "Fig"', layout: pagesEvery(1000) }));
    const toc = fieldsIn(editor.state.doc).find((f) => f.name === "TOC");
    expect(toc?.instruction).toBe(String.raw`TOC \h \z \c "My_Fig"`);
    expect(toc?.result).toBe('My "Fig" 1\t1');
  });

  it("captions a table its cells are selected in", () => {
    const cell = (value: string): NodeJSON => ({ type: "tableCell", content: [p(value)] });
    const table: NodeJSON = {
      type: "table",
      attrs: { grid: [2000, 2000] },
      content: [{ type: "tableRow", content: [cell("a"), cell("b")] }],
    };
    const editor = editorOf([p("intro"), table, p()]);
    let first = 0;
    let last = 0;
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "tableCell") {
        if (!first) first = pos;
        last = pos;
      }
    });
    editor.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, first, last)),
    );
    expect(editor.run(insertCaption({ label: "Table", position: "above" }))).toBe(true);
    const all = blocks(editor);
    expect(all[1]?.attrs?.style).toBe("Caption");
    expect(all[2]?.type).toBe("table");
  });

  it("stays in the content controls of the paragraph it follows", () => {
    const editor = editorOf([
      { type: "paragraph", attrs: { controls: ["c1"] }, content: [text("in")] },
      { type: "paragraph", attrs: { controls: ["c1"] }, content: [text("also")] },
    ]);
    editor.select(2);
    editor.run(insertCaption());
    expect(blocks(editor)[1]?.attrs).toEqual({ style: "Caption", controls: ["c1"] });
  });
});
