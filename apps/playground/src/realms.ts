/**
 * Editors in other places than the page's own document (`/realms.html`, dev server only): one
 * inside a shadow root, one inside a same-origin iframe (another realm: its own `Element`,
 * `Selection` and `ResizeObserver`). Driven by `e2e/realms.spec.ts` (21.8).
 */
import { createDocument, createEditor, type Editor } from "@folijs/core";
import { EditorView } from "@folijs/view";

const doc = () =>
  createDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  });

function mount(host: HTMLElement): { editor: Editor; view: EditorView } {
  const editor = createEditor({ document: doc() });
  host.setAttribute("aria-label", "Document");
  return { editor, view: new EditorView(host, editor) };
}

const shadowHost = document.getElementById("shadow-host") as HTMLElement;
const root = shadowHost.attachShadow({ mode: "open" });
const inShadow = document.createElement("div");
root.append(inShadow);
const shadow = mount(inShadow);

const frame = document.getElementById("frame") as HTMLIFrameElement;
const frameDoc = frame.contentDocument as Document;
frameDoc.open();
frameDoc.write("<!doctype html><html><body></body></html>");
frameDoc.close();
const inFrame = frameDoc.createElement("div");
frameDoc.body.append(inFrame);
const framed = mount(inFrame);

declare global {
  interface Window {
    foliRealms: {
      text(which: "shadow" | "frame"): string;
      pages(which: "shadow" | "frame"): number;
    };
  }
}

const of = (which: "shadow" | "frame") => (which === "shadow" ? shadow : framed);
window.foliRealms = {
  text: (which) => of(which).editor.state.doc.textContent,
  pages: (which) => (which === "shadow" ? inShadow : inFrame).querySelectorAll(".foli-page").length,
};
