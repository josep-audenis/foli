// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type NodeJSON,
  NodeSelection,
  parseDocument,
} from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "../index.js";
import { imageSource, NO_ALT_LABEL, ownImageUrl, PICTURE_ATTR, pictureElement } from "./blocks.js";

/** Pictures in the view (10.8b). */

const DOT = "data:image/png;base64,iVBORw0KGgo=";
const picture = (attrs: Record<string, unknown>): NodeJSON => ({
  type: "picture",
  attrs: { resource: "img", width: 914400, height: 457200, ...attrs },
});

describe("a picture's element", () => {
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
    // Typing elsewhere is still read back (the handle is not input).
    editor.select(1);
    expect(host.querySelectorAll("[data-foli-resize]")).toHaveLength(0);
  });
});
