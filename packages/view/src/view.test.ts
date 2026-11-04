// @vitest-environment jsdom
import { createDocument, createEditor, type DocJSON } from "@foli/core";
import { afterEach, describe, expect, it } from "vitest";
import { EditorView, keyName } from "./index.js";

const sample: DocJSON = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "a", marks: [{ type: "bold" }, { type: "italic" }] },
        { type: "hardBreak" },
        { type: "text", text: "bc" },
        { type: "text", text: "d", marks: [{ type: "bold" }] },
      ],
    },
    { type: "paragraph" },
    { type: "paragraph", content: [{ type: "text", text: "x" }, { type: "hardBreak" }] },
  ],
};

let views: EditorView[] = [];
afterEach(() => {
  for (const view of views) {
    view.destroy();
    view.host.remove();
  }
  views = [];
});

function mount(content: DocJSON = sample) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({ document: createDocument(content) });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}

describe("EditorView rendering", () => {
  it("renders blocks, nested marks and hard breaks into an editable textbox", () => {
    const { host } = mount();
    expect(host.getAttribute("contenteditable")).toBe("true");
    expect(host.getAttribute("role")).toBe("textbox");
    expect(host.innerHTML).toBe(
      "<h2>Title</h2><p><strong><em>a</em></strong><br>bc<strong>d</strong></p>" +
        "<p><br></p><p>x<br><br></p>",
    );
  });

  it("never interprets text as markup", () => {
    const { host } = mount({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] },
      ],
    });
    expect(host.innerHTML).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });

  it("reuses the DOM of unchanged blocks and drops stray nodes", () => {
    const { host, editor } = mount();
    const before = [...host.children];
    host.append(document.createElement("div"));
    editor.select(17);
    editor.commands.insertText("y");
    const after = [...host.children];
    expect(after).toHaveLength(4);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(after[3]).not.toBe(before[3]);
    expect(after[3]?.textContent).toBe("yx");
  });

  it("re-renders on setDocument", () => {
    const { host, editor } = mount();
    editor.setDocument(createDocument());
    expect(host.innerHTML).toBe("<p><br></p>");
  });
});

describe("EditorView position mapping", () => {
  it("round-trips every position inside a textblock", () => {
    const { editor, view } = mount();
    const { doc } = editor.state;
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      for (let p = pos + 1; p <= pos + 1 + node.content.size; p++) {
        const point = view.domFromPos(p);
        expect(view.posFromDOM(point.node, point.offset), `pos ${p}`).toBe(p);
      }
      return false;
    });
  });

  it("maps element points to the next leaf, else the block end", () => {
    const { host, view } = mount();
    const p = host.children[1] as HTMLElement;
    expect(view.posFromDOM(p, 0)).toBe(8); // before <strong>a</strong>
    expect(view.posFromDOM(p, 1)).toBe(9); // before the hard break
    expect(view.posFromDOM(p, 4)).toBe(13); // end of the paragraph
    expect(view.posFromDOM(host.children[2] as HTMLElement, 0)).toBe(15); // empty block
    expect(view.posFromDOM(host.children[3] as HTMLElement, 2)).toBe(19); // after a trailing break
    expect(view.posFromDOM(host, 1)).toBe(7); // between blocks
    expect(view.posFromDOM(document.body, 0)).toBeNull();
  });

  it("keeps a caret at a mark boundary in the text before it", () => {
    const { view } = mount();
    const point = view.domFromPos(12); // between "bc" and bold "d"
    expect(point.node.textContent).toBe("bc");
    expect(point.offset).toBe(2);
  });
});

describe("EditorView input", () => {
  function focused() {
    const setup = mount({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }],
    });
    setup.view.focus();
    setup.editor.select(2);
    return setup;
  }

  it("writes the model selection to the DOM and reads it back on demand", () => {
    const { host, editor } = focused();
    const sel = document.getSelection();
    expect(sel?.focusNode).toBe(host.firstChild?.firstChild);
    expect(sel?.focusOffset).toBe(1);
    sel?.collapse(host.firstChild?.firstChild as Node, 0);
    // No selectionchange has run yet: the keydown handler reads the live DOM selection itself.
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(editor.getDocument().content.content).toHaveLength(2);
    expect(editor.state.selection.head).toBe(3);
  });

  it("dispatches beforeinput insertText and prevents the native edit", () => {
    const { host, editor } = focused();
    const event = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "c",
      cancelable: true,
    });
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).toBe("acb");
    expect(editor.state.selection.head).toBe(3);
  });

  it("runs keymap commands from keydown", () => {
    const { host, editor } = focused();
    const ctrl = { ctrlKey: true, cancelable: true }; // Mod outside Apple platforms (jsdom)
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ...ctrl }));
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ...ctrl }));
    expect(host.innerHTML).toBe("<p><strong>ab</strong></p>");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }));
    expect(editor.state.doc.textContent).toBe("");
  });
});

describe("keyName", () => {
  const key = (init: KeyboardEventInit) => keyName(new KeyboardEvent("keydown", init));

  it("orders modifiers and lower-cases characters", () => {
    expect(key({ key: "Enter", shiftKey: true })).toBe("Shift-Enter");
    expect(key({ key: "Z", ctrlKey: true, shiftKey: true })).toMatch(/^(Mod|Ctrl)-Shift-z$/);
    expect(key({ key: "a" })).toBe("a");
  });

  it("falls back to the physical key on non-Latin layouts", () => {
    expect(key({ key: "и", code: "KeyB", ctrlKey: true })).toMatch(/^(Mod|Ctrl)-/);
    expect(key({ key: "и", code: "KeyB", ctrlKey: true })).not.toContain("и");
  });
});
