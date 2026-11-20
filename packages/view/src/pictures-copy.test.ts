// @vitest-environment jsdom
import { createEditor, type FoliDocument, type NodeJSON } from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { FOLI_MIME } from "./clipboard.js";
import { EditorView } from "./view.js";

/** Pictures copied into another document bring their images (12.11). */

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const GIF = "data:image/gif;base64,R0lGODlh";
const picture = (resource: string): NodeJSON => ({
  type: "picture",
  attrs: { resource, width: 914400, height: 914400, alt: resource },
});
const documentOf = (content: NodeJSON[], resources?: FoliDocument["resources"]): FoliDocument => ({
  schemaVersion: 5,
  section: {},
  defaults: {},
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  ...(resources ? { resources } : {}),
  content: { type: "doc", content },
});

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.host.remove();
  }
});
function mount(doc: FoliDocument, options: ConstructorParameters<typeof EditorView>[2] = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({ document: doc });
  const view = new EditorView(host, editor, options);
  views.push(view);
  return { host, editor, view };
}
function copyAll(host: HTMLElement, editor: ReturnType<typeof createEditor>) {
  editor.select(0, editor.state.doc.content.size);
  const store = new Map<string, string>();
  const event = new Event("copy", { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { setData: (k: string, v: string) => store.set(k, v), getData: () => "" },
  });
  host.dispatchEvent(event);
  return store;
}
const shown = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLImageElement>("img[data-foli-picture]")].map((img) => img.src);

describe("pictures copied into another document", () => {
  it("bring their images: their own data, or the image the view shows for a package part", () => {
    const source = mount(
      documentOf([{ type: "paragraph", content: [picture("rId5"), picture("rId6")] }], {
        rId5: { contentType: "image/png", data: PNG },
        rId6: { contentType: "image/gif", part: "word/media/image1.gif" },
      }),
      // As `packageImages` gives an SVG's or the app gives any: the part's image as a URL.
      { resource: (key) => (key === "rId6" ? GIF : undefined) },
    );
    expect(shown(source.host)).toEqual([PNG, GIF]);
    const store = copyAll(source.host, source.editor);
    const json = JSON.parse(store.get(FOLI_MIME) ?? "{}");
    expect(json.word.resources).toEqual({
      rId5: { contentType: "image/png", data: PNG },
      rId6: { contentType: "image/gif", data: GIF },
    });
    // The HTML carries the JSON too: a paste that has only HTML (Firefox) keeps the pictures.
    expect(store.get("text/html")).toContain("data-foli-clipboard");

    for (const types of <Record<string, string>[]>[
      { [FOLI_MIME]: store.get(FOLI_MIME) ?? "", "text/html": store.get("text/html") ?? "" },
      { "text/html": store.get("text/html") ?? "" },
    ]) {
      // The target has another image under rId5.
      const target = mount(
        documentOf([{ type: "paragraph" }], {
          rId5: { contentType: "image/png", url: "https://example.com/other.png" },
        }),
      );
      target.editor.select(1);
      expect(target.view.paste({ getData: (type: string) => types[type] ?? "" })).toBe(true);
      const saved = target.editor.getDocument();
      expect(saved.resources).toEqual({
        rId5: { contentType: "image/png", url: "https://example.com/other.png" },
        "rId5-2": { contentType: "image/png", data: PNG },
        rId6: { contentType: "image/gif", data: GIF },
      });
      expect(shown(target.host)).toEqual([PNG, GIF]);
    }
  });
});
