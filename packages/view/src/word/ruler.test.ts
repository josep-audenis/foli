// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type NodeJSON,
  parseDocument,
  TextSelection,
} from "@folijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "../index.js";
import { PX_PER_MM } from "../layout/flow.js";
import { FRAME_ATTR } from "./table.js";

/** The ruler's geometry (31.1): `view.rulerGeometry()` in client px, at any zoom. */

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const p = (value: string, attrs?: Record<string, unknown>): NodeJSON => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [text(value)],
});

/** `createDocument`'s page: A4, margins of an inch. */
const A4 = { width: (11906 * 25.4) / 1440, left: 25.4, right: 25.4 };

let views: EditorView[] = [];
afterEach(() => {
  for (const view of views) {
    view.destroy();
    view.host.remove();
  }
  views = [];
  vi.restoreAllMocks();
});

function mount(content: NodeJSON[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const document_ = parseDocument(createDocument());
  const editor = createEditor({
    document: { ...document_, content: { type: "doc", content } as never },
  });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}

/**
 * Lays the screen out as drawn at `scale` (the zoom): the page at (100, 50), a paragraph across
 * its text area from its left margin, a table's `<table>` 300 layout px wide from there too.
 */
function screen(scale: number, settings: { width: number; left: number; right: number }) {
  const page = settings.width * PX_PER_MM * scale;
  const left = 100 + settings.left * PX_PER_MM * scale;
  const right = 100 + page - settings.right * PX_PER_MM * scale;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const box = (x: number, width: number, y = 50, height = 1000) =>
      ({ left: x, right: x + width, top: y, bottom: y + height, width, height, x, y }) as DOMRect;
    if (this.classList.contains("foli-page")) return box(100, page);
    if (this.localName === "table" && this.hasAttribute(FRAME_ATTR))
      return box(left, 300 * scale, 200, 40);
    if (this.localName === "td") return box(left, 150 * scale, 200, 40);
    if (this.localName === "p" && this.closest("td")) return box(left + 5, 140 * scale, 205, 20);
    return box(left, right - left, 60, 20);
  });
  return { left, right };
}

describe("rulerGeometry", () => {
  for (const scale of [1, 2]) {
    it(`gives the margins, indents and tab stops on the screen at ${scale * 100}%`, () => {
      const { view, editor } = mount([
        p("Indented", {
          indent: { left: 720, right: 360, hanging: 360 },
          tabs: [
            { position: 1440, kind: "center" },
            { position: 2880, kind: "end", leader: "dot" },
          ],
        }),
      ]);
      view.setOptions({ zoom: scale });
      const { left, right } = screen(scale, A4);
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      const geometry = view.rulerGeometry();
      if (!geometry) throw new Error("no geometry");
      const k = (96 / 1440) * scale;
      expect(geometry.pxPerTwip).toBeCloseTo(k, 6);
      expect(geometry.page.index).toBe(0);
      expect(geometry.page.left).toBe(100);
      expect(geometry.margins.left).toBeCloseTo(left, 6);
      expect(geometry.margins.right).toBeCloseTo(right, 6);
      expect(geometry.margins.top).toBeCloseTo(50 + 25.4 * PX_PER_MM * scale, 6);
      expect(geometry.text).toEqual({ left, right });
      const paragraph = geometry.paragraph;
      expect(paragraph?.left).toBeCloseTo(left + 720 * k, 6);
      expect(paragraph?.firstLine).toBeCloseTo(left + 360 * k, 6);
      expect(paragraph?.right).toBeCloseTo(right - 360 * k, 6);
      expect(paragraph?.tabs.map(({ x, ...tab }) => ({ ...tab, x: Math.round(x - left) }))).toEqual(
        [
          { x: Math.round(1440 * k), position: 72, alignment: "center", leader: null },
          { x: Math.round(2880 * k), position: 144, alignment: "right", leader: "dot" },
        ],
      );
      expect(geometry.table).toBeNull();
    });
  }

  it("in a table: the cell's box and the table's columns", () => {
    const cell = (value: string) => ({
      type: "tableCell",
      attrs: { width: { value: 2250, type: "dxa" } },
      content: [p(value)],
    });
    const { view, editor } = mount([
      p("Before"),
      {
        type: "table",
        attrs: { grid: [2250, 2250], layout: "fixed" },
        content: [{ type: "tableRow", content: [cell("A"), cell("B")] }],
      },
      p("After"),
    ]);
    const { left } = screen(1, A4);
    // In the first cell's paragraph.
    let inCell = 0;
    editor.state.doc.descendants((node, pos) => {
      if (!inCell && node.isTextblock && node.textContent === "A") inCell = pos + 1;
    });
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, inCell)));
    const geometry = view.rulerGeometry();
    expect(geometry?.text).toEqual({ left: left + 5, right: left + 145 });
    expect(geometry?.paragraph?.left).toBe(left + 5);
    // 300 px over 4500 twips: each column 150 px.
    expect(geometry?.table).toEqual({
      pos: 8,
      left,
      columns: [
        { right: left + 150, width: 2250 },
        { right: left + 300, width: 2250 },
      ],
    });
  });

  it("is null without pages, and on the editor's story view", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({ document: parseDocument(createDocument()) });
    const view = new EditorView(host, editor, { paged: false });
    views.push(view);
    expect(view.rulerGeometry()).toBeNull();
    const paged = mount([p("Text")]);
    screen(1, A4);
    expect(paged.editor.storyView?.rulerGeometry?.()).toEqual(paged.view.rulerGeometry());
  });
});
