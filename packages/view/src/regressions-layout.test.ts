// @vitest-environment jsdom
import { createEditor, type FoliDocument, type MarkJSON, type NodeJSON } from "@folijs/core";
import { type WordContext, wordContext } from "@folijs/core/internal";
import { describe, expect, it } from "vitest";
import { type BlockBox, type FlowSection, flow } from "./layout/flow.js";
import { renderBlocks, WORD_PAGE_BREAK_ATTR } from "./word/blocks.js";
import { WordRenderer } from "./word/edit.js";

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});

function documentOf(...blocks: NodeJSON[]): FoliDocument {
  return {
    schemaVersion: 5,
    section: {},
    defaults: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: {
      abstracts: [{ id: 0, levels: [{ level: 0, start: 1, format: "decimal", text: "%1." }] }],
      instances: [{ id: 1, abstract: 0 }],
    },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}

const lined = (count: number, lineHeight: number, over: Partial<BlockBox> = {}): BlockBox => ({
  height: count * lineHeight,
  marginTop: 0,
  marginBottom: 0,
  lines: () => Array.from({ length: count }, (_, i) => (i + 1) * lineHeight),
  ...over,
});

const section = (over: Partial<FlowSection> = {}): FlowSection => ({
  start: "nextPage",
  columns: 1,
  box: () => ({ height: 100 }),
  samePage: () => true,
  ...over,
});

describe("flow: a section's mark and a break", () => {
  it("starts a page for a paragraph with page break before after a continuous section break", () => {
    const a = section({ index: 0 });
    const b = section({ index: 1, start: "continuous" });
    const boxes = [
      lined(1, 10, { section: a }),
      // The empty paragraph holding the section's break; the next paragraph has page break
      // before, which both renderers report as a break after this block's last line.
      lined(1, 10, { section: a, sectionMark: true, breaksAfter: () => [0] }),
      lined(1, 10, { section: b }),
    ];
    const result = flow(boxes, 100);
    expect(result[2]?.[0]?.page).toBe(1);
  });
});

describe("tracked changes in the final view", () => {
  const deleted: MarkJSON = { type: "deletion", attrs: { id: 1, author: "A", date: null } };

  it("edit view: a deleted page break does not break the page", () => {
    const editor = createEditor({
      document: documentOf(p({}, text("a"), { type: "pageBreak", marks: [deleted] }, text("b"))),
    });
    // The mark must have survived parsing for the test to mean anything.
    expect(
      editor.state.doc
        .child(0)
        .child(1)
        .marks.map((m) => m.type.name),
    ).toEqual(["deletion"]);
    const context = wordContext(editor.state) as WordContext;
    const renderer = new WordRenderer(context, document, () => 1.2, false, "final");
    renderer.prepare(editor.state.doc.content.content);
    const { dom } = renderer.render(editor.state.doc.child(0), 0);
    const shown = [...dom.querySelectorAll<HTMLElement>(`br[${WORD_PAGE_BREAK_ATTR}]`)].filter(
      (br) => !br.closest('[style*="display: none"]'),
    );
    expect(shown.length).toBe(0);
  });

  it("renderBlocks: deleted text in a table cell is not shown", () => {
    const table: NodeJSON = {
      type: "table",
      attrs: { grid: [2000] },
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableCell", content: [p({}, text("kept"), text("gone", [deleted]))] }],
        },
      ],
    };
    const [block] = renderBlocks(documentOf(table, p({}, text("z"))), document, {
      review: "final",
    });
    expect(block?.element.textContent).toBe("kept");
  });
});

describe("renderBlocks: lists in table cells", () => {
  it("draws a numbered cell paragraph's marker and counts it in the list", () => {
    const numbered = { numbering: { id: 1, level: 0 } };
    const table: NodeJSON = {
      type: "table",
      attrs: { grid: [2000] },
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableCell", content: [p(numbered, text("in cell"))] }],
        },
      ],
    };
    const [first, cell, after] = renderBlocks(
      documentOf(p(numbered, text("one")), table, p(numbered, text("three"))),
      document,
    );
    expect(first?.element.querySelector("[data-foli-marker]")?.textContent).toContain("1.");
    expect(cell?.element.querySelector("[data-foli-marker]")?.textContent).toContain("2.");
    expect(after?.element.querySelector("[data-foli-marker]")?.textContent).toContain("3.");
  });
});
