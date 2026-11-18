import { describe, expect, it } from "vitest";
import { createDocument, type FoliDocument, type SectionJSON } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { redo, undo } from "./history.js";
import { acceptAllChanges, rejectAllChanges, trackedChanges } from "./review.js";
import {
  insertSectionBreak,
  removeSectionBreak,
  sectionAt,
  sectionColumns,
  setSectionSetup,
} from "./sections.js";
import { setTrackChanges } from "./track.js";
import { setEnvelopeValue, wordContext } from "./word.js";

const SETUP: SectionJSON = {
  pageSize: { width: 12000, height: 16000 },
  margins: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
  headers: { default: "rId1" },
  titlePage: true,
  columns: { count: 2, space: 500 },
};
const p = (text: string, attrs?: Record<string, unknown>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
function editorOf(blocks: unknown[], section = SETUP, trackChanges = false): Editor {
  const base = createDocument();
  const document = {
    ...base,
    section,
    content: { type: "doc", content: blocks },
  } as FoliDocument;
  return createEditor({ document, trackChanges, author: "Ann" });
}
const blocks = (editor: Editor) => editor.getDocument().content.content ?? [];
const sectionsOf = (editor: Editor) =>
  blocks(editor).flatMap((b) => (b.attrs?.section ? [b.attrs.section as SectionJSON] : []));
const texts = (editor: Editor) =>
  blocks(editor).map((b) => (b.content ?? []).map((c) => c.text).join(""));

describe("sectionColumns", () => {
  it("shares the text width among equal columns", () => {
    const columns = sectionColumns(SETUP);
    expect(columns.widths).toEqual([4750, 4750]);
    expect(columns.gaps).toEqual([500]);
    expect(columns.separator).toBe(false);
  });

  it("takes set widths only when the columns are not equal", () => {
    const widths = [{ width: 4000, space: 300 }, { width: 2000 }];
    expect(
      sectionColumns({ columns: { count: 2, space: 400, equalWidth: false, widths } }),
    ).toEqual({ widths: [4000, 2000], gaps: [300], separator: false });
    expect(sectionColumns({ columns: { count: 2, widths } }).widths[0]).toBe(4320);
    expect(sectionColumns({}).widths).toEqual([9360]);
  });
});

describe("insertSectionBreak", () => {
  it("splits the paragraph as Word does: the setup before, the kind after", () => {
    const editor = editorOf([p("Hello world")]);
    editor.select(6);
    expect(editor.run(insertSectionBreak("continuous"))).toBe(true);
    expect(texts(editor)).toEqual(["Hello", " world"]);
    expect(sectionsOf(editor)).toEqual([SETUP]);
    const last = editor.getDocument().section;
    expect(last.type).toBe("continuous");
    expect(last.headers).toBeUndefined();
    expect(last.titlePage).toBe(true);
    expect(last.columns).toEqual(SETUP.columns);
    expect(editor.state.selection.from).toBe(8);
  });

  it("makes an empty paragraph at the start of one, and a new one at its end", () => {
    let editor = editorOf([p("abc")]);
    editor.select(1);
    editor.run(insertSectionBreak());
    expect(texts(editor)).toEqual(["", "abc"]);
    expect(editor.getDocument().section.type).toBeUndefined();
    editor = editorOf([p("abc")]);
    editor.select(4);
    editor.run(insertSectionBreak("oddPage"));
    expect(texts(editor)).toEqual(["abc", ""]);
    expect(editor.getDocument().section.type).toBe("oddPage");
  });

  it("in a paragraph that ends a section, the later part keeps that break", () => {
    const own = { columns: { count: 3 } };
    const editor = editorOf([p("abcd", { section: own }), p("z")]);
    editor.select(3);
    editor.run(insertSectionBreak("evenPage"));
    expect(sectionsOf(editor)).toEqual([own, { ...own, type: "evenPage" }]);
    expect(editor.getDocument().section).toEqual(SETUP);
  });

  it("is one undo step, the last section included, and redo brings it back", () => {
    const editor = editorOf([p("Hello")]);
    const before = editor.getDocument();
    editor.select(3);
    editor.run(insertSectionBreak("continuous"));
    const after = editor.getDocument();
    editor.run(undo);
    expect(editor.getDocument()).toEqual(before);
    editor.run(redo);
    expect(editor.getDocument()).toEqual(after);
  });

  it("is not for a table cell", () => {
    const cell = { type: "tableCell", content: [p("x")] };
    const table = { type: "table", content: [{ type: "tableRow", content: [cell] }] };
    const editor = editorOf([table, p("")]);
    editor.select(4);
    expect(editor.can(insertSectionBreak())).toBe(false);
  });

  it("is a tracked paragraph mark while tracking; rejecting it restores the section", () => {
    const editor = editorOf([p("Hello")], SETUP, true);
    const before = editor.getDocument();
    editor.select(3);
    editor.run(insertSectionBreak("continuous"));
    expect(blocks(editor)[0]?.attrs?.revision).toMatchObject({ insertion: { author: "Ann" } });
    expect(trackedChanges(editor.state.doc).map((c) => c.kind)).toEqual(["paragraphInsertion"]);
    editor.run(rejectAllChanges());
    expect(texts(editor)).toEqual(["Hello"]);
    expect(editor.getDocument().section).toEqual(before.section);
  });

  it("accepted, the break stays", () => {
    const editor = editorOf([p("Hello")], SETUP, true);
    editor.select(3);
    editor.run(insertSectionBreak());
    editor.run(acceptAllChanges());
    expect(sectionsOf(editor)).toHaveLength(1);
    expect(blocks(editor)[0]?.attrs?.revision).toBeUndefined();
  });
});

describe("removeSectionBreak", () => {
  const first: SectionJSON = {
    type: "oddPage",
    headers: { default: "rId2" },
    columns: { count: 3 },
  };

  it("joins the paragraph with the next; the later section stays, inheriting", () => {
    const editor = editorOf([p("ab", { section: first }), p("cd")], { columns: { count: 2 } });
    editor.select(5);
    expect(editor.run(removeSectionBreak)).toBe(true);
    expect(texts(editor)).toEqual(["abcd"]);
    expect(editor.getDocument().section).toEqual({
      columns: { count: 2 },
      type: "oddPage",
      headers: { default: "rId2" },
    });
    editor.run(undo);
    expect(sectionsOf(editor)).toEqual([first]);
  });

  it("from an earlier section takes that section's own break", () => {
    const second = { columns: { count: 4 } };
    const editor = editorOf([p("a", { section: first }), p("b", { section: second }), p("c")]);
    editor.select(1);
    editor.run(removeSectionBreak);
    expect(texts(editor)).toEqual(["ab", "c"]);
    expect(sectionsOf(editor)[0]?.columns).toEqual(second.columns);
  });

  it("does nothing with one section", () => {
    expect(editorOf([p("a")]).can(removeSectionBreak)).toBe(false);
  });

  it("while tracking marks the paragraph mark deleted, as Word; accepting removes it", () => {
    const editor = editorOf([p("ab", { section: first }), p("cd")], {}, true);
    editor.select(1);
    editor.run(removeSectionBreak);
    expect(sectionsOf(editor)).toHaveLength(1);
    expect(trackedChanges(editor.state.doc).map((c) => c.kind)).toEqual(["paragraphDeletion"]);
    editor.run(acceptAllChanges());
    expect(texts(editor)).toEqual(["abcd"]);
    expect(editor.getDocument().section.headers).toEqual(first.headers);
  });

  it("deleting the mark with the keyboard's commands also passes the references on", () => {
    const editor = editorOf([p("ab", { section: first }), p("cd")], {});
    editor.select(3);
    editor.commands.joinForward();
    expect(texts(editor)).toEqual(["abcd"]);
    expect(editor.getDocument().section.headers).toEqual(first.headers);
  });
});

describe("setSectionSetup", () => {
  it("changes the caret's section, merging size and margins", () => {
    const own = { pageSize: { width: 10000, height: 14000 } };
    const editor = editorOf([p("a", { section: own }), p("b")]);
    editor.select(1);
    expect(sectionAt(editor.state)).toMatchObject({ pos: 0, index: 0, count: 2 });
    editor.run(setSectionSetup({ pageSize: { orientation: "landscape" } }));
    expect(sectionsOf(editor)[0]?.pageSize).toEqual({ ...own.pageSize, orientation: "landscape" });
    expect(editor.getDocument().section).toEqual(SETUP);
  });

  it("changes the last section through the envelope, undoable, and the page settings follow", () => {
    const editor = editorOf([p("a")]);
    const width = editor.settings.pageSize.width;
    editor.select(1);
    editor.run(setSectionSetup({ pageSize: { width: 14000 } }));
    expect(editor.getDocument().section.pageSize?.width).toBe(14000);
    expect(editor.settings.pageSize.width).toBeGreaterThan(width);
    editor.run(undo);
    expect(editor.getDocument().section).toEqual(SETUP);
    expect(editor.settings.pageSize.width).toBe(width);
    editor.run(redo);
    expect(editor.getDocument().section.pageSize?.width).toBe(14000);
  });

  it("refuses a setup with no room for text, or that changes nothing", () => {
    const editor = editorOf([p("a")]);
    editor.select(1);
    expect(editor.can(setSectionSetup({ margins: { left: 20000 } }))).toBe(false);
    expect(editor.can(setSectionSetup({ margins: { top: 9000, bottom: 9000 } }))).toBe(false);
    expect(editor.can(setSectionSetup({ columns: { count: 2, space: 500 } }))).toBe(false);
    expect(
      editor.can(
        setSectionSetup({
          columns: { count: 2, equalWidth: false, widths: [{ width: 9000 }, { width: 9000 }] },
        }),
      ),
    ).toBe(false);
  });

  it("is recorded while tracking, once; rejected it comes back, accepted it stays", () => {
    const editor = editorOf([p("a")], SETUP, true);
    editor.select(1);
    editor.run(setSectionSetup({ columns: { count: 3 } }));
    editor.run(setSectionSetup({ margins: { left: 800 } }));
    const { change } = editor.getDocument().section;
    expect(change?.author).toBe("Ann");
    expect(change?.previous.columns).toEqual(SETUP.columns);
    expect(change?.previous.margins?.left).toBe(1000);
    expect(change?.previous.headers).toBeUndefined();
    const section = wordContext(editor.state)?.envelope.section;
    expect(trackedChanges(editor.state.doc, section).map((c) => c.kind)).toEqual([
      "sectionFormatting",
    ]);
    editor.run(rejectAllChanges());
    expect(editor.getDocument().section).toEqual(SETUP);
    editor.run(setSectionSetup({ columns: { count: 3 } }));
    editor.run(acceptAllChanges());
    expect(editor.getDocument().section).toEqual({ ...SETUP, columns: { count: 3 } });
  });

  it("gives a section change a revision id above the others", () => {
    const editor = editorOf([p("a")], SETUP, true);
    editor.select(1);
    editor.commands.insertText("x");
    editor.run(setSectionSetup({ columns: { count: 3 } }));
    expect(editor.getDocument().section.change?.id).toBeGreaterThan(0);
  });
});

describe("rejecting and accepting sections together", () => {
  const START: SectionJSON = { ...SETUP, type: "oddPage" };

  it("a tracked break, then a tracked setup of the last section: Reject All restores it", () => {
    const editor = editorOf([p("Hello")], START, true);
    editor.select(3);
    editor.run(insertSectionBreak("continuous"));
    editor.run(setSectionSetup({ columns: { count: 3 } }));
    editor.run(rejectAllChanges());
    expect(texts(editor)).toEqual(["Hello"]);
    expect(editor.getDocument().section).toEqual(START);
  });

  it("a tracked setup, then a tracked break: Reject All restores the setup on both sides", () => {
    const editor = editorOf([p("Hello")], START, true);
    editor.select(3);
    editor.run(setSectionSetup({ columns: { count: 3 } }));
    editor.run(insertSectionBreak("continuous"));
    const [first] = sectionsOf(editor);
    const last = editor.getDocument().section;
    // One record each, with ids of their own.
    expect(first?.change?.previous.columns).toEqual(SETUP.columns);
    expect(last.change?.previous.columns).toEqual(SETUP.columns);
    expect(last.change?.id).not.toBe(first?.change?.id);
    editor.run(rejectAllChanges());
    expect(texts(editor)).toEqual(["Hello"]);
    expect(editor.getDocument().section).toEqual(START);
  });

  it("carries a setup change to the later part when not tracking any more", () => {
    const editor = editorOf([p("Hello")], START, true);
    editor.select(3);
    editor.run(setSectionSetup({ columns: { count: 3 } }));
    editor.run(setTrackChanges(false));
    editor.run(insertSectionBreak("continuous"));
    const last = editor.getDocument().section;
    expect(last.change?.id).toBeDefined();
    expect(last.change?.id).not.toBe(sectionsOf(editor)[0]?.change?.id);
  });

  it("a tracked removal before a table, accepted: the break goes, the next section inherits", () => {
    const cell = { type: "tableCell", content: [p("x")] };
    const table = { type: "table", content: [{ type: "tableRow", content: [cell] }] };
    const first: SectionJSON = { type: "oddPage", headers: { default: "rId2" } };
    const editor = editorOf([p("ab", { section: first }), table, p("z")], {}, true);
    editor.select(1);
    editor.run(removeSectionBreak);
    editor.run(acceptAllChanges());
    expect(sectionsOf(editor)).toEqual([]);
    expect(blocks(editor)[0]?.attrs?.revision).toBeUndefined();
    expect(editor.getDocument().section).toEqual({
      type: "oddPage",
      headers: { default: "rId2" },
    });
  });
});

describe("EnvelopeStep in history", () => {
  it("drops an undo whose section changed outside history, not half applying it", () => {
    const editor = editorOf([p("a")]);
    editor.select(1);
    editor.run(insertSectionBreak("continuous"));
    const edited = editor.getDocument();
    const outside = { columns: { count: 5 } };
    const tr = editor.state.tr.setMeta("addToHistory", false);
    setEnvelopeValue(editor.state, tr, "section", outside);
    editor.dispatch(tr);
    expect(editor.run(undo)).toBe(true);
    expect(blocks(editor)).toEqual(edited.content.content);
    expect(editor.getDocument().section).toEqual(outside);
    expect(editor.can(undo)).toBe(false);
  });
});
