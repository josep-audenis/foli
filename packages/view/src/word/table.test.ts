// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type NodeJSON,
  NodeSelection,
  parseDocument,
  TextSelection,
  type WordContext,
  wordContext,
} from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "../index.js";
import { collect, FRAME_ATTR, frameElement, REPEATED_ATTR } from "./table.js";

/** Tables in the editable view (10.5): cell paragraphs are blocks with positions of their own. */

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const p = (value = ""): NodeJSON => ({
  type: "paragraph",
  ...(value ? { content: [text(value)] } : {}),
});
const cell = (value: string, attrs?: Record<string, unknown>): NodeJSON => ({
  type: "tableCell",
  ...(attrs ? { attrs } : {}),
  content: [p(value)],
});
const row = (cells: NodeJSON[], attrs?: Record<string, unknown>): NodeJSON => ({
  type: "tableRow",
  ...(attrs ? { attrs } : {}),
  content: cells,
});

/** A header row, a category merged down over two rows, a row spanning two columns. */
const TABLE: NodeJSON = {
  type: "table",
  attrs: { grid: [2000, 3000, 1000] },
  content: [
    row([cell("Category"), cell("Item"), cell("Price")], { header: true }),
    row([cell("Fruit", { vMerge: "restart" }), cell("Apples"), cell("10")]),
    row([cell("", { vMerge: "continue" }), cell("Pears"), cell("20")]),
    row([cell("Total", { gridSpan: 2 }), cell("30")]),
  ],
};

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(content: NodeJSON[] = [p("Before"), TABLE, p("After")]) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({
    document: parseDocument(createDocument({ type: "doc", content })),
  });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}

/** The model position at the start of the paragraph whose text is `value`. */
function startOf(editor: ReturnType<typeof createEditor>, value: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === value) at = pos + 1;
  });
  return at;
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe("a table in the editable view", () => {
  it("is drawn from the model: rows, cells, spans and merges", () => {
    const { host } = mount();
    const wrapper = host.querySelector(`[${FRAME_ATTR}="table"]`) as HTMLElement;
    const rows = [...wrapper.querySelectorAll(":scope > table > tbody > tr")];
    expect(rows.length).toBe(4);
    expect(rows[0]?.hasAttribute("data-foli-header")).toBe(true);
    const [fruit] = [...(rows[1]?.children ?? [])] as HTMLTableCellElement[];
    expect(fruit?.rowSpan).toBe(2);
    // The covered cell's paragraph stays in the DOM, in document order, not laid out.
    const covered = rows[2]?.querySelector(`[${FRAME_ATTR}="covered"]`) as HTMLElement;
    expect(covered.style.display).toBe("none");
    expect(rows[3]?.children[0]).toHaveProperty("colSpan", 2);
    expect(wrapper.querySelectorAll("col").length).toBe(3);
  });

  it("maps positions in cells both ways", () => {
    const { editor, view } = mount();
    for (const value of ["Category", "Apples", "30", "After"]) {
      const pos = startOf(editor, value) + 1;
      const point = view.domFromPos(pos);
      expect(point.node.textContent, value).toBe(value);
      expect(view.posFromDOM(point.node, point.offset)).toBe(pos);
    }
    // A point in a cell element (not in a paragraph): before the first block after it, as
    // between top-level blocks (a selection there snaps into the paragraph).
    const td = view.domFromPos(startOf(editor, "Pears")).node.parentElement?.closest("td");
    expect(view.posFromDOM(td as Node, 0)).toBe(startOf(editor, "Pears") - 1);
  });

  it("reads back what the browser typed in a cell", async () => {
    const { editor, view } = mount();
    const point = view.domFromPos(startOf(editor, "Pears") + 5);
    (point.node as Text).data = "Pearsx";
    await settle();
    expect(startOf(editor, "Pearsx")).toBeGreaterThan(0);
    expect(startOf(editor, "Apples")).toBeGreaterThan(0);
    expect(() => parseDocument(editor.getDocument())).not.toThrow();
  });

  it("types into a cell through the model", () => {
    const { editor } = mount();
    const at = startOf(editor, "Apples") + 6;
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
    editor.commands.insertText(" and plums");
    expect(startOf(editor, "Apples and plums")).toBeGreaterThan(0);
  });

  it("shows a table selected whole around its wrapper, and reads it back so", () => {
    const { host, editor } = mount();
    host.focus();
    const tablePos = editor.state.doc.child(0).nodeSize;
    editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tablePos)));
    const wrapper = host.querySelector(`[${FRAME_ATTR}="table"]`) as HTMLElement;
    expect(wrapper.classList.contains("foli-selected-node")).toBe(true);
    const sel = document.getSelection();
    expect(sel?.anchorNode).toBe(wrapper.parentNode);
    document.dispatchEvent(new Event("selectionchange"));
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });
});

describe("a table's fragment on a later page", () => {
  const context = () => {
    const editor = createEditor({
      document: parseDocument(createDocument({ type: "doc", content: [TABLE, p()] })),
    });
    return { editor, context: wordContext(editor.state) as WordContext };
  };

  it("draws the header rows again, not editable, and a merge continued from the page before", () => {
    const { editor, context: word } = context();
    const { items } = collect(editor.state.doc, word.resolver);
    const frame = items[0]?.frame;
    if (!frame) throw new Error("no table");
    expect(frame.headers).toBe(1);
    // Rows 2 and 3 on this page: the merge started on row 1, on the page before.
    const wrapper = frameElement(frame, [2, 3], [0], () => [], document);
    const rows = [...wrapper.querySelectorAll("tr")];
    expect(rows[0]?.getAttribute(REPEATED_ATTR)).toBe("");
    expect(rows[0]?.getAttribute("contenteditable")).toBe("false");
    expect(rows[0]?.textContent).toBe("CategoryItemPrice");
    // The continued merge gets a cell of its own here (3 cells, none hidden).
    expect(
      [...(rows[1]?.children ?? [])].filter((td) => (td as HTMLElement).style.display !== "none")
        .length,
    ).toBe(3);
    expect(rows[2]?.children.length ?? 0).toBe(2);
  });
});
