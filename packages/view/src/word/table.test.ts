// @vitest-environment jsdom
import {
  CellSelection,
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
import { EditorView, FOLI_MIME } from "../index.js";
import type { BlockDesc } from "../render.js";
import { breaksOf, cutTable, type Lines, type Measure } from "../view.js";
import type { WordBlockDesc } from "./edit.js";
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

describe("cutting a table across pages", () => {
  // A header row; a row whose first cell has two lines and second one; a last row.
  const SPLIT: NodeJSON = {
    type: "table",
    attrs: { grid: [2000, 2000] },
    content: [
      row([cell("H1"), cell("H2")], { header: true }),
      row([cell("long text"), cell("short")]),
      row([cell("x"), cell("")]),
    ],
  };
  const setup = () => {
    const editor = createEditor({
      document: parseDocument(createDocument({ type: "doc", content: [SPLIT, p()] })),
    });
    const word = wordContext(editor.state) as WordContext;
    const { items, units } = collect(editor.state.doc, word.resolver);
    const frame = items[0]?.frame;
    if (!frame) throw new Error("no table");
    // Units: H1 0, H2 1, long text 2, short 3, x 4, empty 5. Fake blocks: lines by index.
    const blocks = units.map((_, u) => ({ u }) as unknown as WordBlockDesc);
    const LINES: Record<number, Lines> = {
      0: { starts: [0], bottoms: [20] },
      1: { starts: [0], bottoms: [20] },
      2: { starts: [0, 5], bottoms: [20, 40] },
      3: { starts: [0], bottoms: [20] },
      4: { starts: [0], bottoms: [20] },
      // An empty paragraph measured with no line.
      5: { starts: [], bottoms: [] },
    };
    const lines = (desc: BlockDesc) => LINES[(desc as unknown as { u: number }).u] as Lines;
    const measure: Measure = {
      height: 100,
      marginTop: 0,
      marginBottom: 0,
      box: 0,
      table: {
        rows: [
          { top: 0, bottom: 20 },
          { top: 20, bottom: 60 },
          { top: 60, bottom: 80 },
        ],
        tops: new Map([
          [0, 0],
          [1, 0],
          [2, 20],
          [3, 20],
          [4, 60],
          [5, 60],
        ]),
      },
    };
    return { frame, blocks, lines, measure };
  };

  it("breaks after rows and at the line ends inside a row that may split", () => {
    const { frame, blocks, lines, measure } = setup();
    // 40: the end of the first cell's first line and the second cell's only one; the table's
    // last break is its height.
    expect(breaksOf(frame, measure, blocks, 500, lines)).toEqual([20, 40, 60, 100]);
  });

  it("splits a row's cells at their own lines and repeats the header on the next page", () => {
    const { frame, blocks, lines, measure } = setup();
    breaksOf(frame, measure, blocks, 500, lines);
    const cut = cutTable(
      frame,
      measure,
      [
        { fromLine: 0, toLine: 2 },
        { fromLine: 2, toLine: Number.POSITIVE_INFINITY },
      ],
      blocks,
      lines,
    );
    expect(cut.parts).toEqual([
      { rows: [0, 1], headers: [] },
      { rows: [1, 2], headers: [0] },
    ]);
    // "long text": its first line here, its second on the next page, split after it.
    expect(cut.partOf.get(2)).toEqual([0, 1]);
    expect(cut.splits.get(2)).toEqual([5]);
    // "short" fits whole on the first page; the empty paragraph goes with its row.
    expect(cut.partOf.get(3)).toEqual([0]);
    expect(cut.splits.has(3)).toBe(false);
    expect(cut.partOf.get(5)).toEqual([1]);
  });

  it("does not split a row that may not split", () => {
    const { frame, blocks, lines, measure } = setup();
    const kept = {
      ...frame,
      rows: frame.rows.map((r, i) => (i === 1 ? { ...r, cantSplit: true } : r)),
    };
    expect(breaksOf(kept, measure, blocks, 500, lines)).toEqual([20, 60, 100]);
    // Unless it is taller than a page.
    const { breaks: _, ...table } = measure.table as NonNullable<Measure["table"]>;
    expect(breaksOf(kept, { ...measure, table }, blocks, 30, lines)).toEqual([20, 40, 60, 100]);
  });
});

describe("a composition in a cell, with a paragraph inserted before it", () => {
  it("loses no text when the blocks after the insertion move along", () => {
    const { host, editor, view } = mount();
    view.focus();
    const apples = startOf(editor, "Apples");
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, apples + 6)),
    );
    const composed = view.domFromPos(apples + 6).node as Text;
    host.dispatchEvent(new CompositionEvent("compositionstart"));
    // A paragraph inserted at the start of the "Fruit" cell (before every later block).
    const fruit = startOf(editor, "Fruit");
    const schema = editor.state.schema;
    const added = schema.nodes.paragraph?.create(null, schema.text("New")) as never;
    editor.dispatch(editor.state.tr.insert(fruit - 1, added));
    composed.data = "Applesé";
    document.getSelection()?.collapse(composed, 7);
    host.dispatchEvent(new CompositionEvent("compositionend"));
    for (const value of ["New", "Fruit", "Applesé", "10", "Pears", "Before", "After"])
      expect(startOf(editor, value), value).toBeGreaterThan(0);
  });
});

describe("a composition in a cell", () => {
  it("keeps the cell's element in place when another cell changes, and loses no text", () => {
    const { host, editor, view } = mount();
    view.focus();
    const apples = startOf(editor, "Apples");
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, apples + 6)),
    );
    const before = view.domFromPos(apples + 6).node as Text;
    const td = before.parentElement?.closest("td");
    host.dispatchEvent(new CompositionEvent("compositionstart"));
    // Another cell changes while the IME composes (a programmatic edit).
    const pears = startOf(editor, "Pears");
    editor.dispatch(editor.state.tr.insertText("!", pears + 5));
    expect(before.isConnected).toBe(true);
    expect(before.parentElement?.closest("td")).toBe(td);
    // The composed text, then the end of the composition.
    before.data = "Applesé";
    document.getSelection()?.collapse(before, 7);
    host.dispatchEvent(new CompositionEvent("compositionend"));
    expect(startOf(editor, "Applesé")).toBeGreaterThan(0);
    expect(startOf(editor, "Pears!")).toBeGreaterThan(0);
    expect(startOf(editor, "Fruit")).toBeGreaterThan(0);
  });
});

describe("copying and pasting cells", () => {
  const PLAIN: NodeJSON = {
    type: "table",
    attrs: { grid: [2000, 2000] },
    content: [row([cell("a1"), cell("b1")]), row([cell("a2"), cell("b2")])],
  };
  /** Copies the cells from the one holding `from` to the one holding `to`. */
  function copyCells(from: string, to: string) {
    const { host, editor } = mount([p("Before"), PLAIN, p("After")]);
    const cellBefore = (value: string) => startOf(editor, value) - 2;
    editor.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, cellBefore(from), cellBefore(to)),
      ),
    );
    const store = new Map<string, string>();
    const event = new Event("copy", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { setData: (k: string, v: string) => store.set(k, v), getData: () => "" },
    });
    host.dispatchEvent(event);
    return { getData: (type: string) => store.get(type) ?? "" };
  }
  const tables = (editor: ReturnType<typeof createEditor>) => {
    const out: string[][][] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "table") return true;
      const rows: string[][] = [];
      node.forEach((r) => {
        const cells: string[] = [];
        r.forEach((c) => {
          cells.push(c.textContent);
        });
        rows.push(cells);
      });
      out.push(rows);
      return false;
    });
    return out;
  };

  it("copies selected cells as a table: text with tabs, HTML and Foli JSON", () => {
    const data = copyCells("a1", "b2");
    expect(data.getData("text/plain")).toBe("a1\tb1\na2\tb2");
    const html = document.createElement("div");
    html.innerHTML = data.getData("text/html");
    expect(html.querySelectorAll("td")).toHaveLength(4);
    const json = JSON.parse(data.getData(FOLI_MIME));
    expect(json.open).toBe(false);
    expect(json.content.content[0].type).toBe("table");
  });

  it("pastes copied cells into a cell of another table, filling from there", () => {
    const data = copyCells("a1", "a2");
    const { editor, view } = mount([p("x"), PLAIN, p("y")]);
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, startOf(editor, "b1"))),
    );
    expect(view.paste(data)).toBe(true);
    expect(tables(editor)).toEqual([
      [
        ["a1", "a1"],
        ["a2", "a2"],
      ],
    ]);
  });

  it("pastes copied cells into text as a table, splitting the paragraph", () => {
    const data = copyCells("b1", "b2");
    const { editor, view } = mount([p("before after"), p("end")]);
    editor.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, startOf(editor, "before after") + 6),
      ),
    );
    expect(view.paste(data)).toBe(true);
    const blocks: string[] = [];
    editor.state.doc.forEach((node) => {
      blocks.push(node.type.name === "table" ? "table" : node.textContent);
    });
    expect(blocks).toEqual(["before", "table", " after", "end"]);
    expect(tables(editor)).toEqual([[["b1"], ["b2"]]]);
  });

  it("puts a paragraph after cells pasted into the document's last, empty paragraph", () => {
    const data = copyCells("a1", "a1");
    const { editor, view } = mount([p("x"), p()]);
    editor.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, startOf(editor, "x") + 3),
      ),
    );
    expect(view.paste(data)).toBe(true);
    const names: string[] = [];
    editor.state.doc.forEach((node) => {
      names.push(node.type.name);
    });
    expect(names).toEqual(["paragraph", "table", "paragraph"]);
    expect(() => parseDocument(editor.getDocument())).not.toThrow();
  });
});
