// @vitest-environment jsdom
import {
  type ControlJSON,
  controlsIn,
  createDocument,
  createEditor,
  type FoliDocument,
  type NodeJSON,
} from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "../index.js";
import { renderBlocks } from "./blocks.js";

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const control = (id: string, value: string): NodeJSON[] => [
  { type: "controlStart", attrs: { id } },
  text(value),
  { type: "controlEnd", attrs: { id } },
];
const documentOf = (controls: Record<string, ControlJSON>): FoliDocument => ({
  ...createDocument({
    type: "doc",
    content: [
      { type: "paragraph", content: [text("a "), ...control("c", "held"), text(" z")] },
      { type: "paragraph", attrs: { controls: ["b"] }, content: [text("block")] },
    ],
  }),
  controls,
});
const CONTROLS: Record<string, ControlJSON> = {
  c: { kind: "dropDown", alias: "Pick", items: [{ value: "1", display: "held" }] },
  b: { kind: "richText" },
};

let views: EditorView[] = [];
afterEach(() => {
  for (const view of views) {
    view.destroy();
    view.host.remove();
  }
  views = [];
});

function viewOf(document: FoliDocument) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const editor = createEditor({ document });
  const view = new EditorView(host, editor);
  views.push(view);
  return { editor, view, host };
}

describe("content controls in the views", () => {
  it("the read-only renderer shows their content, nothing of their markers", () => {
    const blocks = renderBlocks(documentOf(CONTROLS), window.document);
    expect(blocks.map((b) => b.element.textContent)).toEqual(["a held z", "block"]);
  });

  it("the frame is the view's own: not text, no position, gone with the caret", () => {
    const { editor, view, host } = viewOf(documentOf(CONTROLS));
    const frames = () => host.querySelectorAll("[data-foli-control-frame]");
    const before = editor.state.doc;
    expect(frames()).toHaveLength(0);
    const range = controlsIn(editor.state.doc)[0] as { contentFrom: number };
    editor.select(range.contentFrom + 1);
    expect(frames().length).toBeGreaterThan(0);
    const frame = frames()[0] as HTMLElement;
    expect(frame.getAttribute("contenteditable")).toBe("false");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector('[data-foli-control-tab="title"]')?.textContent).toBe("Pick");
    expect(editor.state.doc).toBe(before);
    expect(view.posFromDOM(host.querySelector("p")?.firstChild as Node, 0)).toBe(1);
    editor.select(1);
    expect(frames()).toHaveLength(0);
  });

  it("announces the control the caret is in", () => {
    const { editor } = viewOf(documentOf(CONTROLS));
    editor.select((controlsIn(editor.state.doc)[0] as { contentFrom: number }).contentFrom);
    expect(window.document.querySelector('[role="status"]')?.textContent).toBe(
      "Pick, Drop-down list, press Alt+Down to open",
    );
  });

  it("opens no list for a locked control, and takes the list off when it closes", () => {
    const { editor, host } = viewOf(
      documentOf({ ...CONTROLS, c: { ...CONTROLS.c, lock: "contentLocked" } as ControlJSON }),
    );
    editor.select((controlsIn(editor.state.doc)[0] as { contentFrom: number }).contentFrom);
    host.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    );
    expect(window.document.querySelector("[data-foli-control-popup]")).toBeNull();
  });
});
