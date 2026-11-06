// @vitest-environment jsdom
import { createDocument, createEditor, type DocJSON } from "@foli/core";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
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
  vi.unstubAllGlobals();
  for (const view of views) {
    view.destroy();
    view.host.remove();
  }
  views = [];
});

/** The rendered blocks, in order, across pages. */
const blocks = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>(":scope > .foli-page > *"),
];
/** The blocks' markup, without the page elements around them. */
const html = (host: HTMLElement) =>
  blocks(host)
    .map((block) => block.outerHTML)
    .join("");

/**
 * jsdom has no ResizeObserver, and its frames are not driven by the test: fakes for both. Like
 * the real one, `fire` reports each observed element once when first observed, then only when
 * its size changed.
 */
function fakeResizeObserver() {
  const fake = {
    /** Reports the elements whose size changed (`contentRect.width` 0: a hidden host). */
    fire: (_width?: number) => {},
    queue: [] as (() => void)[],
    /** Runs the animation-frame callbacks queued before it. */
    frame() {
      const due = fake.queue;
      fake.queue = [];
      for (const callback of due) callback();
    },
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      /** Each observed element and its last reported size. */
      readonly targets = new Map<Element, string | undefined>();
      constructor(callback: ResizeObserverCallback) {
        fake.fire = (width = 600) => {
          const entries: ResizeObserverEntry[] = [];
          for (const [target, last] of this.targets) {
            const size = `${width}x${target.getBoundingClientRect().height}`;
            if (size === last) continue;
            this.targets.set(target, size);
            entries.push({ target, contentRect: { width } } as ResizeObserverEntry);
          }
          if (entries.length) callback(entries, this as unknown as ResizeObserver);
        };
      }
      observe(target: Element) {
        this.targets.set(target, undefined);
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => fake.queue.push(callback));
  return fake;
}

/** Layout reads of block elements (not of pages: the zoom scale comes from a page) by a spy. */
const blockReads = (spy: { mock: { contexts: unknown[] } }) =>
  spy.mock.contexts.filter((el) => !(el as Element).classList.contains("foli-page")).length;

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
    expect(html(host)).toBe(
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
    expect(html(host)).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });

  it("reuses the DOM of unchanged blocks and drops stray nodes", () => {
    const { host, editor } = mount();
    const before = blocks(host);
    host.append(document.createElement("div"));
    editor.select(17);
    editor.commands.insertText("y");
    const after = blocks(host);
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
    expect(html(host)).toBe("<p><br></p>");
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
    const p = blocks(host)[1] as HTMLElement;
    expect(view.posFromDOM(p, 0)).toBe(8); // before <strong>a</strong>
    expect(view.posFromDOM(p, 1)).toBe(9); // before the hard break
    expect(view.posFromDOM(p, 4)).toBe(13); // end of the paragraph
    expect(view.posFromDOM(blocks(host)[2] as HTMLElement, 0)).toBe(15); // empty block
    expect(view.posFromDOM(blocks(host)[3] as HTMLElement, 2)).toBe(19); // after a trailing break
    expect(view.posFromDOM(host.firstChild as Node, 1)).toBe(7); // between blocks (in a page)
    expect(view.posFromDOM(host, 1)).toBe(20); // after the last page: the document end
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
    expect(sel?.focusNode).toBe(blocks(host)[0]?.firstChild);
    expect(sel?.focusOffset).toBe(1);
    sel?.collapse(blocks(host)[0]?.firstChild as Node, 0);
    // No selectionchange has run yet: the keydown handler reads the live DOM selection itself.
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(editor.getDocument().content.content).toHaveLength(2);
    expect(editor.state.selection.head).toBe(3);
  });

  it("follows the caret back to a point the view wrote earlier", () => {
    const { host, editor } = focused();
    const text = blocks(host)[0]?.firstChild as Node;
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
    expect(html(host)).toBe("<p><strong>ab</strong></p>");
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }));
    expect(editor.state.doc.textContent).toBe("");
  });

  it("shows carets and selections at grapheme-cluster boundaries", () => {
    const { host, editor, view } = mount({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a👍🏽b" }] }],
    });
    view.focus();
    const text = blocks(host)[0]?.firstChild as Node;
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
    expect(html(host)).toBe("<p>ab</p>");
    expect(texts(editor)).toEqual(["ab"]);
  });

  it("discards a change that adds blocks, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, editor } = mount(paragraphs("ab"));
    const extra = document.createElement("p");
    extra.textContent = "x";
    host.append(extra);
    await settle();
    expect(html(host)).toBe("<p>ab</p>");
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
    expect(html(host)).toBe("<p>ab</p>");
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
    expect(html(host)).toBe("<p>ab</p>");
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

describe("EditorView pages", () => {
  const paragraphs = (...texts: string[]): DocJSON => ({
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });
  /** jsdom lays nothing out: every block is 400px tall (A4 content box: about 930px). */
  function tall() {
    return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const height = this.parentElement?.classList.contains("foli-page") ? 400 : 0;
      return { height, width: 0, top: 0, left: 0, bottom: height, right: 0 } as DOMRect;
    });
  }
  const pageTexts = (host: HTMLElement) =>
    [...host.querySelectorAll(".foli-page")].map((page) =>
      [...page.children].map((block) => block.textContent),
    );
  afterEach(() => vi.restoreAllMocks());

  it("measures only the blocks an edit changed", () => {
    const spy = tall();
    const texts = Array.from({ length: 30 }, (_, i) => `p${i}`);
    const { host, editor } = mount(paragraphs(...texts));
    expect(host.querySelectorAll(".foli-page")).toHaveLength(15);
    spy.mockClear();
    editor.select(2); // in "p0"
    editor.commands.insertText("x");
    // The changed block, once: the 29 others keep their measurement.
    expect(blockReads(spy)).toBeLessThanOrEqual(2);
    expect(pageTexts(host)[0]).toEqual(["px0", "p1"]);
    spy.mockClear();
    // A new block in the middle shifts every later block to another page: heights come from
    // the cache; only blocks that now cross a page end have their lines measured, once each.
    /** The position at the end of block `index`'s content. */
    const endOf = (index: number) => {
      let pos = 0;
      for (let i = 0; i <= index; i++) pos += editor.state.doc.child(i).nodeSize;
      return pos - 1;
    };
    editor.select(endOf(15)); // end of "p15"
    editor.commands.splitBlock();
    expect(blockReads(spy)).toBeLessThan(texts.length);
    expect(pageTexts(host).flat()).toEqual(["px0", ...texts.slice(1, 16), "", ...texts.slice(16)]);
    expect(pageTexts(host).every((page) => page.length <= 2)).toBe(true);
    spy.mockClear();
    editor.select(endOf(20)); // end of "p19", after the new block
    editor.commands.insertText("y");
    expect(blockReads(spy)).toBeLessThanOrEqual(2);
  });

  describe("blocks resized without an edit", () => {
    let ro: ReturnType<typeof fakeResizeObserver>;
    let height = 400;
    function setup() {
      ro = fakeResizeObserver();
      height = 400;
      const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
        this: Element,
      ) {
        const h = this.parentElement?.classList.contains("foli-page") ? height : 0;
        return { height: h, width: 0, top: 0, left: 0, bottom: h, right: 0 } as DOMRect;
      });
      const mounted = mount(paragraphs("a", "b", "c", "d"));
      ro.fire(); // the first reports, as rendered
      return { spy, ...mounted };
    }

    it("re-measures each resized block once and re-flows", () => {
      const { spy, host } = setup();
      expect(pageTexts(host)).toEqual([
        ["a", "b"],
        ["c", "d"],
      ]);
      height = 500;
      ro.fire();
      spy.mockClear();
      ro.frame();
      expect(pageTexts(host)).toEqual([["a"], ["b"], ["c"], ["d"]]);
      // Four blocks, one measurement each (no repeat while the flow asks for lines).
      expect(blockReads(spy)).toBeLessThanOrEqual(4 * 2);
    });

    it("does not re-flow for a hidden host", () => {
      const { host } = setup();
      height = 0; // display: none
      ro.fire(0);
      expect(ro.queue).toHaveLength(0);
      expect(pageTexts(host)).toEqual([
        ["a", "b"],
        ["c", "d"],
      ]);
    });
  });

  it("prints one sheet of the document's page size per page, and cleans up", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = createDocument(paragraphs("a"), {
      pageSize: { width: 216, height: 279 },
      margins: { top: 10, right: 20, bottom: 30, left: 40 },
    });
    const view = new EditorView(host, createEditor({ document: doc }));
    const styles = () => document.head.querySelectorAll("style[data-foli-print]");
    expect(styles()).toHaveLength(1);
    const css = styles()[0]?.textContent ?? "";
    expect(css).toContain("@page{size:216mm 279mm;margin:0}");
    // Page rules for this view's pages only: another editor keeps its own page height.
    const id = host.getAttribute("data-foli-view");
    expect(css).toContain(`[data-foli-view="${id}"]>.foli-page{height:279mm!important`);
    expect(css).toContain("break-after:page");
    view.destroy();
    host.remove();
    expect(styles()).toHaveLength(0);
    expect(host.hasAttribute("data-foli-view")).toBe(false);
  });

  it("adds the print page rules to a shadow root holding the host", () => {
    const outer = document.createElement("div");
    document.body.append(outer);
    const shadow = outer.attachShadow({ mode: "open" });
    const host = document.createElement("div");
    shadow.append(host);
    const view = new EditorView(host, createEditor({ document: createDocument(paragraphs("a")) }));
    expect(shadow.querySelectorAll("style[data-foli-print]")).toHaveLength(1);
    expect(document.head.querySelectorAll("style[data-foli-print]")).toHaveLength(1);
    view.destroy();
    outer.remove();
    expect(shadow.querySelectorAll("style[data-foli-print]")).toHaveLength(0);
  });

  it("renders page elements with the document's size and margins", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = createDocument(paragraphs("a"), {
      pageSize: { width: 216, height: 279 },
      margins: { top: 10, right: 20, bottom: 30, left: 40 },
    });
    const view = new EditorView(host, createEditor({ document: doc }));
    views.push(view);
    const page = host.firstElementChild as HTMLElement;
    expect(page.tagName).toBe("SECTION");
    expect(page.className).toBe("foli-page");
    expect(page.style.width).toBe("216mm");
    expect(page.style.minHeight).toBe("279mm");
    expect(page.style.padding).toBe("10mm 20mm 30mm 40mm");
    expect(host.children).toHaveLength(1);
  });

  it("flows whole blocks into pages by measured height and back", () => {
    tall();
    const { host, editor } = mount(paragraphs("a", "b", "c", "d", "e"));
    expect(pageTexts(host)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    // Enter at the end of "b" pushes everything after it one block down.
    editor.select(5);
    expect(editor.commands.splitBlock()).toBe(true);
    expect(pageTexts(host)).toEqual([
      ["a", "b"],
      ["", "c"],
      ["d", "e"],
    ]);
    editor.commands.undo();
    expect(pageTexts(host)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    editor.commands.selectAll();
    editor.commands.deleteSelection();
    expect(pageTexts(host)).toEqual([[""]]);
  });

  it("maps positions and reads DOM changes back across pages", async () => {
    tall();
    const { host, editor, view } = mount(paragraphs("a", "b", "c"));
    const third = host.querySelectorAll(".foli-page")[1]?.firstElementChild as HTMLElement;
    expect(view.posFromDOM(third.firstChild as Node, 1)).toBe(8);
    expect(view.posFromDOM(host.lastChild as Node, 0)).toBe(6); // page 2, before "c"
    expect(view.domFromPos(8).node).toBe(third.firstChild);
    (third.firstChild as Text).data = "cx";
    await new Promise((resolve) => setTimeout(resolve));
    expect(editor.state.doc.textContent).toBe("abcx");
    expect(pageTexts(host)).toEqual([["a", "b"], ["cx"]]);
  });

  it("keeps blocks on their pages during a composition and flows them after", () => {
    tall();
    const { host, editor, view } = mount(paragraphs("a", "b"));
    view.focus();
    editor.select(2);
    host.dispatchEvent(new CompositionEvent("compositionstart"));
    editor.commands.splitBlock(); // a change while composing (e.g. from code)
    expect(pageTexts(host)).toEqual([["a", "", "b"]]);
    // compositionend flows what the composition skipped (here through the read-back of the
    // render's own records; with no records, onCompositionEnd renders itself).
    host.dispatchEvent(new CompositionEvent("compositionend"));
    expect(pageTexts(host)).toEqual([["a", ""], ["b"]]);
  });

  it("puts back blocks unwrapped from their page, or a whole unwrapped page", async () => {
    tall();
    const { host, editor } = mount(paragraphs("a", "b", "c"));
    const [first, second] = [...host.querySelectorAll(".foli-page")] as HTMLElement[];
    host.append(second?.firstElementChild as Node); // "c" now loose in the host
    (first?.children[1]?.firstChild as Text).data = "bz"; // and a native edit elsewhere
    await new Promise((resolve) => setTimeout(resolve));
    expect(editor.state.doc.textContent).toBe("abzc");
    expect(pageTexts(host)).toEqual([["a", "bz"], ["c"]]);

    // An extension unwraps page 1: its blocks are loose in the host, before page 2.
    const page = host.firstElementChild as HTMLElement;
    page.replaceWith(...page.childNodes);
    ((host.lastElementChild as HTMLElement).firstElementChild?.firstChild as Text).data = "cy";
    await new Promise((resolve) => setTimeout(resolve));
    expect(editor.state.doc.textContent).toBe("abzcy");
    expect(pageTexts(host)).toEqual([["a", "bz"], ["cy"]]);
    expect(host.children).toHaveLength(2);
  });

  it("removes stray DOM in the host and in pages", () => {
    const { host, editor } = mount(paragraphs("a"));
    host.append(document.createElement("div"));
    host.firstElementChild?.append(document.createElement("span"));
    editor.commands.insertText("b");
    expect(host.children).toHaveLength(1);
    expect(html(host)).toBe("<p>ba</p>");
  });
});

describe("EditorView split blocks", () => {
  const paragraphs = (...texts: string[]): DocJSON => ({
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });
  /**
   * Fake layout: 10 characters per line, lines 100px apart (glyph boxes 10..90 within each);
   * a block is as tall as its lines. The A4 content box (about 930px) holds 9 lines.
   */
  let perLine = 10;
  /** The height in lines of a block whose text is "x" (as if CSS resized it). */
  let xLines = 1;
  /** Vertical padding of every block element, repeated by each fragment of a split block. */
  let padding = 0;
  function lines() {
    const linesOf = (el: Element) =>
      el.textContent === "x"
        ? xLines
        : Math.max(1, Math.ceil((el.textContent ?? "").length / perLine));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const height = this.parentElement?.classList.contains("foli-page")
        ? linesOf(this) * 100 + padding
        : 0;
      return { height, width: 0, top: 0, left: 0, bottom: height, right: 0 } as DOMRect;
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Range) {
        // Offset within the fragment: the text before this node in its fragment, plus the offset.
        let offset = this.startOffset;
        const fragment = this.startContainer.parentElement?.closest(".foli-page > *");
        const walker = document.createTreeWalker(fragment as Node, NodeFilter.SHOW_TEXT);
        for (
          let node = walker.nextNode();
          node && node !== this.startContainer;
          node = walker.nextNode()
        )
          offset += (node as Text).length;
        const top = Math.floor(offset / perLine) * 100 + 10;
        return { top, bottom: top + 80, height: 80, left: 0, right: 0, width: 0 } as DOMRect;
      },
    });
  }
  afterEach(() => {
    vi.restoreAllMocks();
    perLine = 10;
    xLines = 1;
    padding = 0;
    // biome-ignore lint/suspicious/noExplicitAny: removes the fake added above.
    delete (Range.prototype as any).getBoundingClientRect;
  });
  const fragments = (host: HTMLElement) =>
    [...host.querySelectorAll(".foli-page")].map((page) =>
      [...page.children].map(
        (el) => `${el.getAttribute("data-fragment") ?? "-"}:${el.textContent}`,
      ),
    );
  const long = "abcdefghij".repeat(15); // 15 lines

  it("splits a block that crosses the page end at a line, and joins it again", () => {
    lines();
    const { host, editor } = mount(paragraphs("x", long));
    // "x" takes 1 line, so 8 lines (80 characters) of the long block fit on page 1.
    expect(fragments(host)).toEqual([["-:x", `0:${long.slice(0, 80)}`], [`1:${long.slice(80)}`]]);
    const [first, second] = host.querySelectorAll<HTMLElement>("[data-fragment]");
    expect(first?.style.marginBottom).toBe("0px");
    expect(second?.style.marginTop).toBe("0px");
    // Deleting "x" frees a line: the split moves by 10 characters.
    editor.select(1, 2);
    editor.commands.deleteSelection();
    expect(fragments(host)).toEqual([["-:", `0:${long.slice(0, 80)}`], [`1:${long.slice(80)}`]]);
    editor.commands.joinForward();
    expect(fragments(host)).toEqual([[`0:${long.slice(0, 90)}`], [`1:${long.slice(90)}`]]);
    // Short enough to fit: one element again.
    editor.select(3, 3 + 100);
    editor.commands.deleteSelection();
    expect(fragments(host)).toEqual([[`-:${long.slice(0, 2)}${long.slice(102)}`]]);
  });

  it("measures a split block whole again when the fonts change its wrapping", async () => {
    lines();
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    try {
      const { host } = mount(paragraphs(long));
      expect(fragments(host)).toEqual([[`0:${long.slice(0, 90)}`], [`1:${long.slice(90)}`]]);
      // A narrower font: 12 characters per line, so 9 lines hold 108. Measured across the
      // old split, fragment 0 would end a line at 90 and the split would land at 102.
      perLine = 12;
      fonts.dispatchEvent(new Event("loadingdone"));
      await vi.waitFor(() =>
        expect(fragments(host)).toEqual([[`0:${long.slice(0, 108)}`], [`1:${long.slice(108)}`]]),
      );
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: removes the fake added above.
      delete (document as any).fonts;
    }
  });

  it("measures lines again when CSS resizes a block and rewraps another", () => {
    lines();
    const ro = fakeResizeObserver();
    const { host } = mount(paragraphs("x", long));
    ro.fire(); // the first reports, as rendered
    expect(fragments(host)).toEqual([["-:x", `0:${long.slice(0, 80)}`], [`1:${long.slice(80)}`]]);
    // A CSS change: "x" grows to two lines, and the long block rewraps at 10.5 characters per
    // line with the same 15 lines (same height, so its own size does not change). Lines
    // start at 0, 11, 21, 32, 42, 53, 63, 74…: 7 lines fit after "x", the split is at 74.
    xLines = 2;
    perLine = 10.5;
    ro.fire();
    ro.frame();
    expect(fragments(host)).toEqual([["-:x", `0:${long.slice(0, 74)}`], [`1:${long.slice(74)}`]]);
  });

  it("does not re-flow every frame when fragments add up to another height", () => {
    lines();
    padding = 20; // as the CSS below: each fragment keeps it
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = "p { padding: 10px 0 }";
    onTestFinished(() => style.remove());
    const ro = fakeResizeObserver();
    const { host, editor } = mount(paragraphs("x", long, long));
    const settle = () => {
      for (let i = 0; i < 4; i++) {
        ro.fire();
        ro.frame();
      }
      ro.fire();
      expect(ro.queue).toHaveLength(0);
    };
    settle();
    // An edit re-renders the first long block (same lines: the second keeps its DOM). Its new
    // fragments add up to more than its height: compared with the height alone, they would
    // mark it stale; its relayout would render the second again, whose new fragments would
    // mark it stale, and so on every frame.
    editor.select(4, 5); // the first character of the first long block
    editor.commands.insertText("z");
    settle();
    // A CSS change on "x" re-flows once, rendering both split blocks again.
    xLines = 2;
    settle();
    expect(fragments(host)[0]).toEqual(["-:x", `0:z${long.slice(1, 70)}`]);
  });

  it("maps positions across fragments; the caret at a split shows on the next page", () => {
    lines();
    const { host, view } = mount(paragraphs(long));
    const [first, second] = host.querySelectorAll<HTMLElement>("[data-fragment]");
    const secondText = second?.firstChild as Text;
    expect(view.posFromDOM(secondText, 0)).toBe(1 + 90);
    expect(view.posFromDOM(first?.firstChild as Text, 90)).toBe(1 + 90);
    expect(view.posFromDOM(host.lastChild as Node, 0)).toBe(1 + 90); // page 2, before its fragment
    expect(view.domFromPos(1 + 90)).toEqual({ node: secondText, offset: 0 });
    expect(view.domFromPos(1 + 95)).toEqual({ node: secondText, offset: 5 });
    expect(view.domFromPos(1 + 89).node).toBe(first?.firstChild);
  });

  it("reads back a DOM change in a continuation as one block", async () => {
    lines();
    const { host, editor } = mount(paragraphs(long, "y"));
    const text = host.querySelectorAll<HTMLElement>("[data-fragment]")[1]?.firstChild as Text;
    text.data = `Z${text.data}`;
    await new Promise((resolve) => setTimeout(resolve));
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.textContent).toBe(`${long.slice(0, 90)}Z${long.slice(90)}`);
  });

  it("keeps marks on both sides of a split inside a marked text", () => {
    lines();
    const { host } = mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: long, marks: [{ type: "bold" }] }],
        },
      ],
    });
    expect(
      [...host.querySelectorAll("[data-fragment]")].map((el) => el.firstElementChild?.tagName),
    ).toEqual(["STRONG", "STRONG"]);
  });
});
