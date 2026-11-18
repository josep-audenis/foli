import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { FoliDocument, SectionJSON, WordSettingsJSON } from "../v3/document.js";
import { createDocument, SCHEMA_VERSION } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { redo, undo } from "./history.js";
import {
  convertNotes,
  insertNote,
  noteAtSelection,
  noteNumbers,
  noteTextStart,
  setNoteProperties,
} from "./notes.js";
import { acceptAllChanges, acceptChange, rejectAllChanges, rejectChange } from "./review.js";
import { Selection, type TextSelection } from "./selection.js";
import { setTrackChanges } from "./track.js";
import { StoryStep, wordContext } from "./word.js";
import { copiedDefinitions, fitPaste } from "./wordclip.js";

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const ref = (story: string, attrs: Record<string, unknown> = {}): NodeJSON => ({
  type: "noteReference",
  attrs: { story, ...attrs },
});
const p = (...content: NodeJSON[]): NodeJSON => ({ type: "paragraph", content });
const docOf = (...content: NodeJSON[]): NodeJSON => ({ type: "doc", content });
const note = (kind: "footnote" | "endnote", value: string) => ({
  kind,
  content: docOf(p({ type: "noteMark" }, text(` ${value}`))),
});

function documentOf(
  content: NodeJSON[],
  stories: FoliDocument["stories"] = {},
  settings?: WordSettingsJSON,
  section: SectionJSON = {},
): FoliDocument {
  return {
    ...createDocument(),
    schemaVersion: SCHEMA_VERSION,
    section,
    content: docOf(...content),
    stories,
    ...(settings ? { settings } : {}),
  };
}

const numbers = (editor: Editor, options = {}) =>
  noteNumbers(editor.state.doc, editor.getDocument(), options).map((n) => n.text);
const stories = (editor: Editor) => Object.keys(editor.getDocument().stories ?? {});
const refsOf = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "noteReference") out.push(String(node.attrs.story));
    return true;
  });
  return out;
};

describe("note numbers", () => {
  const two = [p(text("a"), ref("footnote:1")), p(text("b"), ref("footnote:2"), ref("endnote:1"))];
  const notes = {
    "footnote:1": note("footnote", "x"),
    "footnote:2": note("footnote", "y"),
    "endnote:1": note("endnote", "z"),
  };

  it("counts in document order, in Word's default formats", () => {
    const editor = createEditor({ document: documentOf(two, notes) });
    expect(numbers(editor)).toEqual(["1", "2", "i"]);
  });

  it("takes format and start from the settings, a section's own first", () => {
    const settings = { footnotes: { format: "upperLetter", start: 3 } };
    const editor = createEditor({ document: documentOf(two, notes, settings) });
    expect(numbers(editor)).toEqual(["C", "D", "i"]);
    const own = createEditor({
      document: documentOf(two, notes, settings, { footnotes: { format: "chicago", start: 1 } }),
    });
    expect(numbers(own)).toEqual(["*", "†", "i"]);
  });

  it("restarts on each section and on each page", () => {
    const sectioned = [
      {
        type: "paragraph",
        attrs: { section: { footnotes: { restart: "eachSect" } } },
        content: [ref("footnote:1"), ref("footnote:2")],
      },
      p(ref("footnote:3")),
    ];
    const editor = createEditor({
      document: documentOf(
        sectioned,
        {
          "footnote:1": note("footnote", "x"),
          "footnote:2": note("footnote", "y"),
          "footnote:3": note("footnote", "z"),
        },
        undefined,
        { footnotes: { restart: "eachSect" } },
      ),
    });
    expect(numbers(editor)).toEqual(["1", "2", "1"]);
    const paged = createEditor({
      document: documentOf(two, notes, { footnotes: { restart: "eachPage" } }),
    });
    // Before the pages are known they run on.
    expect(numbers(paged)).toEqual(["1", "2", "i"]);
    const each = (pos: number) => (pos < 4 ? 0 : 1);
    expect(numbers(paged, { pageOf: each })).toEqual(["1", "1", "i"]);
  });

  it("gives a custom mark no number and skips what a view hides", () => {
    const content = [
      p(ref("footnote:1", { customMark: true }), text("*")),
      p({
        type: "noteReference",
        attrs: { story: "footnote:2" },
        marks: [{ type: "deletion", attrs: { id: 1, author: "A" } }],
      }),
      p(ref("footnote:3")),
    ];
    const editor = createEditor({
      document: documentOf(content, {
        "footnote:1": note("footnote", "x"),
        "footnote:2": note("footnote", "y"),
        "footnote:3": note("footnote", "z"),
      }),
    });
    expect(numbers(editor)).toEqual(["", "1", "2"]);
    expect(numbers(editor, { hideDeleted: true })).toEqual(["", "", "1"]);
  });
});

describe("inserting a note", () => {
  const empty = () => createEditor({ document: documentOf([p(text("hello"))]) });

  it("adds the reference, the story and Word's styles in one undo step", () => {
    const editor = empty();
    editor.select(6);
    expect(editor.run(insertNote("footnote"))).toBe(true);
    expect(refsOf(editor)).toEqual(["footnote:1"]);
    const document = editor.getDocument();
    const story = document.stories?.["footnote:1"];
    expect(story?.content.content?.[0]).toMatchObject({
      attrs: { style: "FootnoteText" },
      content: [
        {
          type: "noteMark",
          marks: [{ type: "characterStyle", attrs: { id: "FootnoteReference" } }],
        },
        { type: "text", text: " " },
      ],
    });
    expect(document.styles.map((s) => s.id)).toEqual(
      expect.arrayContaining(["FootnoteText", "FootnoteReference", "FootnoteTextChar"]),
    );
    expect(editor.state.selection.from).toBe(7);
    expect(noteAtSelection(editor.state)?.story).toBe("footnote:1");
    editor.run(undo);
    expect(refsOf(editor)).toEqual([]);
    expect(stories(editor)).toEqual([]);
    editor.run(redo);
    expect(refsOf(editor)).toEqual(["footnote:1"]);
    expect(stories(editor)).toEqual(["footnote:1"]);
  });

  it("numbers ids on from the document's, keeps a custom mark, refuses a story", () => {
    const editor = createEditor({
      document: documentOf([p(text("a"), ref("endnote:7"))], { "endnote:7": note("endnote", "x") }),
    });
    editor.select(2);
    editor.run(insertNote("endnote", { customMark: "#" }));
    expect(refsOf(editor)).toEqual(["endnote:8", "endnote:7"]);
    expect(editor.state.doc.textContent).toContain("#");
    expect(editor.getDocument().stories?.["endnote:8"]?.content.content?.[0]?.content?.[0]).toEqual(
      expect.objectContaining({ type: "text", text: "#" }),
    );
    expect((editor.story("endnote:8") as Editor).run(insertNote())).toBe(false);
  });

  it("puts a note's caret after its mark and space", () => {
    const editor = empty();
    editor.run(insertNote());
    const inner = editor.story("footnote:1") as Editor;
    expect(noteTextStart(inner.state.doc)).toBe(3);
  });

  it("makes the styles' size and raise those Word has", () => {
    const editor = empty();
    editor.run(insertNote());
    const { resolver } = wordContext(editor.state) as NonNullable<ReturnType<typeof wordContext>>;
    const { run } = resolver.paragraph({ style: "FootnoteText" });
    expect(run.size).toBe(20);
    expect(
      resolver.run(run, [{ type: "characterStyle", attrs: { id: "FootnoteReference" } }]),
    ).toMatchObject({ verticalAlign: "superscript" });
  });
});

describe("a note goes with its reference", () => {
  const withNote = () =>
    createEditor({
      document: documentOf([p(text("ab"), ref("footnote:1"), text("cd"))], {
        "footnote:1": note("footnote", "held"),
        "footnote:-1": { ...note("footnote", ""), noteType: "separator" },
        "footnote:9": note("footnote", "nobody refers to me"),
      }),
    });

  it("deleting the reference deletes the story, undo restores both", () => {
    const editor = withNote();
    editor.dispatch(editor.state.tr.delete(3, 4));
    expect(refsOf(editor)).toEqual([]);
    expect(stories(editor)).toEqual(["footnote:-1", "footnote:9"]);
    editor.run(undo);
    expect(refsOf(editor)).toEqual(["footnote:1"]);
    expect(stories(editor)).toContain("footnote:1");
    editor.run(redo);
    expect(stories(editor)).not.toContain("footnote:1");
  });

  it("leaves the note of a reference only moved", () => {
    const editor = withNote();
    const node = editor.state.doc.nodeAt(3);
    if (!node) throw new Error("no reference");
    editor.dispatch(editor.state.tr.delete(3, 4).insert(1, node));
    expect(refsOf(editor)).toEqual(["footnote:1"]);
    expect(stories(editor)).toContain("footnote:1");
  });
});

describe("tracked notes", () => {
  const tracking = (document: FoliDocument) =>
    createEditor({ document, trackChanges: true, author: "Ann" });
  const contentOf = (editor: Editor, id: string) =>
    JSON.stringify(editor.getDocument().stories?.[id]?.content);

  it("records an inserted note as Word does, and rejecting removes it", () => {
    const editor = tracking(documentOf([p(text("ab"))]));
    editor.select(3);
    editor.run(insertNote());
    const reference = editor.state.doc.nodeAt(3);
    expect(reference?.marks.map((m) => m.type.name)).toContain("insertion");
    const content = editor.getDocument().stories?.["footnote:1"]?.content.content?.[0];
    for (const inline of content?.content ?? [])
      expect(inline.marks?.map((m) => m.type)).toContain("insertion");
    // The paragraph mark is not recorded.
    expect(content?.attrs?.revision ?? null).toBeNull();
    expect(editor.run(rejectAllChanges())).toBe(true);
    expect(refsOf(editor)).toEqual([]);
    expect(stories(editor)).toEqual([]);
    editor.run(undo);
    expect(stories(editor)).toEqual(["footnote:1"]);
  });

  it("accepting the reference accepts the note", () => {
    const editor = tracking(documentOf([p(text("ab"))]));
    editor.select(3);
    editor.run(insertNote());
    editor.select(3);
    expect(editor.run(acceptChange)).toBe(true);
    expect(editor.state.doc.nodeAt(3)?.marks.some((m) => m.type.name === "insertion")).toBe(false);
    expect(contentOf(editor, "footnote:1")).not.toContain("insertion");
  });

  const existing = () =>
    tracking(
      documentOf([p(text("ab"), ref("footnote:1"), text("c"))], {
        "footnote:1": note("footnote", "held"),
      }),
    );

  it("keeps a note whose reference is deleted, all of it recorded", () => {
    const editor = existing();
    editor.dispatch(editor.state.tr.delete(3, 4));
    expect(refsOf(editor)).toEqual(["footnote:1"]);
    expect(editor.state.doc.nodeAt(3)?.marks.map((m) => m.type.name)).toContain("deletion");
    const content = editor.getDocument().stories?.["footnote:1"]?.content.content?.[0];
    expect(content?.attrs?.revision).toMatchObject({ deletion: { author: "Ann" } });
    for (const inline of content?.content ?? [])
      expect(inline.marks?.map((m) => m.type)).toContain("deletion");
    editor.run(undo);
    expect(contentOf(editor, "footnote:1")).not.toContain("deletion");
  });

  it("accepting the deletion removes the note, rejecting restores it", () => {
    const accepted = existing();
    accepted.dispatch(accepted.state.tr.delete(3, 4));
    accepted.select(4);
    expect(accepted.run(acceptChange)).toBe(true);
    expect(refsOf(accepted)).toEqual([]);
    expect(stories(accepted)).toEqual([]);
    const rejected = existing();
    rejected.dispatch(rejected.state.tr.delete(3, 4));
    rejected.select(4);
    expect(rejected.run(rejectChange)).toBe(true);
    expect(refsOf(rejected)).toEqual(["footnote:1"]);
    expect(contentOf(rejected, "footnote:1")).not.toContain("deletion");
    const all = existing();
    all.dispatch(all.state.tr.delete(3, 4));
    expect(all.run(acceptAllChanges())).toBe(true);
    expect(stories(all)).toEqual([]);
  });

  it("deleting one's own inserted reference removes it for real", () => {
    const editor = tracking(documentOf([p(text("ab"))]));
    editor.select(3);
    editor.run(insertNote());
    editor.dispatch(editor.state.tr.delete(3, 4));
    expect(refsOf(editor)).toEqual([]);
    expect(stories(editor)).toEqual([]);
  });

  it("records edits inside a note", () => {
    const editor = existing();
    const inner = editor.story("footnote:1") as Editor;
    inner.select(3);
    inner.commands.insertText("Z");
    expect(contentOf(editor, "footnote:1")).toContain("insertion");
    editor.run(setTrackChanges(false));
    expect(editor.run(rejectAllChanges())).toBe(true);
    expect(contentOf(editor, "footnote:1")).not.toContain("Z");
  });
});

describe("notes on the clipboard", () => {
  const source = () =>
    createEditor({
      document: documentOf([p(text("ab"), ref("footnote:4")), p(text("cd"))], {
        "footnote:4": note("footnote", "carried"),
      }),
    });

  const copy = (editor: Editor) => {
    const context = wordContext(editor.state) as NonNullable<ReturnType<typeof wordContext>>;
    const slice = editor.state.doc.cut(0, 5);
    return { content: slice.toJSON(), word: copiedDefinitions(context, slice) };
  };

  it("carries the note and pastes a new one", () => {
    const editor = source();
    const { content, word } = copy(editor);
    expect(Object.keys(word.notes ?? {})).toEqual(["footnote:4"]);
    editor.dispatch(
      editor.state.tr.setSelection(Selection.atEnd(editor.state.doc) as TextSelection),
    );
    const fitted = fitPaste(editor.state, JSON.parse(JSON.stringify(content)), word);
    expect(fitted.notes?.map((n) => n.id)).toEqual(["footnote:5"]);
    expect(JSON.stringify(fitted.doc.toJSON())).toContain('"footnote:5"');
    expect(fitted.notes?.[0]?.story.doc.textContent).toBe(" carried");
    const tr = editor.state.tr.insert(editor.state.doc.content.size, fitted.doc.content);
    for (const { id, story } of fitted.notes ?? []) tr.step(new StoryStep(id, null, story));
    editor.dispatch(tr);
    expect(refsOf(editor)).toEqual(["footnote:4", "footnote:5"]);
    expect(stories(editor)).toEqual(["footnote:4", "footnote:5"]);
  });

  it("keeps the note of what was cut", () => {
    const editor = source();
    const { content, word } = copy(editor);
    editor.dispatch(editor.state.tr.delete(0, 5));
    expect(stories(editor)).toEqual([]);
    const fitted = fitPaste(editor.state, content, word);
    expect(fitted.notes?.[0]?.story.doc.textContent).toBe(" carried");
  });

  it("brings a note to another document, not into a story", () => {
    const from = source();
    const { content, word } = copy(from);
    const other = createEditor({ document: documentOf([p(text("x"))]) });
    const fitted = fitPaste(other.state, content, word);
    expect(fitted.notes?.map((n) => n.id)).toEqual(["footnote:1"]);
    const withStory = createEditor({
      document: documentOf([p(ref("footnote:1"))], { "footnote:1": note("footnote", "n") }),
    });
    const inner = withStory.story("footnote:1") as Editor;
    const pasted = fitPaste(inner.state, content, word);
    expect(pasted.notes).toBeUndefined();
    expect(JSON.stringify(pasted.doc.toJSON())).not.toContain("noteReference");
  });
});

describe("note options and conversion", () => {
  const sectioned = () =>
    createEditor({
      document: documentOf(
        [
          { type: "paragraph", attrs: { section: {} }, content: [ref("footnote:1")] },
          p(ref("footnote:2")),
        ],
        { "footnote:1": note("footnote", "x"), "footnote:2": note("footnote", "y") },
      ),
    });

  it("writes the settings and every section, undone as one step", () => {
    const editor = sectioned();
    editor.run(setNoteProperties("footnote", { format: "lowerLetter", position: "beneathText" }));
    const document = editor.getDocument();
    expect(document.settings?.footnotes).toEqual({
      format: "lowerLetter",
      position: "beneathText",
    });
    expect(document.section.footnotes).toEqual({ format: "lowerLetter", position: "beneathText" });
    expect(document.content.content?.[0]?.attrs?.section).toMatchObject({
      footnotes: { format: "lowerLetter" },
    });
    expect(numbers(editor)).toEqual(["a", "b"]);
    editor.run(undo);
    expect(numbers(editor)).toEqual(["1", "2"]);
  });

  it("starts restarting numbers at 1, leaves defaults out, keeps endnote places in settings", () => {
    const editor = sectioned();
    editor.run(setNoteProperties("footnote", { start: 5 }));
    expect(numbers(editor)).toEqual(["5", "6"]);
    editor.run(setNoteProperties("footnote", { restart: "eachSect" }));
    expect(numbers(editor)).toEqual(["1", "1"]);
    expect(editor.getDocument().settings?.footnotes).toEqual({ restart: "eachSect" });
    editor.run(setNoteProperties("endnote", { position: "sectEnd" }));
    expect(editor.getDocument().settings?.endnotes).toEqual({ position: "sectEnd" });
    expect(editor.getDocument().section.endnotes).toBeUndefined();
  });

  it("converts notes, with their styles, as one step", () => {
    const editor = createEditor({ document: documentOf([p(text("ab"))]) });
    editor.select(3);
    editor.run(insertNote());
    expect(editor.run(convertNotes("endnote"))).toBe(true);
    expect(refsOf(editor)).toEqual(["endnote:1"]);
    const document = editor.getDocument();
    expect(Object.keys(document.stories ?? {})).toEqual(["endnote:1"]);
    expect(document.stories?.["endnote:1"]).toMatchObject({
      kind: "endnote",
      content: {
        content: [
          {
            attrs: { style: "EndnoteText" },
            content: [
              { type: "noteMark", marks: [{ attrs: { id: "EndnoteReference" } }] },
              { type: "text" },
            ],
          },
        ],
      },
    });
    expect(numbers(editor)).toEqual(["i"]);
    editor.run(undo);
    expect(refsOf(editor)).toEqual(["footnote:1"]);
    expect(editor.run(convertNotes("footnote"))).toBe(false);
  });
});
