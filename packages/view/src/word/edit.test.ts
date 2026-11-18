// @vitest-environment jsdom
import {
  createEditor,
  type DocJSON,
  type FoliDocument,
  type MarkJSON,
  type Node as ModelNode,
  type NodeJSON,
  parseContentV2,
  parseDocument,
  type StyleJSON,
  type WordContext,
  wordContext,
} from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import googleDocs from "../../fixtures/clipboard/google-docs.html?raw";
import googleDocsLists from "../../fixtures/clipboard/google-docs-lists.html?raw";
import libreOffice from "../../fixtures/clipboard/libreoffice.html?raw";
import webPage from "../../fixtures/clipboard/web-page.html?raw";
import wordHTML from "../../fixtures/clipboard/word.html?raw";
import wordLists from "../../fixtures/clipboard/word-lists.html?raw";
import { FOLI_MIME, htmlToDoc, serializeRange } from "../clipboard.js";
import { EditorView } from "../index.js";
import { WordRenderer } from "./edit.js";

const STYLES: StyleJSON[] = [
  { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
  {
    id: "Heading1",
    type: "paragraph",
    name: "heading 1",
    basedOn: "Normal",
    next: "Normal",
    paragraph: { outlineLevel: 0 },
    run: [{ type: "bold" }],
  },
  { id: "List", type: "paragraph", paragraph: { contextualSpacing: true } },
];

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
const numbered = { numbering: { id: 1, level: 0 } };

function documentOf(...blocks: NodeJSON[]): FoliDocument {
  return {
    schemaVersion: 5,
    section: {},
    defaults: {},
    styles: STYLES,
    numbering: {
      abstracts: [{ id: 0, levels: [{ level: 0, start: 1, format: "decimal", text: "%1." }] }],
      instances: [{ id: 1, abstract: 0 }],
    },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}

let views: EditorView[] = [];
afterEach(() => {
  for (const view of views) {
    view.destroy();
    view.host.remove();
  }
  views = [];
});

function mount(...content: NodeJSON[]) {
  return mountDocument(documentOf(...content));
}

function mountDocument(doc: FoliDocument) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({ document: doc });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}

const blocks = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>(":scope > .foli-page > *"),
];
const bookmark: NodeJSON = { type: "bookmarkStart", attrs: { id: 1, name: "b" } };
const field: NodeJSON = {
  type: "opaqueInline",
  attrs: { xml: '<w:fldSimple w:instr="PAGE"><w:r><w:t>7</w:t></w:r></w:fldSimple>' },
};
const table: NodeJSON = {
  type: "opaqueBlock",
  attrs: { xml: "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" },
};
const sample = [
  p({ style: "Heading1" }, text("Title")),
  p(numbered, text("a", [{ type: "italic" }]), { type: "tab" }, bookmark, text("b")),
  p(numbered),
  table,
  p({}, text("x"), field, { type: "hardBreak" }, text("y")),
];

describe("EditorView on a schema v3 document", () => {
  it("renders Word's paragraphs: headings by outline level, list numbers, opaque content", () => {
    const { host } = mount(...sample);
    const [heading, first, second, opaque, last] = blocks(host);
    expect(blocks(host).map((b) => b.tagName)).toEqual(["H1", "P", "P", "DIV", "P"]);
    expect(heading?.textContent).toBe("Title");
    expect(heading?.querySelector("span")?.style.fontWeight).toBe("700");
    // List numbers are shown, not text: no caret inside them.
    const marker = first?.firstElementChild as HTMLElement;
    // No hanging indent: the number, then a tab (Word's default suffix).
    expect(marker.textContent).toBe("1.\t");
    expect(marker.getAttribute("contenteditable")).toBe("false");
    expect(second?.firstElementChild?.textContent).toBe("2.\t");
    expect(first?.textContent).toBe("1.\ta\tb");
    // An empty paragraph shows its line with a <br>.
    expect(second?.lastElementChild?.tagName).toBe("BR");
    expect(opaque?.getAttribute("contenteditable")).toBe("false");
    expect(opaque?.textContent).toBe("cell");
    const shown = last?.querySelector("[data-foli-opaque]") as HTMLElement;
    expect(shown.textContent).toBe("7");
    expect(shown.getAttribute("contenteditable")).toBe("false");
  });

  it("round-trips every position inside its paragraphs", () => {
    const { editor, view } = mount(...sample);
    editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return false;
      for (let at = pos + 1; at <= pos + 1 + node.content.size; at++) {
        const point = view.domFromPos(at);
        expect(view.posFromDOM(point.node, point.offset), `pos ${at}`).toBe(at);
      }
      return false;
    });
  });

  it("shows a safe link as a link, in its run's own look; any other target as text", () => {
    const { host } = mount(
      p(
        {},
        text("safe", [{ type: "link", attrs: { href: "https://example.com/" } }]),
        text("file", [{ type: "link", attrs: { href: "file:///C:/x.docx" } }]),
      ),
    );
    const links = [...host.querySelectorAll("a")];
    expect(links.map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      ["https://example.com/", "safe"],
    ]);
    expect(links[0]?.style.color).toBe("inherit");
    expect(links[0]?.style.textDecoration).toBe("none");
  });

  it("puts the caret of an empty numbered paragraph after its number", () => {
    const { host, view } = mount(...sample);
    const second = blocks(host)[2] as HTMLElement;
    const start = 7 + 6 + 1; // after the heading (7) and the first item (2 + 5)
    const point = view.domFromPos(start);
    expect(point.node).toBe(second);
    expect(second.childNodes[point.offset]?.nodeName).toBe("BR");
    // A click on the number maps to the paragraph's start.
    expect(view.posFromDOM(second.firstChild as Node, 0)).toBe(start);
  });

  it("moves the caret over a list number in one press (browsers stop before and after it)", () => {
    const { host, editor, view } = mount(p({}, text("ab")), p(numbered, text("c")), p({}));
    view.focus();
    const press = (key: string, shiftKey = false, ctrlKey = false) => {
      const event = new KeyboardEvent("keydown", { key, shiftKey, ctrlKey, cancelable: true });
      host.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const at = () => [editor.state.selection.anchor, editor.state.selection.head];
    editor.select(3);
    expect(press("ArrowRight")).toBe(true);
    expect(at()).toEqual([5, 5]);
    expect(press("ArrowLeft")).toBe(true);
    expect(at()).toEqual([3, 3]);
    // Extending keeps the anchor.
    editor.select(2, 3);
    expect(press("ArrowRight", true)).toBe(true);
    expect(at()).toEqual([2, 5]);
    // Left to the browser: inside text, into a paragraph without a number, word moves.
    editor.select(2);
    expect(press("ArrowRight")).toBe(false);
    editor.select(6);
    expect(press("ArrowRight")).toBe(false);
    editor.select(3);
    expect(press("ArrowRight", false, true)).toBe(false);
    editor.select(2, 3);
    expect(press("ArrowRight")).toBe(false);
    // Next to an opaque block (no text to put the caret in), Left selects the block, as before.
    const opaque = mount(table, p(numbered, text("c")));
    opaque.view.focus();
    opaque.editor.select(2);
    opaque.host.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    const { from, to } = opaque.editor.state.selection;
    expect([from, to]).toEqual([0, 1]);
  });

  it("renumbers the paragraphs after an inserted item", () => {
    const { host, editor } = mount(p(numbered, text("a")), p(numbered, text("b")));
    const before = blocks(host);
    editor.select(1);
    editor.commands.splitBlock();
    const after = blocks(host);
    expect(after.map((b) => b.firstElementChild?.textContent)).toEqual(["1.\t", "2.\t", "3.\t"]);
    // Its node unchanged, the last item was still drawn again: its number changed.
    expect(after[2]).not.toBe(before[1]);
  });

  it("reuses unchanged blocks", () => {
    const { host, editor } = mount(p({}, text("a")), p({}, text("b")));
    const before = blocks(host);
    editor.select(5);
    editor.commands.insertText("c");
    const after = blocks(host);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it("shades commented text, also in later paragraphs of the range", () => {
    const { host } = mount(
      p({}, { type: "commentStart", attrs: { id: 3 } }, text("a")),
      p({}, text("b"), { type: "commentEnd", attrs: { id: 3 } }, text("c")),
    );
    const spans = [...host.querySelectorAll<HTMLElement>("p > span")].filter((s) => s.textContent);
    expect(spans.map((s) => [s.textContent, !!s.style.backgroundColor])).toEqual([
      ["a", true],
      ["b", true],
      ["c", false],
    ]);
  });

  it("draws a later paragraph again when a comment range before it ends or opens", () => {
    const { host, editor } = mount(
      p({}, { type: "commentStart", attrs: { id: 3 } }, text("a")),
      p({}, text("b"), { type: "commentEnd", attrs: { id: 3 } }),
    );
    // Delete the range's start: "b" is no longer commented, its node unchanged.
    editor.select(1, 2);
    editor.commands.deleteSelection();
    const b = [...host.querySelectorAll<HTMLElement>("p > span")].find(
      (s) => s.textContent === "b",
    );
    expect(b?.style.backgroundColor).toBe("");
  });

  it("pastes HTML that fits schema v3, and not as part of a tracked change", () => {
    const deleted = { type: "deletion", attrs: { id: 1, author: "A" } };
    const { editor, view } = mount(p({}, text("gone", [deleted])));
    editor.select(3);
    view.paste({
      getData: (t: string) =>
        t === "text/html" ? "<p><b>B</b></p>" : t === "text/plain" ? "B" : "",
    });
    expect(editor.getDocument().content.content).toEqual([
      p({}, text("go", [deleted]), text("B", [{ type: "bold" }]), text("ne", [deleted])),
    ]);
  });

  it("waits for a running composition before drawing every block for new fonts", () => {
    const { host, view, editor } = mount(p({}, text("a")), p({}, text("b")));
    view.focus();
    editor.select(2);
    host.dispatchEvent(new CompositionEvent("compositionstart"));
    const before = blocks(host);
    const frames: (() => void)[] = [];
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => frames.push(() => callback(0));
    try {
      const internal = view as unknown as { onFontsLoaded(): void; render(): void };
      internal.onFontsLoaded();
      for (const frame of frames) frame();
      // A render during the composition (another edit) keeps the blocks.
      internal.render();
      expect(blocks(host)).toEqual(before);
      host.dispatchEvent(new CompositionEvent("compositionend"));
      for (const frame of frames.splice(0)) frame();
      internal.render();
    } finally {
      window.requestAnimationFrame = raf;
    }
    expect(blocks(host)[0]).not.toBe(before[0]);
  });

  it("draws every block again when web fonts load (line heights come from them)", () => {
    const { host, view } = mount(p({}, text("a")));
    const before = blocks(host)[0];
    const frames: (() => void)[] = [];
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => frames.push(() => callback(0));
    try {
      (view as unknown as { onFontsLoaded(): void }).onFontsLoaded();
      for (const frame of frames) frame();
    } finally {
      window.requestAnimationFrame = raf;
    }
    expect(blocks(host)[0]).not.toBe(before);
    expect(blocks(host)[0]?.textContent).toBe("a");
  });

  it("shows tracked changes as markup", () => {
    const change = { id: 1, author: "A" };
    const { host } = mount(
      p(
        {},
        text("in", [{ type: "insertion", attrs: change }]),
        text("out", [{ type: "deletion", attrs: change }]),
      ),
    );
    expect(host.querySelector("ins")?.textContent).toBe("in");
    expect(host.querySelector("del")?.textContent).toBe("out");
    expect(host.querySelector("ins")?.title).toBe("Inserted by A");
    // A bar beside the changed paragraph.
    expect((blocks(host)[0] as HTMLElement).style.boxShadow).not.toBe("");
  });

  it("never puts the DOM caret inside hidden deleted text", () => {
    const { host, editor, view } = mount(p({}, text("abc")));
    editor.commands.setTrackChanges(true, "A");
    editor.commands.setReviewView("final");
    view.focus();
    editor.select(1);
    editor.commands.deleteForward();
    expect(editor.state.selection.head).toBe(2);
    const focus = document.getSelection()?.focusNode as Node;
    expect(focus.parentElement?.closest("del")).toBeNull();
    expect(host.contains(focus)).toBe(true);
  });

  it("shows changes as simple markup or final text, keeping positions", () => {
    const change = { id: 1, author: "A" };
    const { host, editor } = mount(
      p(
        {},
        text("a"),
        text("in", [{ type: "insertion", attrs: change }]),
        text("out", [{ type: "deletion", attrs: change }]),
        text("b"),
      ),
    );
    const del = () => host.querySelector("del") as HTMLElement;
    const ins = () => host.querySelector("ins") as HTMLElement;
    expect(del().style.display).toBe("");
    editor.commands.setReviewView("simple");
    expect(del().style.display).toBe("none");
    expect(del().textContent).toBe("out");
    expect(ins().style.textDecorationLine).toBe("none");
    expect((blocks(host)[0] as HTMLElement).style.boxShadow).not.toBe("");
    editor.commands.setReviewView("final");
    expect(del().style.display).toBe("none");
    expect((blocks(host)[0] as HTMLElement).style.boxShadow).toBe("");
    // Editing goes on at the same positions.
    editor.select(9);
    editor.commands.insertText("c");
    expect(host.textContent).toContain("ainoutbc");
  });

  it("reads a composition back past list numbers and tabs", () => {
    const { host, editor, view } = mount(p(numbered, text("a"), { type: "tab" }, text("b")));
    view.focus();
    editor.select(4);
    host.dispatchEvent(new CompositionEvent("compositionstart"));
    const leaf = [...(blocks(host)[0] as HTMLElement).querySelectorAll("span")]
      .map((s) => s.firstChild)
      .find((n) => n?.textContent === "b") as Text;
    leaf.data = "éb";
    document.getSelection()?.collapse(leaf, 1);
    host.dispatchEvent(new CompositionEvent("compositionend"));
    expect(editor.getDocument().content.content).toEqual([
      p(numbered, text("a"), { type: "tab" }, text("éb")),
    ]);
  });

  it("pastes plain text and the HTML it can read as v3 paragraphs", () => {
    const { editor, view } = mount(p({}, text("ab")));
    editor.select(2);
    const data = (types: Record<string, string>) => ({ getData: (t: string) => types[t] ?? "" });
    view.paste(data({ "text/plain": "x\ny" }), false);
    expect(editor.getDocument().content.content).toEqual([p({}, text("ax")), p({}, text("yb"))]);
    // A pasted heading's text joins the paragraph it is pasted into, which keeps its style.
    view.paste(data({ "text/html": "<h1>H</h1>", "text/plain": "H" }));
    expect(editor.getDocument().content.content).toEqual([p({}, text("ax")), p({}, text("yHb"))]);
  });

  it("copies tabs as tabs, opaque content as its text, and leaves bookmarks out", () => {
    const twoCells =
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>c1</w:t></w:r></w:p></w:tc>" +
      "<w:tc><w:p><w:r><w:t>c2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
    const { editor } = mount(
      p({}, text("a"), { type: "tab" }, bookmark, text("b"), field),
      { type: "opaqueBlock", attrs: { xml: twoCells } },
      p({}, text("z")),
    );
    const { doc } = editor.state;
    expect(
      serializeRange(doc, 0, doc.content.size, document, {
        context: wordContext(editor.state) as WordContext,
        ratio: () => 1.2,
      }).text,
    ).toBe("a\tb7\nc1\nc2\nz");
  });

  it("copies HTML without turned-off properties or unsafe links", () => {
    const { editor } = mount(
      p(
        {},
        text("x", [
          { type: "bold", attrs: { value: false } },
          { type: "underline", attrs: { style: "none" } },
        ]),
        text("y", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
        text("z", [{ type: "link", attrs: { href: "https://example.com/" } }, { type: "italic" }]),
      ),
    );
    const { doc } = editor.state;
    const context = wordContext(editor.state) as WordContext;
    const { html } = serializeRange(doc, 0, doc.content.size, document, {
      context,
      ratio: () => 1.2,
    });
    expect(html).not.toMatch(/font-weight: 700|underline|javascript/);
    const link = new DOMParser().parseFromString(html, "text/html").querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/");
    expect(link?.textContent).toBe("z");
    expect(link?.querySelector("span")?.style.fontStyle).toBe("italic");
  });

  it("writes Word's space above each block: before, then after + before, contextual dropped", () => {
    const { host } = mount(
      p({ spacing: { before: 240, after: 120 } }, text("a")),
      p({ spacing: { before: 60, after: 120 } }, text("b")),
      p({ style: "List", spacing: { before: 60, after: 120 } }, text("c")),
      p({ style: "List", spacing: { before: 60, after: 120 } }, text("d")),
    );
    // jsdom lays nothing out: every block is on the first page.
    expect(blocks(host).map((b) => b.style.marginTop)).toEqual(["16px", "12px", "12px", "0px"]);
  });

  it("flows with Word's spacing: the space after and before add up", () => {
    // Every paragraph 20 px tall: the flow is arithmetic (Letter, inch margins: 864 px).
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.tagName !== "P") return rect.call(this);
      return { top: 0, bottom: 20, left: 0, right: 600, height: 20, width: 600 } as DOMRect;
    };
    try {
      const spaced = { spacing: { before: 1500, after: 1500 } }; // 100 px each
      const { host } = mount(...Array.from({ length: 5 }, (_, i) => p(spaced, text(`${i}`))));
      // 100 + 20, then 200 + 20 three times: 780 px; a fifth (1000 px) goes on. As CSS
      // (margins collapsing to 100 px) all five would fit.
      const pages = [...host.querySelectorAll(".foli-page")].map((page) => page.textContent);
      expect(pages).toEqual(["0123", "4"]);
    } finally {
      Element.prototype.getBoundingClientRect = rect;
    }
  });

  it("copies tabs into the HTML too", () => {
    const { editor } = mount(p({}, text("a"), { type: "tab" }, bookmark, text("b")));
    const { doc } = editor.state;
    const word = { context: wordContext(editor.state) as WordContext, ratio: () => 1.2 };
    // Each run is a span: the tab is its own.
    expect(serializeRange(doc, 0, doc.content.size, document, word).html).toContain(">\t</span>");
  });

  it("renders a new document from scratch", () => {
    const { host, editor } = mount(p({}, text("a")));
    const before = blocks(host)[0];
    editor.setDocument(documentOf(p({}, text("a"))));
    expect(blocks(host)[0]).not.toBe(before);
    expect(blocks(host)[0]?.textContent).toBe("a");
  });
});

describe("WordRenderer", () => {
  function rendererOf(...content: NodeJSON[]) {
    const editor = createEditor({ document: documentOf(...content) });
    const context = wordContext(editor.state) as WordContext;
    const renderer = new WordRenderer(context, document, () => 1.2);
    renderer.prepare(editor.state.doc.content.content);
    return { renderer, doc: editor.state.doc };
  }

  it("splits a paragraph into fragments at content offsets", () => {
    const { renderer, doc } = rendererOf(
      p({ ...numbered, justification: "both", indent: { firstLine: 720 } }, text("abcdef")),
    );
    const desc = renderer.render(doc.child(0), 0, [2, 4]);
    expect(desc.fragments.map((f) => f.textContent)).toEqual(["1.\tab", "cd", "ef"]);
    expect(desc.fragments.map((f) => f.dataset.fragment)).toEqual(["0", "1", "2"]);
    // The first-line indent and the number belong to the first line only.
    expect(desc.fragments.map((f) => f.style.textIndent)).toEqual(["48px", "0px", "0px"]);
    // Justified up to each page end; the paragraph's last line as Word ends it.
    expect(desc.fragments.map((f) => f.style.textAlignLast)).toEqual(["justify", "justify", ""]);
    expect(desc.leaves.map((l) => [l.offset, l.size])).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
  });

  it("shows the last line of a paragraph ending in a line break, not one ending in markers", () => {
    const { renderer, doc } = rendererOf(
      p({}, text("a"), { type: "hardBreak" }, bookmark),
      p({}, text("a"), bookmark),
      p({}, text("a"), { type: "pageBreak" }),
    );
    const last = (i: number) => renderer.render(doc.child(i), i).dom.lastChild?.nodeName;
    expect([last(0), last(1), last(2)]).toEqual(["BR", "SPAN", "BR"]);
    // After a page break the paragraph mark stays on its line: no extra <br>.
    expect(renderer.render(doc.child(2), 2).dom.querySelectorAll("br")).toHaveLength(1);
  });
});

describe("list markers in Symbol and Wingdings", () => {
  it("are shown as the Unicode character they draw", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const bullet = (text: string, font: string) => ({
      level: 0,
      format: "bullet",
      text,
      run: [{ type: "font", attrs: { ascii: font, hAnsi: font } }],
    });
    const editor = createEditor({
      document: {
        ...documentOf(
          p({ numbering: { id: 1, level: 0 } }),
          p({ numbering: { id: 2, level: 0 } }),
          p({ numbering: { id: 3, level: 0 } }),
          p({ numbering: { id: 4, level: 0 } }),
          p({ numbering: { id: 5, level: 0 } }),
        ),
        numbering: {
          abstracts: [
            { id: 0, levels: [bullet("", "Symbol")] },
            { id: 1, levels: [bullet("", "Wingdings")] },
            { id: 2, levels: [bullet("", "Arial")] },
            { id: 3, levels: [bullet("", "Wingdings")] },
            { id: 4, levels: [bullet("", "Wingdings")] },
          ],
          instances: [
            { id: 1, abstract: 0 },
            { id: 2, abstract: 1 },
            { id: 3, abstract: 2 },
            { id: 4, abstract: 3 },
            { id: 5, abstract: 4 },
          ],
        },
      },
    });
    views.push(new EditorView(host, editor));
    const markers = [...host.querySelectorAll<HTMLElement>("[data-foli-marker]")];
    expect(markers.map((m) => m.textContent?.charAt(0))).toEqual(["•", "▪", "", "◻", "●"]);
    expect(markers[0]?.style.fontFamily).toBe("sans-serif");
  });
});

describe("Tab on a v3 document", () => {
  const mount = (editable: boolean) => {
    const host = document.createElement("div");
    document.body.append(host);
    // A list paragraph: Shift+Tab would take it a level up.
    const editor = createEditor({ document: documentOf(p(numbered, text("ab"))) });
    views.push(new EditorView(host, editor, { editable }));
    host.focus();
    editor.select(2);
    return { host, editor };
  };
  const key = (host: HTMLElement, key: string, shiftKey = false) => {
    const event = new KeyboardEvent("keydown", { key, shiftKey, cancelable: true });
    host.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it("types a tab; Escape first lets Tab and Shift+Tab move the focus on", () => {
    const { host, editor } = mount(true);
    expect(key(host, "Tab")).toBe(true);
    expect(editor.state.doc.firstChild?.childCount).toBe(3);
    expect(key(host, "Escape")).toBe(false);
    expect(key(host, "Tab")).toBe(false);
    // Only right after Escape (Shift pressed in between does not count).
    expect(key(host, "Tab")).toBe(true);
    key(host, "Escape");
    key(host, "Shift", true);
    expect(key(host, "Tab", true)).toBe(false);
    expect(editor.state.doc.firstChild?.attrs.numbering).toEqual({ id: 1, level: 0 });
    key(host, "Escape");
    key(host, "a");
    expect(key(host, "Tab")).toBe(true);
  });

  it("read-only: Tab keeps its default (the focus moves on)", () => {
    const { host, editor } = mount(false);
    expect(key(host, "Tab")).toBe(false);
    expect(editor.state.doc.firstChild?.childCount).toBe(1);
  });
});

describe("the clipboard on a schema v3 document", () => {
  const word = (editor: ReturnType<typeof mount>["editor"]) => ({
    context: wordContext(editor.state) as WordContext,
    ratio: () => 1.2,
  });
  const copy = (editor: ReturnType<typeof mount>["editor"], from: number, to: number) =>
    serializeRange(editor.state.doc, from, to, document, word(editor));
  const data = (types: Record<string, string>) => ({ getData: (t: string) => types[t] ?? "" });
  const commented = (id: number, value: string): NodeJSON[] => [
    { type: "commentStart", attrs: { id } },
    text(value),
    { type: "commentEnd", attrs: { id } },
  ];

  it("copies HTML as Word's: headings, list numbers Word reads, margins, no editor-only marks", () => {
    const { editor } = mount(
      p({ style: "Heading1", spacing: { before: 240 } }, text("Title")),
      p(numbered, ...commented(0, "a"), field, { type: "pageBreak" }),
      table,
    );
    const { doc } = editor.state;
    const html = copy(editor, 0, doc.content.size).html;
    const parsed = new DOMParser().parseFromString(html, "text/html").body;
    const [heading, item, opaque] = [...parsed.children] as HTMLElement[];
    expect(heading?.tagName).toBe("H1");
    expect(heading?.style.marginTop).toBe("16px");
    expect(item?.getAttribute("style")).toMatch(/;mso-list:l1 level1 lfo1$/);
    const marker = item?.firstElementChild as HTMLElement;
    expect(marker.getAttribute("style")).toMatch(/;mso-list:Ignore$/);
    expect(marker.textContent).toBe("1.\t");
    expect(opaque?.textContent).toBe("cell");
    expect(html).not.toMatch(/contenteditable|data-foli|data-fragment|rgba\(255, 213, 79/);
    expect(html).toContain("data-page-break");
    // Text from inside one numbered paragraph is not a list item.
    const inline = copy(editor, 9, 10).html;
    expect(inline).not.toMatch(/mso-list/);
    expect(inline).toContain(">a</span>");
  });

  it("pastes into another document: its styles, list and comment come along", () => {
    const quote: StyleJSON = { id: "Quote", type: "paragraph", name: "Quote", basedOn: "Normal" };
    const source = mountDocument({
      ...documentOf(p({ style: "Quote" }, ...commented(4, "q")), p(numbered, text("i"))),
      styles: [...STYLES, quote],
      comments: [{ id: 4, author: "A", content: [p({}, text("note"))] }],
    });
    const { doc } = source.editor.state;
    const copied = copy(source.editor, 0, doc.content.size);
    const target = mountDocument({
      ...documentOf(p({}, ...commented(4, "t")), p({})),
      numbering: { abstracts: [], instances: [] },
      comments: [{ id: 4, author: "B", content: [p({})] }],
    });
    target.editor.select(target.editor.state.doc.content.size - 1);
    expect(target.view.paste(data({ [FOLI_MIME]: copied.json, "text/html": copied.html }))).toBe(
      true,
    );
    const pasted = target.editor.getDocument();
    expect(pasted.content.content?.slice(1)).toEqual([
      p({ style: "Quote" }, ...commented(5, "q")),
      p({ numbering: { id: 1, level: 0 } }, text("i")),
    ]);
    expect(pasted.styles.map((s) => s.id)).toContain("Quote");
    expect(pasted.numbering).toEqual(documentOf().numbering);
    expect(pasted.comments.map((c) => [c.id, c.author])).toEqual([
      [4, "B"],
      [5, "A"],
    ]);
    // Undo takes the content and its comment out; styles it added stay, as in Word.
    target.editor.commands.undo();
    expect(target.editor.getDocument().content.content).toHaveLength(2);
    expect(target.editor.getDocument().styles.map((s) => s.id)).toContain("Quote");
    expect(target.editor.getDocument().comments.map((c) => c.id)).toEqual([4]);
    target.editor.commands.redo();
    expect(target.editor.getDocument().comments).toEqual(pasted.comments);
  });

  it("pastes inside the document: the list goes on, a comment is copied", () => {
    const { editor, view } = mountDocument({
      ...documentOf(p(numbered, ...commented(0, "a")), p({})),
      comments: [{ id: 0, author: "A", content: [p({}, text("note"))] }],
    });
    const { json } = copy(editor, 0, editor.state.doc.firstChild?.nodeSize ?? 0);
    editor.select(editor.state.doc.content.size - 1);
    view.paste(data({ [FOLI_MIME]: json }));
    const pasted = editor.getDocument();
    expect(pasted.content.content?.map((b) => b.attrs?.numbering)).toEqual([
      { id: 1, level: 0 },
      { id: 1, level: 0 },
    ]);
    expect(pasted.numbering).toEqual(documentOf().numbering);
    expect(pasted.content.content?.[1]?.content?.[0]?.attrs?.id).toBe(1);
    expect(pasted.comments.map((c) => c.id)).toEqual([0, 1]);
  });

  it("reads its own HTML back: a heading in its style, numbered paragraphs", () => {
    const source = mount(p({ style: "Heading1" }, text("T")), p(numbered, text("a")));
    const { html } = copy(source.editor, 0, source.editor.state.doc.content.size);
    const { editor, view } = mount(p({}));
    view.paste(data({ "text/html": html }));
    const pasted = editor.getDocument();
    const [heading, item] = pasted.content.content ?? [];
    expect(heading?.attrs?.style).toBe("Heading1");
    expect(item?.attrs?.style).toBe("ListParagraph");
    const { numbering } = (item?.attrs ?? {}) as { numbering: { id: number; level: number } };
    expect(numbering.level).toBe(0);
    const instance = pasted.numbering.instances.find((n) => n.id === numbering.id);
    expect(
      pasted.numbering.abstracts.find((a) => a.id === instance?.abstract)?.levels[0]?.format,
    ).toBe("decimal");
    // The heading's bold (in the HTML on its text) is its style's, not the text's own.
    expect(heading?.content).toEqual([text("T")]);
  });

  it("keeps pasted formatting the paragraph's style does not give", () => {
    const { editor, view } = mount(p({}));
    view.paste(data({ "text/html": "<h1><b>b</b><i>i</i><u>u</u></h1><p><b>p</b></p>" }));
    const [heading, paragraph] = editor.getDocument().content.content ?? [];
    expect(heading?.content).toEqual([
      text("b"),
      text("i", [{ type: "italic" }]),
      text("u", [{ type: "underline" }]),
    ]);
    expect(paragraph?.content).toEqual([text("p", [{ type: "bold" }])]);
  });

  it("pasted over a selection, a bookmark keeps the name of the one it replaces", () => {
    const named = (id: number, value: string): NodeJSON[] => [
      { type: "bookmarkStart", attrs: { id, name: "Section1" } },
      text(value),
      { type: "bookmarkEnd", attrs: { id } },
    ];
    const { editor, view } = mount(p({}, ...named(1, "old")));
    editor.select(1, 6);
    const json = JSON.stringify({
      open: true,
      content: { type: "doc", content: [p({}, ...named(7, "new"))] },
    });
    view.paste(data({ [FOLI_MIME]: json }));
    expect(editor.getDocument().content.content).toEqual([p({}, ...named(2, "new"))]);
  });

  it("pastes invalid definitions as the HTML instead", () => {
    const { editor, view } = mount(p({}));
    const json = JSON.stringify({
      open: false,
      content: { type: "doc", content: [p({}, text("json"))] },
      word: { styles: [{ id: "A", type: "paragraph", basedOn: "A" }] },
    });
    view.paste(data({ [FOLI_MIME]: json, "text/html": "<p>html</p>" }));
    expect(editor.getDocument().content.content).toEqual([p({}, text("html"))]);
  });

  it("T3: every fixture and a v3 copy paste at every text position, keeping the document valid", {
    timeout: 120_000,
  }, () => {
    const count = (doc: ModelNode, test: (node: ModelNode) => boolean) => {
      let n = 0;
      doc.descendants((node) => {
        if (test(node)) n++;
      });
      return n;
    };
    const isPageBreak = (node: ModelNode) => node.type.name === "pageBreak";
    const isNumbered = (node: ModelNode) => !!(node.attrs.numbering as { id?: number } | null)?.id;
    const own = mount(...sample);
    const sampleCopy = copy(own.editor, 0, own.editor.state.doc.content.size);
    const pastes: {
      types: Record<string, string>;
      pieces: string[];
      breaks: number;
      items: number;
    }[] = [wordHTML, wordLists, googleDocs, googleDocsLists, libreOffice, webPage].map((html) => {
      const v2 = parseContentV2(htmlToDoc(html) as DocJSON);
      const pieces: string[] = [];
      v2.descendants((node) => {
        if (node.isTextblock && node.textContent) pieces.push(node.textContent);
        return !node.isTextblock;
      });
      return {
        types: { "text/html": html },
        pieces,
        breaks: count(v2, isPageBreak),
        items: count(v2, (node) => node.type.name === "listItem"),
      };
    });
    pastes.push({
      types: { [FOLI_MIME]: sampleCopy.json },
      pieces: ["Title", "ab", "xy"],
      breaks: 0,
      items: 2,
    });
    const targets = [
      [p({ style: "Heading1" }, text("ab")), p(numbered, text("cd"))],
      [p({}), table, p({}, ...commented(0, "gh"), bookmark)],
    ];
    let total = 0;
    for (const { types, pieces, breaks, items } of pastes) {
      for (const target of targets) {
        const { editor, view } = mountDocument({
          ...documentOf(...target),
          comments: [{ id: 0, author: "A", content: [p({}, text("note"))] }],
        });
        const positions: number[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock)
            for (let i = 0; i <= node.content.size; i++) positions.push(pos + 1 + i);
          return !node.isTextblock;
        });
        for (const at of positions) {
          const before = editor.state.doc;
          editor.select(at);
          expect(view.paste(data(types))).toBe(true);
          // The whole document, envelope included, is still one schema v3 accepts.
          const whole = parseDocument(editor.getDocument());
          // Every comment anchor has its comment; bookmark names stay unique.
          const comments = new Set(whole.comments.map((c) => c.id));
          const names: string[] = [];
          editor.state.doc.descendants((node) => {
            if (node.type.name.startsWith("comment"))
              expect(comments.has(node.attrs.id as number)).toBe(true);
            if (node.type.name === "bookmarkStart") names.push(String(node.attrs.name));
          });
          expect(new Set(names).size).toBe(names.length);
          const { doc } = editor.state;
          for (const piece of pieces) expect(doc.textContent).toContain(piece);
          expect(count(doc, isPageBreak)).toBeGreaterThanOrEqual(
            count(before, isPageBreak) + breaks,
          );
          expect(count(doc, isNumbered)).toBeGreaterThanOrEqual(
            count(before, isNumbered) + items - 1,
          );
          editor.commands.undo();
          expect(editor.state.doc.eq(before)).toBe(true);
          total++;
        }
      }
    }
    expect(total).toBeGreaterThan(50);
  });
});
