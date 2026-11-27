// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type FoliDocument,
  type NodeJSON,
  parseDocument,
} from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
import { afterEach, describe, expect, it } from "vitest";
import { serializeRange } from "../clipboard.js";
import { EditorView, renderDocument } from "../index.js";
import { FLOAT_ATTR, renderBlocks, TEXT_BOX_ATTR } from "./blocks.js";

/** Text boxes drawn (33.2, ADR-0016). */

const box = (story: string, attrs: Record<string, unknown> = {}): NodeJSON => ({
  type: "textBox",
  attrs: { story, width: 1_828_800, height: 914_400, ...attrs },
});
const story = (...texts: string[]) => ({
  kind: "textBox" as const,
  content: {
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  },
});

/** A schema 10 document: "Before", a box (story `textbox:1`), "After". */
function boxed(attrs: Record<string, unknown> = {}): FoliDocument {
  return parseDocument({
    ...createDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Before " },
            box("textbox:1", attrs),
            { type: "text", text: "After" },
          ],
        },
      ],
    }),
    schemaVersion: 10,
    stories: { "textbox:1": story("First line", "Second") },
  });
}

const FLOAT = {
  horizontal: { relativeTo: "column", offset: 952_500 },
  vertical: { relativeTo: "paragraph", offset: 0 },
  wrap: "square",
  distance: { top: 0, bottom: 0, left: 114_300, right: 114_300 },
};

describe("a text box's drawing", () => {
  it("is a box of its size with its fill, line and insets, its story's paragraphs inside", () => {
    const doc = boxed({
      fill: "F2F2F2",
      outline: { color: "002060", width: 19_050 },
      inset: { left: 0, top: 9525, right: 0, bottom: 0 },
      verticalAlign: "center",
      alt: "Programme",
    });
    const [block] = renderBlocks(doc, document);
    const element = block?.element.querySelector(`[${TEXT_BOX_ATTR}]`) as HTMLElement;
    expect(element.getAttribute(TEXT_BOX_ATTR)).toBe("textbox:1");
    expect(element.getAttribute("aria-label")).toBe("Programme");
    expect(element.style.width).toBe("192px");
    expect(element.style.height).toBe("96px");
    expect(element.style.overflow).toBe("hidden");
    expect(element.style.backgroundColor).toBe("rgb(242, 242, 242)");
    expect(element.style.outline).toBe("2px solid #002060");
    const inner = element.firstElementChild as HTMLElement;
    expect(inner.style.padding).toBe("1px 0px 0px");
    expect(inner.style.justifyContent).toBe("center");
    expect([...element.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "First line",
      "Second",
    ]);
    // The text around it is the paragraph's own, the box's apart.
    expect(block?.element.textContent).toBe("Before First lineSecondAfter");
  });

  it("grows to its text when it fits its text, and shows nothing of a missing story", () => {
    const grown = renderBlocks(boxed({ autoFit: true }), document)[0]?.element.querySelector(
      `[${TEXT_BOX_ATTR}]`,
    ) as HTMLElement;
    expect(grown.style.height).toBe("");
    expect(grown.style.minHeight).toBe("96px");
    const missing = { ...boxed(), stories: {} };
    const empty = renderBlocks(missing, document)[0]?.element.querySelector(
      `[${TEXT_BOX_ATTR}]`,
    ) as HTMLElement;
    expect(empty.textContent).toBe("");
  });

  it("floats as a floating picture does, first in its paragraph", () => {
    const [block] = renderBlocks(boxed({ float: FLOAT }), document);
    const holder = block?.element.querySelector(`[${FLOAT_ATTR}]`) as HTMLElement;
    expect(holder.getAttribute(FLOAT_ATTR)).toBe("square");
    expect(holder.querySelector(`[${TEXT_BOX_ATTR}]`)).not.toBeNull();
    expect(holder.style.float).toBe("left");
    expect(holder.style.marginLeft).toBe("100px");
    // Floats come first in the paragraph.
    expect(block?.element.firstElementChild?.nextElementSibling).toBe(holder);
  });

  it("is stacked by its zOrder, one rank per Word relativeHeight step (33.6)", () => {
    const front = { ...FLOAT, wrap: "inFront", zOrder: 251_658_240 + 2048 };
    const back = { ...FLOAT, wrap: "inFront", zOrder: 251_658_240 + 1024 };
    const zOf = (float: unknown) =>
      Number(
        (
          (
            renderBlocks(boxed({ float }), document)[0] as { element: HTMLElement }
          ).element.querySelector("[data-foli-float]") as HTMLElement
        ).style.zIndex,
      );
    expect(zOf(front)).toBeGreaterThan(zOf(back));
    expect(zOf(back)).toBeGreaterThan(1);
    expect(zOf({ ...back, wrap: "behind" })).toBeLessThan(0);
  });

  it("is drawn by renderDocument, for print and exportPdf", () => {
    const container = document.createElement("div");
    document.body.append(container);
    renderDocument(boxed({ float: FLOAT }), container);
    expect(container.querySelector(`[${TEXT_BOX_ATTR}]`)?.textContent).toBe("First lineSecond");
    container.remove();
  });
});

describe("text boxes in the editable view", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.replaceChildren();
  });

  it("are one position, not editable, drawn again when their story changes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({ document: boxed({ float: FLOAT }) });
    const view = new EditorView(host, editor);
    views.push(view);
    const drawn = () => host.querySelector(`[${TEXT_BOX_ATTR}]`) as HTMLElement;
    expect(drawn().textContent).toBe("First lineSecond");
    expect(drawn().closest("[contenteditable]")?.getAttribute("contenteditable")).toBe("false");
    // The text after the box maps after its one position.
    const after = [...host.querySelectorAll("span")].find((s) => s.textContent === "After");
    expect(view.posFromDOM(after?.firstChild as Node, 0)).toBe(1 + "Before ".length + 1);
    const inBox = editor.story("textbox:1");
    inBox?.dispatch(inBox.state.tr.insertText("New ", 1));
    expect(drawn().textContent).toBe("New First lineSecond");
  });

  it("are left out of a copy's HTML (their paragraphs would break the line's)", () => {
    const editor = createEditor({ document: boxed({ float: FLOAT }) });
    const { state } = editor;
    const copied = serializeRange(state.doc, 0, state.doc.content.size, document, {
      context: wordContext(state) as NonNullable<ReturnType<typeof wordContext>>,
      ratio: () => 1.2,
    });
    expect(copied.html).not.toContain("First line");
    expect(copied.html).toContain("Before ");
  });
});
