import { describe, expect, it } from "vitest";
import { createDocument, type FoliDocument, type PageBordersJSON } from "../v3/document.js";
import { createEditor } from "./editor.js";
import { redo, undo } from "./history.js";
import { rejectAllChanges, trackedChanges } from "./review.js";
import {
  pageColorOf,
  setPageBorders,
  setPageColor,
  setWatermark,
  watermarkOf,
} from "./sections.js";
import { wordContext } from "./word.js";

/** Design ▸ Page Color and Page Borders (32.2). */

const p = (text: string, attrs?: Record<string, unknown>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text }],
});
const box: PageBordersJSON = {
  offsetFrom: "page",
  top: { style: "single", size: 4, space: 24, color: "auto" },
  left: { style: "single", size: 4, space: 24, color: "auto" },
  bottom: { style: "single", size: 4, space: 24, color: "auto" },
  right: { style: "single", size: 4, space: 24, color: "auto" },
};

function editorOf(trackChanges = false, settings?: FoliDocument["settings"]) {
  const base = createDocument();
  const document = {
    ...base,
    schemaVersion: 9,
    ...(settings ? { settings } : {}),
    content: { type: "doc", content: [p("one", { section: {} }), p("two")] },
  } as FoliDocument;
  return createEditor({ document, trackChanges, author: "Ann" });
}

describe("setPageColor", () => {
  it("sets and removes the document's color, one undo step each, not tracked", () => {
    const editor = editorOf(true);
    expect(pageColorOf(editor.state)).toBeNull();
    expect(editor.can(setPageColor(null))).toBe(false);
    expect(editor.can(setPageColor("red"))).toBe(false);
    expect(editor.run(setPageColor("fff2cc"))).toBe(true);
    expect(editor.getDocument().settings?.background).toEqual({ color: "FFF2CC" });
    expect(editor.getDocument().schemaVersion).toBe(9);
    expect(pageColorOf(editor.state)).toBe("FFF2CC");
    expect(editor.can(setPageColor("FFF2CC"))).toBe(false);
    expect(trackedChanges(editor.state.doc).length).toBe(0);
    editor.run(setPageColor(null));
    expect(editor.getDocument().settings?.background).toBeUndefined();
    editor.run(undo);
    expect(pageColorOf(editor.state)).toBe("FFF2CC");
    editor.run(undo);
    expect(pageColorOf(editor.state)).toBeNull();
    editor.run(redo);
    expect(pageColorOf(editor.state)).toBe("FFF2CC");
  });

  it("replaces a theme color and Fill Effects, and keeps the other settings", () => {
    const editor = editorOf(false, {
      evenAndOddHeaders: true,
      background: {
        color: "FFF2CC",
        themeColor: "accent4",
        themeTint: "33",
        ext: "<w:background/>",
      },
    });
    // The same RGB picked again drops the theme color: what the palette gives is RGB.
    expect(editor.run(setPageColor("FFF2CC"))).toBe(true);
    expect(editor.getDocument().settings).toEqual({
      evenAndOddHeaders: true,
      background: { color: "FFF2CC" },
    });
  });
});

describe("setPageBorders", () => {
  it("sets the caret's section, or every section, in one undo step", () => {
    const editor = editorOf();
    editor.select(1);
    expect(editor.run(setPageBorders(box))).toBe(true);
    const doc = () => editor.getDocument();
    expect(doc().content.content?.[0]?.attrs?.section).toEqual({ pageBorders: box });
    expect(doc().section.pageBorders).toBeUndefined();
    expect(editor.can(setPageBorders(box))).toBe(false);
    expect(editor.run(setPageBorders(box, "document"))).toBe(true);
    expect(doc().section.pageBorders).toEqual(box);
    editor.run(undo);
    expect(doc().section.pageBorders).toBeUndefined();
    expect(doc().content.content?.[0]?.attrs?.section).toEqual({ pageBorders: box });
    // None: removed.
    editor.run(setPageBorders(null, "document"));
    expect(doc().content.content?.[0]?.attrs?.section).toEqual({});
    expect(editor.can(setPageBorders(null, "document"))).toBe(false);
  });

  it("is recorded while tracking, each section under an id of its own, and rejected", () => {
    const editor = editorOf(true);
    editor.select(1);
    editor.run(setPageBorders(box, "document"));
    const first = editor.getDocument().content.content?.[0]?.attrs?.section as {
      change?: { id: number; previous: object };
    };
    const last = editor.getDocument().section;
    expect(first.change?.previous).toEqual({});
    expect(last.change?.previous).not.toHaveProperty("pageBorders");
    expect(first.change?.id).not.toBe(last.change?.id);
    const section = wordContext(editor.state)?.envelope.section;
    expect(trackedChanges(editor.state.doc, section).map((c) => c.kind)).toEqual([
      "sectionFormatting",
      "sectionFormatting",
    ]);
    editor.run(rejectAllChanges());
    expect(editor.getDocument().section.pageBorders).toBeUndefined();
    expect(editor.getDocument().content.content?.[0]?.attrs?.section).toEqual({});
  });
});

describe("setWatermark", () => {
  const confidential = {
    kind: "text" as const,
    text: "CONFIDENTIAL",
    font: "Calibri",
    color: "C0C0C0",
    semitransparent: true,
    rotation: 315,
    width: 10557,
    height: 2639,
  };
  const watermarksOf = (editor: ReturnType<typeof editorOf>) =>
    Object.entries(editor.getDocument().stories ?? {}).flatMap(([id, story]) =>
      JSON.stringify(story.content).includes('"watermark"')
        ? [
            [
              id,
              (story.content.content?.[0]?.content ?? []).filter((n) => n.attrs?.watermark).length,
            ],
          ]
        : [],
    );

  it("makes a header holding it, replaces it, and removes it, one undo step each", () => {
    const editor = editorOf();
    editor.select(1);
    expect(watermarkOf(editor.state)).toBeNull();
    expect(editor.can(setWatermark(null))).toBe(false);
    expect(editor.run(setWatermark(confidential))).toBe(true);
    const doc = editor.getDocument();
    expect(doc.schemaVersion).toBe(9);
    const first = doc.content.content?.[0]?.attrs?.section as { headers?: { default?: string } };
    const id = first.headers?.default as string;
    expect(doc.stories?.[id]?.kind).toBe("header");
    expect(watermarksOf(editor)).toEqual([[id, 1]]);
    expect(watermarkOf(editor.state)).toEqual(confidential);
    editor.select(7);
    // The second section shows the first's header (linked).
    expect(watermarkOf(editor.state)).toEqual(confidential);
    const draft = { ...confidential, text: "DRAFT", rotation: undefined };
    const { rotation: _r, ...plain } = draft;
    editor.run(setWatermark(plain));
    expect(watermarksOf(editor)).toEqual([[id, 1]]);
    expect(watermarkOf(editor.state)?.text).toBe("DRAFT");
    editor.run(setWatermark(null));
    expect(watermarksOf(editor)).toEqual([]);
    editor.run(undo);
    expect(watermarkOf(editor.state)?.text).toBe("DRAFT");
    editor.run(undo);
    editor.run(undo);
    expect(editor.getDocument().stories ?? {}).toEqual({});
  });

  it("puts it in a first page's header too, and refuses a watermark the schema does not take", () => {
    const editor = editorOf();
    editor.select(7);
    expect(editor.can(setWatermark({ ...confidential, width: 0 }))).toBe(false);
    const document = editor.getDocument();
    const withFirst = createEditor({
      document: { ...document, section: { ...document.section, titlePage: true } },
    });
    withFirst.run(setWatermark(confidential));
    const refs = (
      withFirst.getDocument().content.content?.[0]?.attrs?.section as {
        headers?: Record<string, string>;
      }
    ).headers;
    const last = withFirst.getDocument().section.headers;
    // The first section has no first page: its default header; the last one's first page gets one.
    expect(Object.keys(refs ?? {})).toEqual(["default"]);
    expect(Object.keys(last ?? {})).toEqual(["first"]);
  });
});
