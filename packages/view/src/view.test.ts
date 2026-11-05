// @vitest-environment jsdom
import { createDocument, createEditor, type DocJSON } from "@foli/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView, type EditorViewOptions, keyName } from "./index.js";

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

function mount(content: DocJSON = sample, options?: EditorViewOptions) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({ document: createDocument(content) });
  const view = new EditorView(host, editor, options);
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

  it("restores the host on destroy", () => {
    const { host, view } = mount();
    view.destroy();
    expect(host.getAttributeNames()).toEqual([]);
    expect(host.childNodes).toHaveLength(0);
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

  it("follows the caret back to a point the view wrote earlier", () => {
    const { host, editor } = focused();
    const text = host.firstChild?.firstChild as Node;
    editor.select(3); // the view writes the caret at the end of "ab"
    document.getSelection()?.collapse(text, 1);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    expect(editor.state.selection.head).toBe(2);
    document.getSelection()?.collapse(text, 2); // back to the written point
    host.dispatchEvent(
      new InputEvent("beforeinput", { inputType: "insertText", data: "x", cancelable: true }),
    );
    expect(host.textContent).toBe("abx");
  });

  it("does not stay in composition when focus leaves without compositionend", () => {
    const { host } = focused();
    host.dispatchEvent(new CompositionEvent("compositionstart"));
    host.dispatchEvent(new FocusEvent("blur"));
    const event = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "c",
      cancelable: true,
    });
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).toBe("acb");
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

  it("shows carets and selections at grapheme-cluster boundaries", () => {
    const { host, editor, view } = mount({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a👍🏽b" }] }],
    });
    view.focus();
    const text = host.firstChild?.firstChild as Node;
    const sel = document.getSelection();
    editor.select(4); // between 👍 and its skin tone: inside the cluster
    expect([sel?.focusNode, sel?.focusOffset]).toEqual([text, 1]);
    editor.select(7, 4); // backwards from after "b" into the cluster: covers all of it
    expect([sel?.anchorOffset, sel?.focusOffset]).toEqual([6, 1]);
    editor.select(4);
    host.dispatchEvent(
      new InputEvent("beforeinput", { inputType: "insertText", data: "x", cancelable: true }),
    );
    expect(editor.state.doc.textContent).toBe("ax👍🏽b");
  });

  it("leaves word and line deletion keys to the browser's beforeinput", () => {
    const { host, editor } = mount({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "one two" }] }],
    });
    host.focus();
    editor.select(8);
    const key = new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true, cancelable: true });
    host.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    const input = (inputType: string) =>
      host.dispatchEvent(new InputEvent("beforeinput", { inputType, cancelable: true }));
    input("deleteWordBackward"); // no target range: the core's word boundaries
    expect(editor.state.doc.textContent).toBe("one ");
  });

  it("deletes to the line edge the browser finds when a line delete has no target range", () => {
    const { host, editor } = mount({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "one two" }] }],
    });
    host.focus();
    editor.select(5);
    const input = () =>
      host.dispatchEvent(
        new InputEvent("beforeinput", { inputType: "deleteSoftLineBackward", cancelable: true }),
      );
    input(); // jsdom has no Selection.modify: nothing, rather than one character
    expect(editor.state.doc.textContent).toBe("one two");
    const proto = Selection.prototype as { modify?: unknown };
    proto.modify = function (this: Selection, _alter: string, direction: string) {
      const node = this.focusNode as Node;
      this.extend(node, direction === "backward" ? 0 : (node.textContent?.length ?? 0));
    };
    try {
      input();
    } finally {
      delete proto.modify;
    }
    expect(editor.state.doc.textContent).toBe("two");
  });
});

describe("EditorView DOM read-back", () => {
  const paragraphs = (...texts: string[]): DocJSON => ({
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });
  const texts = (editor: ReturnType<typeof mount>["editor"]) =>
    editor
      .getDocument()
      .content.content.map((b) =>
        (b.content ?? []).map((i) => ("text" in i ? i.text : "")).join(""),
      );
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  function composing(content: DocJSON, caret: number) {
    const setup = mount(content);
    setup.view.focus();
    setup.editor.select(caret);
    setup.host.dispatchEvent(new CompositionEvent("compositionstart"));
    return setup;
  }

  it("reads a committed composition back as one undoable insertion", () => {
    const { host, editor } = composing(paragraphs("ab"), 3);
    const text = host.querySelector("p")?.firstChild as Text;
    text.data = "abé"; // what a dead key or IME leaves in the DOM
    document.getSelection()?.collapse(text, 3);
    host.dispatchEvent(new CompositionEvent("compositionend"));
    expect(texts(editor)).toEqual(["abé"]);
    expect(editor.state.selection.head).toBe(4);
    expect(host.querySelector("p")?.firstChild).not.toBe(text); // re-rendered from the model
    editor.commands.undo();
    expect(texts(editor)).toEqual(["ab"]);
  });

  it("places an ambiguous insertion at the DOM caret", () => {
    const { host, editor } = composing(paragraphs("aa"), 2);
    const text = host.querySelector("p")?.firstChild as Text;
    text.data = "aaa";
    document.getSelection()?.collapse(text, 2);
    host.dispatchEvent(new CompositionEvent("compositionend"));
    expect(texts(editor)).toEqual(["aaa"]);
    expect(editor.state.selection.head).toBe(3);
  });

  it("reads back a composition that replaced a selection across blocks", () => {
    const { host, editor } = composing(paragraphs("ab", "cd"), 2);
    const [first, second] = [...host.querySelectorAll("p")] as HTMLElement[];
    // The browser deleted "b|c" (merging the blocks) and inserted the composed "X".
    (first?.firstChild as Text).data = "aXd";
    second?.remove();
    document.getSelection()?.collapse(first?.firstChild as Text, 2);
    host.dispatchEvent(new CompositionEvent("compositionend"));
    expect(texts(editor)).toEqual(["aXd"]);
    editor.commands.undo();
    expect(texts(editor)).toEqual(["ab", "cd"]);
  });

  it("reads back an unprevented change outside composition", async () => {
    const { host, editor } = mount(paragraphs("ab"));
    (host.querySelector("p")?.firstChild as Text).data = "abc";
    await settle();
    expect(texts(editor)).toEqual(["abc"]);
  });

  it("restores DOM that changed without changing the text", async () => {
    const { host, editor } = mount(paragraphs("ab"));
    const p = host.querySelector("p") as HTMLElement;
    const span = document.createElement("span");
    span.append(p.firstChild as Node);
    p.append(span);
    await settle();
    expect(host.innerHTML).toBe("<p>ab</p>");
    expect(texts(editor)).toEqual(["ab"]);
  });

  it("discards a change that adds blocks, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, editor } = mount(paragraphs("ab"));
    const extra = document.createElement("p");
    extra.textContent = "x";
    host.append(extra);
    await settle();
    expect(host.innerHTML).toBe("<p>ab</p>");
    expect(texts(editor)).toEqual(["ab"]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("replaces only the changed text, not the text up to the caret", async () => {
    const { host, editor, view } = mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "teh " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "ab" }, { type: "hardBreak" }] },
      ],
    });
    view.focus();
    editor.select(9); // caret at the end of "bold"
    (host.querySelector("p")?.firstChild as Text).data = "the "; // autocorrect, extension…
    await settle();
    expect(editor.getDocument().content.content[0]?.content).toEqual([
      { type: "text", text: "the " },
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
    ]);
  });

  it("reads back a change before the caret across a block or a hard break", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, editor, view } = mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "hardBreak" },
            { type: "text", text: "b" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "cd" }] },
      ],
    });
    view.focus();
    editor.select(8); // end of "cd"
    (host.querySelector("p")?.firstChild as Text).data = "aX";
    await settle();
    expect(texts(editor)).toEqual(["aXb", "cd"]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps a composition that a render of another block interrupted", () => {
    const { host, editor } = composing(paragraphs("ab", "cd"), 3);
    const text = host.querySelector("p")?.firstChild as Text;
    text.data = "abX";
    editor.dispatch(editor.state.tr.insertText("!", 7)); // e.g. a remote change to "cd"
    document.getSelection()?.collapse(text, 3);
    host.dispatchEvent(new CompositionEvent("compositionend"));
    expect(texts(editor)).toEqual(["abX", "cd!"]);
  });

  it("removes an empty stray node without a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host } = mount(paragraphs("ab"));
    host.append(document.createElement("span"));
    await settle();
    expect(host.innerHTML).toBe("<p>ab</p>");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not read back its own rendering", async () => {
    const { editor } = mount(paragraphs("ab"));
    editor.select(3);
    editor.commands.insertText("c");
    await settle();
    expect(texts(editor)).toEqual(["abc"]);
    editor.commands.undo();
    expect(texts(editor)).toEqual(["ab"]);
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

describe("EditorView options", () => {
  const empty: DocJSON = { type: "doc", content: [{ type: "paragraph" }] };
  const one = (text: string): DocJSON => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it("read-only: not editable, marked aria-readonly, still focusable", () => {
    const { host, view } = mount(one("ab"), { editable: false });
    expect(host.getAttribute("contenteditable")).toBe("false");
    expect(host.getAttribute("aria-readonly")).toBe("true");
    expect(host.tabIndex).toBe(0);
    view.setOptions({ editable: true });
    expect(host.getAttribute("contenteditable")).toBe("true");
    expect(host.hasAttribute("aria-readonly")).toBe(false);
  });

  it("read-only: drops edits from input, keys, paste, cut and read-back", async () => {
    const { host, editor, view } = mount(one("ab"), { editable: false });
    host.focus();
    editor.select(1, 3);
    const ctrl = { ctrlKey: true, cancelable: true };
    host.dispatchEvent(
      new InputEvent("beforeinput", { inputType: "insertText", data: "x", cancelable: true }),
    );
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ...ctrl }));
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }));
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(view.paste({ getData: (type) => (type === "text/plain" ? "pasted" : "") })).toBe(false);
    // jsdom has no ClipboardEvent: a plain event carrying clipboard data.
    const cut = Object.assign(new Event("cut", { cancelable: true }), {
      clipboardData: { setData: () => {} },
    });
    host.dispatchEvent(cut);
    expect(cut.defaultPrevented).toBe(true); // copied, not deleted
    // A DOM change the browser was not supposed to make is undone, not read back.
    (host.querySelector("p")?.firstChild as Text).data = "abc";
    await settle();
    expect(host.innerHTML).toBe("<p>ab</p>");
    expect(editor.state.doc.textContent).toBe("ab");
    // Mod+B on a caret would only store a mark: dropped too.
    editor.select(2);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ...ctrl }));
    expect(editor.state.storedMarks).toBeNull();
    // Selection still works, and code can still change the document.
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ...ctrl }));
    expect(editor.state.selection.from).toBe(0);
    editor.commands.insertText("z");
    expect(host.textContent).toBe("z");
  });

  it("shows the placeholder only on an empty document, never during composition", () => {
    const { host, editor, view } = mount(empty, { placeholder: "Write…" });
    const marked = () =>
      host.querySelector("[data-foli-placeholder]")?.getAttribute("data-foli-placeholder");
    expect(host.getAttribute("aria-placeholder")).toBe("Write…");
    expect(marked()).toBe("Write…");
    expect(document.head.querySelectorAll("style[data-foli]")).toHaveLength(1);
    host.focus();
    editor.commands.insertText("a");
    expect(marked()).toBeUndefined();
    editor.commands.deleteBackward();
    expect(marked()).toBe("Write…");
    host.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(marked()).toBeUndefined();
    host.dispatchEvent(new CompositionEvent("compositionend"));
    expect(marked()).toBe("Write…");
    editor.commands.splitBlock();
    expect(marked()).toBeUndefined();
    view.setOptions({ placeholder: "" });
    editor.setDocument(createDocument());
    expect(marked()).toBeUndefined();
    expect(host.hasAttribute("aria-placeholder")).toBe(false);
  });

  it("adds its stylesheet once per document", () => {
    mount(empty, { placeholder: "a" });
    mount(empty, { placeholder: "b" });
    expect(document.head.querySelectorAll("style[data-foli]")).toHaveLength(1);
  });

  it("focus from the keyboard or code shows the model selection", () => {
    const { host, editor } = mount(one("abc"));
    editor.select(3);
    const outside = document.createElement("span");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    document.getSelection()?.selectAllChildren(outside);
    host.focus();
    const sel = document.getSelection();
    expect(sel?.focusNode).toBe(host.querySelector("p")?.firstChild);
    expect(sel?.focusOffset).toBe(2);

    // Focus again (window or tab switch) with the selection already shown: nothing is
    // rewritten and nothing scrolls.
    const write = vi.spyOn(Selection.prototype, "setBaseAndExtent");
    host.dispatchEvent(new FocusEvent("focus"));
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();

    // The click half (no restore after a mousedown) needs real focus: e2e view-options.
    outside.remove();
  });

  it("a mousedown that focuses nothing does not skip the next keyboard focus", async () => {
    const { host, editor } = mount(one("abc"));
    editor.select(3);
    host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); // no focus follows
    await new Promise((resolve) => setTimeout(resolve));
    const outside = document.createElement("span");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    document.getSelection()?.selectAllChildren(outside);
    host.focus();
    expect(document.getSelection()?.focusOffset).toBe(2);
    outside.remove();
  });

  it("restores the host's own tabindex and the attributes it added on destroy", () => {
    const host = document.createElement("div");
    host.tabIndex = -1;
    document.body.append(host);
    const view = new EditorView(host, createEditor(), { editable: false, placeholder: "x" });
    view.destroy();
    expect(host.getAttributeNames()).toEqual(["tabindex"]);
    expect(host.tabIndex).toBe(-1);
    host.remove();
  });
});
