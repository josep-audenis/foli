// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type NodeJSON,
  NodeSelection,
  parseDocument,
} from "@folijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "../index.js";
import {
  FLOAT_ATTR,
  floatElements,
  floatGeometry,
  imageSource,
  NO_ALT_LABEL,
  ownImageUrl,
  PICTURE_ATTR,
  pictureElement,
  renderBlocks,
} from "./blocks.js";

/** Pictures in the view (10.8b). */

const DOT = "data:image/png;base64,iVBORw0KGgo=";
const picture = (attrs: Record<string, unknown>): NodeJSON => ({
  type: "picture",
  attrs: { resource: "img", width: 914400, height: 457200, ...attrs },
});

describe("a picture's element", () => {
  it("shows its crop: a box of its size, the image scaled so the cut edges fall outside (19.5)", () => {
    const image = imageSource({ img: { contentType: "image/png", data: DOT } });
    const element = pictureElement(
      picture({ alt: "A dot", crop: { left: 25000, right: 25000, top: 10000 } }).attrs ?? {},
      document,
      image,
    );
    expect(element.localName).toBe("span");
    expect(element.getAttribute(PICTURE_ATTR)).toBe("img");
    expect(element.getAttribute("aria-label")).toBe("A dot");
    expect([element.style.width, element.style.height, element.style.overflow]).toEqual([
      "96px",
      "48px",
      "hidden",
    ]);
    const img = element.querySelector("img") as HTMLImageElement;
    expect(img.alt).toBe("A dot");
    // Half the image's width shows: it is twice the box's, from a quarter to its left.
    expect([img.style.width, img.style.left]).toEqual(["200%", "-50%"]);
    expect(Number.parseFloat(img.style.height)).toBeCloseTo(111.11, 1);
    expect(Number.parseFloat(img.style.top)).toBeCloseTo(-11.11, 1);
  });

  it("is rotated by its rotation, clockwise (19.5)", () => {
    const image = imageSource({ img: { contentType: "image/png", data: DOT } });
    const element = pictureElement(picture({ rotation: 5_400_000 }).attrs ?? {}, document, image);
    expect(element.style.transform).toBe("rotate(90deg)");
  });

  it("is its image at its size (96 px per inch), with its alt text", () => {
    const image = imageSource({ img: { contentType: "image/png", data: DOT } });
    const element = pictureElement(picture({ alt: "A dot" }).attrs ?? {}, document, image);
    expect(element.localName).toBe("img");
    expect((element as HTMLImageElement).src).toBe(DOT);
    expect(element.getAttribute("alt")).toBe("A dot");
    expect([element.style.width, element.style.height]).toEqual(["96px", "48px"]);
    expect(element.getAttribute(PICTURE_ATTR)).toBe("img");
  });

  it("is a box of its size with its alt text when no URL is known; marked without alt text", () => {
    const element = pictureElement(
      picture({ alt: "A dot" }).attrs ?? {},
      document,
      () => undefined,
    );
    expect(element.localName).toBe("span");
    expect(element.getAttribute("role")).toBe("img");
    expect(element.getAttribute("aria-label")).toBe("A dot");
    const unnamed = pictureElement(picture({}).attrs ?? {}, document, () => undefined);
    expect(unnamed.hasAttribute("data-foli-no-alt")).toBe(true);
    // Not silent: a screen reader says a picture is there, without its alt text.
    expect(unnamed.getAttribute("aria-label")).toBe(NO_ALT_LABEL);
    const shown = pictureElement(picture({}).attrs ?? {}, document, () => DOT) as HTMLImageElement;
    expect(shown.alt).toBe(NO_ALT_LABEL);
    expect(shown.referrerPolicy).toBe("no-referrer");
    // In the line whatever the app's CSS says of images.
    expect([shown.style.display, shown.style.verticalAlign, shown.style.maxWidth]).toEqual([
      "inline",
      "baseline",
      "none",
    ]);
    const decorative = pictureElement(picture({ decorative: true }).attrs ?? {}, document);
    expect(decorative.hasAttribute("data-foli-no-alt")).toBe(false);
  });

  it("uses only image data: URLs and web or blob URLs of its own", () => {
    expect(ownImageUrl({ contentType: "image/png", data: DOT })).toBe(DOT);
    expect(ownImageUrl({ contentType: "image/png", url: "https://x.test/a.png" })).toBe(
      "https://x.test/a.png",
    );
    expect(ownImageUrl({ contentType: "image/png", url: "javascript:alert(1)" })).toBeUndefined();
    expect(ownImageUrl({ contentType: "image/png", part: "word/media/a.png" })).toBeUndefined();
    // The app's URL first.
    const image = imageSource(
      { img: { contentType: "image/png", part: "word/media/a.png" } },
      () => "blob:x",
    );
    expect(image("img")).toBe("blob:x");
    // The app's refusal stands: the box, not the resource's own web URL.
    const refused = imageSource(
      { img: { contentType: "image/png", url: "https://x.test/a.png" } },
      () => null,
    );
    expect(refused("img")).toBeUndefined();
  });
});

describe("pictures in the editable view", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.replaceChildren();
  });

  it("are drawn in their paragraph, one position, not editable inside", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({
      document: parseDocument({
        ...createDocument({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "a" },
                picture({ alt: "Dot" }),
                { type: "text", text: "b" },
              ],
            },
          ],
        }),
        resources: { img: { contentType: "image/png", data: DOT } },
      }),
    });
    const view = new EditorView(host, editor);
    views.push(view);
    const img = host.querySelector(`img[${PICTURE_ATTR}]`) as HTMLImageElement;
    expect(img.alt).toBe("Dot");
    expect(img.parentElement?.getAttribute("contenteditable")).toBe("false");
    // The position after the picture maps to the text after it.
    const b = [...host.querySelectorAll("span")].find((s) => s.textContent === "b");
    expect(view.posFromDOM(b?.firstChild as Node, 0)).toBe(3);
    // Another resolver draws every picture again from it, the selection kept.
    editor.select(3);
    view.focus();
    view.setOptions({ resource: () => "blob:other" });
    expect(editor.state.selection.head).toBe(3);
    const sel = document.getSelection() as globalThis.Selection;
    expect(view.posFromDOM(sel.focusNode as Node, sel.focusOffset)).toBe(3);
    expect((host.querySelector(`img[${PICTURE_ATTR}]`) as HTMLImageElement).src).toBe("blob:other");
  });

  it("show a resize handle on the selected picture only while the document is editable", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({
      document: parseDocument({
        ...createDocument({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "a" }, picture({ alt: "Dot" })] },
          ],
        }),
        resources: { img: { contentType: "image/png", data: DOT } },
      }),
    });
    const view = new EditorView(host, editor);
    views.push(view);
    editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2)));
    expect(host.querySelectorAll("[data-foli-resize]")).toHaveLength(1);
    view.setOptions({ editable: false });
    expect(host.querySelectorAll("[data-foli-resize]")).toHaveLength(0);
    view.setOptions({ editable: true });
    expect(host.querySelectorAll("[data-foli-resize]")).toHaveLength(1);
    // A caret elsewhere: no handle left behind.
    editor.select(1);
    expect(host.querySelectorAll("[data-foli-resize]")).toHaveLength(0);
  });
});

describe("a floating picture's elements (10.9)", () => {
  // Letter, 1-inch margins: a 624 px column, 96 px margins.
  const letter = floatGeometry(undefined);
  const at = (float: Record<string, unknown>) =>
    floatElements(picture({ alt: "A dot", float }).attrs ?? {}, document, undefined, letter);
  const column = (offset: number) => ({ relativeTo: "column", offset: offset * 9525 });
  const paragraph = (offset: number) => ({ relativeTo: "paragraph", offset: offset * 9525 });

  it("float square on the side they are on, a spacer giving their offset down", () => {
    const left = at({ horizontal: column(10), vertical: paragraph(24), wrap: "square" });
    expect(left.nodes).toHaveLength(2);
    const [spacer, holder] = left.nodes as [HTMLElement, HTMLElement];
    expect(holder).toBe(left.holder);
    expect(holder.getAttribute(FLOAT_ATTR)).toBe("square");
    expect([spacer.style.float, spacer.style.height]).toEqual(["left", "24px"]);
    expect([holder.style.float, holder.style.clear, holder.style.marginLeft]).toEqual([
      "left",
      "left",
      "10px",
    ]);
    // 96 px wide at 500 px: on the right half, so floated right, its left edge at 500 px.
    const right = at({
      horizontal: column(500),
      vertical: paragraph(0),
      wrap: "tight",
      distance: { left: 12 * 9525 },
    });
    expect([right.holder.style.float, right.holder.style.marginRight]).toEqual(["right", "28px"]);
    expect(right.holder.style.marginLeft).toBe("12px");
    // Against the page: the margin taken off; aligned right: at the column's right edge.
    const page = at({
      horizontal: { relativeTo: "page", offset: 146 * 9525 },
      vertical: paragraph(0),
      wrap: "square",
    });
    expect(page.holder.style.marginLeft).toBe("50px");
    const aligned = at({
      horizontal: { relativeTo: "margin", align: "right" },
      vertical: paragraph(0),
      wrap: "square",
    });
    expect([aligned.holder.style.float, aligned.holder.style.marginRight]).toEqual([
      "right",
      "0px",
    ]);
  });

  it("take the paragraph's width top and bottom, the page's place behind and in front", () => {
    const band = at({ horizontal: column(40), vertical: paragraph(0), wrap: "topAndBottom" });
    expect([band.holder.style.width, band.holder.style.clear]).toEqual(["100%", "both"]);
    expect((band.holder.firstChild as HTMLElement).style.marginLeft).toBe("40px");
    const behind = at({ horizontal: column(40), vertical: paragraph(8), wrap: "behind" });
    expect(behind.nodes).toEqual([behind.holder]);
    expect(behind.holder.style.position).toBe("absolute");
    expect([behind.holder.style.zIndex, behind.holder.style.left]).toEqual(["-1", "136px"]);
    expect([behind.holder.style.top, behind.holder.style.marginTop]).toEqual(["", "8px"]);
    const front = at({
      horizontal: { relativeTo: "page", align: "center" },
      vertical: { relativeTo: "margin", offset: 0 },
      wrap: "inFront",
    });
    expect([front.holder.style.zIndex, front.holder.style.left, front.holder.style.top]).toEqual([
      "1",
      "360px",
      "96px",
    ]);
  });

  it("are drawn first in their paragraph in the editable view, an empty anchor in the text", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({
      document: parseDocument(
        createDocument({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Some text " },
                picture({
                  alt: "A dot",
                  float: { horizontal: column(0), vertical: paragraph(0), wrap: "square" },
                }),
                { type: "text", text: "after." },
              ],
            },
          ],
        }),
      ),
    });
    const view = new EditorView(host, editor);
    const p = host.querySelector(".foli-page > *") as HTMLElement;
    const holder = p.querySelector(`[${FLOAT_ATTR}]`) as HTMLElement;
    // Spacer, holder, then the text; the anchor (empty) where the picture is in the text.
    expect(p.firstElementChild?.nextElementSibling).toBe(holder);
    expect(holder.getAttribute("contenteditable")).toBe("false");
    // No image known: its box, named by its alt text.
    expect(holder.querySelector(`[${PICTURE_ATTR}]`)?.getAttribute("aria-label")).toBe("A dot");
    expect(p.textContent).toBe("Some text after.");
    // Selected: its holder is marked (outline and handle), not its anchor.
    editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 11)));
    expect(holder.querySelector("[data-foli-resize]")).not.toBeNull();
    view.destroy();
    host.remove();
  });
});

describe("floating pictures against the page's margins (10.9)", () => {
  // Letter, 1-inch margins: 816 × 1056 px, 96 px margins.
  const letter = floatGeometry(undefined);
  const holder = (float: Record<string, unknown>) =>
    floatElements(picture({ alt: "A dot", float }).attrs ?? {}, document, undefined, letter).holder
      .style;
  const behind = (horizontal: unknown, vertical: unknown) =>
    holder({ horizontal, vertical, wrap: "behind" });

  it("align in the margin they are against", () => {
    // 96 × 48 px: in the left margin (0-96), the right margin (720-816).
    const along = (relativeTo: string, align: string) =>
      behind({ relativeTo, align }, { relativeTo: "page", offset: 0 }).left;
    expect(along("leftMargin", "left")).toBe("0px");
    expect(along("leftMargin", "right")).toBe("0px");
    expect(along("rightMargin", "left")).toBe("720px");
    expect(along("rightMargin", "right")).toBe("720px");
    expect(along("margin", "center")).toBe("360px");
    expect(along("page", "right")).toBe("720px");
    const down = (relativeTo: string, align: string) =>
      behind({ relativeTo: "page", offset: 0 }, { relativeTo, align }).top;
    expect(down("topMargin", "top")).toBe("0px");
    expect(down("topMargin", "bottom")).toBe("48px");
    expect(down("bottomMargin", "top")).toBe("960px");
    expect(down("bottomMargin", "bottom")).toBe("1008px");
    expect(down("margin", "bottom")).toBe("912px");
    expect(down("page", "center")).toBe("504px");
  });

  it("keep their distance from the text above them", () => {
    const style = holder({
      horizontal: { relativeTo: "column", offset: 0 },
      vertical: { relativeTo: "paragraph", offset: 30 * 9525 },
      wrap: "square",
      distance: { top: 6 * 9525 },
    });
    expect(style.marginTop).toBe("6px");
  });
});

describe("floating pictures on pages (10.9)", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  const float = {
    horizontal: { relativeTo: "column", offset: 0 },
    vertical: { relativeTo: "paragraph", offset: 0 },
    wrap: "square",
  };
  const text = (t: string): NodeJSON => ({
    type: "paragraph",
    content: [{ type: "text", text: t }],
  });
  const mount = (content: NodeJSON[]) => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({
      document: parseDocument(createDocument({ type: "doc", content } as NodeJSON as never)),
    });
    const view = new EditorView(host, editor);
    views.push(view);
    return { host, editor };
  };

  it("show a paragraph holding only one as an empty line", () => {
    const { host } = mount([{ type: "paragraph", content: [picture({ alt: "Dot", float })] }]);
    const p = host.querySelector(".foli-page > *") as HTMLElement;
    expect(p.lastElementChild?.localName).toBe("br");
  });

  it("have the blocks after an edited one on their page and the next measured again", () => {
    // jsdom lays nothing out: every block is 400 px tall, two to a page.
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const height = this.parentElement?.classList.contains("foli-page") ? 400 : 0;
      return { height, width: 0, top: 0, left: 0, bottom: height, right: 0 } as DOMRect;
    });
    const { host, editor } = mount([
      { type: "paragraph", content: [picture({ alt: "Dot", float }), { type: "text", text: "a" }] },
      text("b"),
      text("c"),
      text("d"),
      text("e"),
      text("f"),
      text("g"),
    ]);
    expect(host.querySelectorAll(".foli-page")).toHaveLength(4);
    spy.mockClear();
    editor.select(3); // after "a"
    editor.commands.insertText("x");
    const read = new Set(spy.mock.contexts.map((el) => (el as Element).textContent));
    // The edited block and those after it on its page and the next two (it is a new block,
    // maybe the next page's first); not the last page.
    for (const t of ["ax", "b", "c", "d"]) expect(read.has(t)).toBe(true);
    expect(read.has("g")).toBe(false);
    // The picture deleted: the blocks that went around it are measured again too.
    spy.mockClear();
    editor.dispatch(editor.state.tr.delete(1, 2));
    expect(host.querySelector(`[${FLOAT_ATTR}]`)).toBeNull();
    const after = new Set(spy.mock.contexts.map((el) => (el as Element).textContent));
    for (const t of ["ax", "b", "c", "d"]) expect(after.has(t)).toBe(true);
  });

  it("have the blocks after a deleted one measured again when its paragraph starts a page", () => {
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const height = this.parentElement?.classList.contains("foli-page") ? 400 : 0;
      return { height, width: 0, top: 0, left: 0, bottom: height, right: 0 } as DOMRect;
    });
    const { host, editor } = mount([
      text("a"),
      text("b"),
      { type: "paragraph", content: [picture({ alt: "Dot", float }), { type: "text", text: "c" }] },
      text("d"),
      text("e"),
      text("f"),
      text("g"),
    ]);
    expect(host.querySelectorAll(".foli-page")).toHaveLength(4);
    spy.mockClear();
    // The picture is the first thing in "c", the first block of page 2.
    const at = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize + 1;
    editor.dispatch(editor.state.tr.delete(at, at + 1));
    expect(host.querySelector(`[${FLOAT_ATTR}]`)).toBeNull();
    const read = new Set(spy.mock.contexts.map((el) => (el as Element).textContent));
    for (const t of ["c", "d"]) expect(read.has(t)).toBe(true);
  });

  it("are drawn first in their paragraph by renderBlocks, the text after them", () => {
    const [block] = renderBlocks(
      createDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Text " }, picture({ alt: "Dot", float })],
          },
        ],
      } as NodeJSON as never),
      document,
    );
    const element = block?.element as HTMLElement;
    expect(element.children[1]?.getAttribute(FLOAT_ATTR)).toBe("square");
    expect(element.textContent).toBe("Text ");
  });
});
