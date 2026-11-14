// @vitest-environment jsdom
import {
  createEditor,
  type FoliDocumentV3,
  type MarkJSON,
  type NodeJSON,
  type StyleJSON,
  type WordContext,
  wordContext,
} from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { serializeRange } from "../clipboard.js";
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

function documentOf(...blocks: NodeJSON[]): FoliDocumentV3 {
  return {
    schemaVersion: 3,
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
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({ document: documentOf(...content) });
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
    expect(host.querySelector("ins")?.title).toBe("A");
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
    // HTML schema v3 cannot hold (a heading) falls back to its plain text.
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
    expect(serializeRange(doc, 0, doc.content.size, document).text).toBe("a\tb7\nc1\nc2\nz");
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
    const { html } = serializeRange(doc, 0, doc.content.size, document);
    expect(html).not.toMatch(/<strong|<u>|javascript/);
    expect(html).toContain('<a href="https://example.com/"><em>z</em></a>');
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
    expect(serializeRange(doc, 0, doc.content.size, document).html).toContain("a\tb<");
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
    renderer.prepare(editor.state.doc);
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
