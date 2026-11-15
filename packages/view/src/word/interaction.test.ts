// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type DocJSON,
  type NodeJSON,
  NodeSelection,
  parseDocumentV3,
  TextSelection,
} from "@folijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "../index.js";

// Documents are written as 0.2.0 ones where that is shorter (lists): the editor migrates them.
const text = (value: string): NodeJSON => ({ type: "text", text: value });
const p = (...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});
const item = (...content: NodeJSON[]): NodeJSON => ({ type: "listItem", content });
const ul = (...items: NodeJSON[]): NodeJSON => ({ type: "bulletList", content: items });
const table: NodeJSON = {
  type: "opaqueBlock",
  attrs: { xml: "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" },
};

let views: EditorView[] = [];
afterEach(() => {
  for (const view of views) {
    view.destroy();
    view.host.remove();
  }
  views = [];
});

/** Mounts schema v2 `blocks` (migrated) or, with `v3`, schema v3 ones. */
function mount(blocks: NodeJSON[], v3 = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const json = { type: "doc", content: blocks } as DocJSON;
  const document_ = v3
    ? { ...parseDocumentV3(createDocument()), content: json as never }
    : createDocument(json);
  const editor = createEditor({ document: document_ });
  const view = new EditorView(host, editor);
  views.push(view);
  view.focus();
  return { host, editor, view };
}
const numbered = (editor: ReturnType<typeof mount>["editor"]) =>
  (editor.getDocument().content.content ?? []).map((block) => Boolean(block.attrs?.numbering));
const beforeInput = (host: HTMLElement, inputType: string) =>
  host.dispatchEvent(new InputEvent("beforeinput", { inputType, cancelable: true, bubbles: true }));

describe("EditorView selection on a schema v3 document", () => {
  it("shows a node selection on an opaque block as a DOM range around it, and keeps it", () => {
    const { host, editor } = mount([p(text("a")), table, p(text("b"))], true);
    editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 3)));
    const block = host.querySelector(".foli-selected-node") as HTMLElement;
    expect(block.textContent).toBe("cell");
    const sel = document.getSelection() as globalThis.Selection;
    expect(sel.anchorNode).toBe(block.parentNode);
    expect(sel.focusOffset - sel.anchorOffset).toBe(1);
    // Reading the DOM back keeps the node selection (selectionchange does not replace it).
    document.dispatchEvent(new Event("selectionchange"));
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    editor.select(1);
    expect(block.classList.contains("foli-selected-node")).toBe(false);
  });

  it("selects a paragraph on triple-click", () => {
    const { host, editor } = mount([p(text("one")), p(text("two"))]);
    const second = host.querySelectorAll("p")[1] as HTMLElement;
    second.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 3 }));
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(TextSelection);
    expect(editor.state.doc.textBetween(selection.from, selection.to)).toBe("two");
  });

  it("shows select-all in a document that starts with a numbered paragraph inside its text", () => {
    const { editor } = mount([ul(item(p(text("first"))), item(p(text("last"))))]);
    editor.commands.selectAll();
    const sel = document.getSelection() as globalThis.Selection;
    // Not in the list number (not editable) before the text.
    expect(sel.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(sel.anchorNode?.textContent).toBe("first");
    expect(sel.focusNode?.textContent).toBe("last");
  });
});

describe("EditorView links on a schema v3 document", () => {
  const linked = (href: string): NodeJSON => ({
    type: "text",
    text: "go",
    marks: [{ type: "link", attrs: { href } }],
  });

  it("a click on a link does not navigate; Ctrl+click opens it; a middle click opens nothing", () => {
    const { host } = mount([p(linked("https://x.test/"))], true);
    const link = host.querySelector("a") as HTMLAnchorElement;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    // Ctrl+click (Cmd on Apple platforms) opens the model's href in a new tab, without opener.
    const ctrl = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    (link.firstElementChild as HTMLElement).dispatchEvent(ctrl);
    expect(ctrl.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://x.test/", "_blank", "noopener,noreferrer");
    const aux = new MouseEvent("auxclick", { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it("an unsafe link target is plain text: Ctrl+click opens nothing", () => {
    const { host } = mount([p(linked("javascript:alert(1)"))], true);
    expect(host.querySelector("a")).toBeNull();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const span = host.querySelector("p span") as HTMLElement;
    span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    // Not even inside an <a> someone else put there (an extension), before the view restores it.
    const a = document.createElement("a");
    span.replaceWith(a);
    a.append(span);
    span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

describe("EditorView list input on a schema v3 document", () => {
  it("an insertParagraph input (no keydown, e.g. Android) in an empty list paragraph ends the list", () => {
    const { host, editor } = mount([ul(item(p(text("a"))), item(p()))]);
    editor.select(4); // the empty second paragraph
    beforeInput(host, "insertParagraph");
    expect(numbered(editor)).toEqual([true, false]);
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("a deleteContentBackward input at a list paragraph's start removes its number", () => {
    const { host, editor } = mount([ul(item(p(text("a"))), item(p(text("b"))))]);
    editor.select(4); // the start of "b"
    beforeInput(host, "deleteContentBackward");
    expect(numbered(editor)).toEqual([true, false]);
    expect(editor.state.doc.textContent).toBe("ab");
  });
});
