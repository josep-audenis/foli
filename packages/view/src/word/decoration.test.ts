// @vitest-environment jsdom
import { createDocument, createEditor, type FoliDocument, type SectionJSON } from "@folijs/core";
import { withEnvelope, wordContext } from "@folijs/core/internal";
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "../index.js";
import {
  PAGE_BORDERS_ATTR,
  pageBordersElement,
  pageColor,
  showsPageBorders,
} from "./decoration.js";
import { renderDocument } from "./pages.js";

/** Page decoration drawn (32.1): the page color and a section's page borders. */

const BOX = { width: 800, height: 1000, top: 96, right: 96, bottom: 96, left: 120 };
const line = { style: "single", size: 12, space: 24, color: "FF0000" };

describe("page borders", () => {
  it("are placed from the page's edge or outside the text", () => {
    const fromPage = pageBordersElement(
      document,
      { offsetFrom: "page", top: line, left: { ...line, space: 12 } },
      BOX,
      true,
    ) as HTMLElement;
    expect(fromPage.style.top).toBe("32px");
    expect(fromPage.style.left).toBe("16px");
    expect(fromPage.style.borderTop).toBe("2px solid rgb(255, 0, 0)");
    expect(fromPage.style.zIndex).toBe("1");
    expect(fromPage.getAttribute("aria-hidden")).toBe("true");
    // From the text (Word's default): space and the border's width outside the margins.
    const fromText = pageBordersElement(
      document,
      { bottom: { ...line, space: 4 }, zOrder: "back" },
      BOX,
      true,
    ) as HTMLElement;
    expect(fromText.style.bottom).toBe(`${96 - (4 * 96) / 72 - 2}px`);
    expect(fromText.style.zIndex).toBe("-1");
    expect(pageBordersElement(document, { top: { style: "none" } }, BOX, true)).toBeNull();
  });

  it("show on the pages `display` names", () => {
    expect(showsPageBorders({}, false)).toBe(true);
    expect(showsPageBorders({ display: "firstPage" }, true)).toBe(true);
    expect(showsPageBorders({ display: "firstPage" }, false)).toBe(false);
    expect(showsPageBorders({ display: "notFirstPage" }, true)).toBe(false);
    expect(pageColor({ background: { color: "auto" } })).toBeUndefined();
    expect(pageColor({ background: { color: "FFF2CC" } })).toBe("#FFF2CC");
  });
});

const decorated = (section: SectionJSON = {}): FoliDocument => {
  const doc = createDocument(
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] },
    { pageBorders: { offsetFrom: "page", top: line, left: line }, ...section },
  );
  return { ...doc, schemaVersion: 9, settings: { background: { color: "DEEAF6" } } };
};

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const done of cleanup) done();
  cleanup = [];
});

describe("renderDocument", () => {
  it("draws the page color and borders on each page", () => {
    const container = document.createElement("div");
    document.body.append(container);
    cleanup.push(() => container.remove());
    const { pages } = renderDocument(decorated(), container);
    const page = pages[0] as HTMLElement;
    expect(page.style.background).toContain("rgb(222, 234, 246)");
    expect(page.style.getPropertyValue("print-color-adjust")).toBe("exact");
    expect(page.querySelector(`[${PAGE_BORDERS_ATTR}]`)).not.toBeNull();
    const plain = renderDocument(createDocument(), container).pages[0] as HTMLElement;
    expect(plain.style.background).toContain("rgb(255, 255, 255)");
    expect(plain.querySelector(`[${PAGE_BORDERS_ATTR}]`)).toBeNull();
  });
});

describe("EditorView", () => {
  it("draws them, and again when they change", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({ document: decorated() });
    const view = new EditorView(host, editor);
    cleanup.push(() => {
      view.destroy();
      host.remove();
    });
    const page = () => host.querySelector(".foli-page") as HTMLElement;
    expect(page().style.backgroundColor).toBe("rgb(222, 234, 246)");
    expect(page().querySelector(`[${PAGE_BORDERS_ATTR}]`)).not.toBeNull();
    // A change of the envelope alone: the color goes, the borders too.
    const envelope = wordContext(editor.state)?.envelope;
    if (!envelope) throw new Error("no envelope");
    const { pageBorders: _gone, ...section } = envelope.section;
    editor.dispatch(withEnvelope(editor.state.tr, { ...envelope, settings: {}, section }));
    expect(page().style.backgroundColor).toBe("");
    expect(page().querySelector(`[${PAGE_BORDERS_ATTR}]`)).toBeNull();
  });
});
