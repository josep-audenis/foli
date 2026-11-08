// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type DocJSON,
  findWrapping,
  NodeSelection,
  TextSelection,
} from "@folijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeRange } from "./clipboard.js";
import { EditorView } from "./index.js";
import { renderBlock } from "./render.js";

const text = (t: string) => ({ type: "text", text: t });
const p = (t?: string) => ({ type: "paragraph", ...(t ? { content: [text(t)] } : {}) });
const item = (...content: unknown[]) => ({ type: "listItem", content });

/** A bulleted list with a nested ordered list (starting at 3), a rule, and a paragraph. */
const nested = {
  type: "doc",
  content: [
    p("intro"),
    {
      type: "bulletList",
      content: [
        item(p("one"), {
          type: "orderedList",
          attrs: { start: 3 },
          content: [item(p("a")), item(p("b"))],
        }),
        item(p("two")),
      ],
    },
    { type: "horizontalRule" },
    p("end"),
  ],
} as DocJSON;

let views: EditorView[] = [];
afterEach(() => {
  for (const view of views) {
    view.destroy();
    view.host.remove();
  }
  views = [];
});

function mount(content: DocJSON = nested) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({ document: createDocument(content) });
  const view = new EditorView(host, editor);
  views.push(view);
  return { host, editor, view };
}

/** The markup inside the first page. */
const pageHTML = (host: HTMLElement) =>
  (host.querySelector(".foli-page") as HTMLElement).innerHTML
    .replace(/ data-foli-wrapper=""/g, "")
    .replace(/ style="[^"]*"/g, "");

describe("nested blocks (ADR-0004)", () => {
  it("renders lists, list items, a nested ordered list with its numbers, and a rule", () => {
    const { host } = mount();
    expect(pageHTML(host)).toBe(
      "<p>intro</p><ul><li><p>one</p>" +
        '<ol><li value="3"><p>a</p></li><li value="4"><p>b</p></li></ol>' +
        "</li><li><p>two</p></li></ul><hr><p>end</p>",
    );
    // Containers take no vertical space of their own: the flow treats the blocks as siblings.
    const ul = host.querySelector("ul") as HTMLElement;
    expect([ul.style.marginTop, ul.style.marginBottom, ul.style.paddingTop]).toEqual([
      "0px",
      "0px",
      "0px",
    ]);
  });

  it("round-trips every position inside every textblock at any depth", () => {
    const { editor, view } = mount();
    let checked = 0;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      for (let at = pos + 1; at <= pos + 1 + node.content.size; at++) {
        const point = view.domFromPos(at);
        expect(view.posFromDOM(point.node, point.offset), `pos ${at}`).toBe(at);
        checked++;
      }
      return false;
    });
    expect(checked).toBeGreaterThan(15);
  });

  it("maps points between blocks inside containers to the next block's start", () => {
    const { host, editor, view } = mount();
    const li = host.querySelector("li") as HTMLElement; // holds <p>one</p> and the <ol>
    const olStart = view.posFromDOM(li, 1); // between the paragraph and the nested list
    expect(editor.state.doc.resolve((olStart as number) + 2).parent.textContent).toBe("a");
  });

  it("shows select-all in a document that starts with a list inside its first text", () => {
    const { editor, view } = mount({
      type: "doc",
      content: [{ type: "bulletList", content: [item(p("first")), item(p("last"))] }],
    } as DocJSON);
    view.focus();
    editor.commands.selectAll();
    const sel = document.getSelection() as globalThis.Selection;
    expect(sel.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(sel.anchorNode?.textContent).toBe("first");
    expect(sel.focusNode?.textContent).toBe("last");
  });

  it("keeps the list elements when typing inside a list item (no DOM moves)", () => {
    const { host, editor } = mount();
    const ul = host.querySelector("ul");
    const ol = host.querySelector("ol");
    let target = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "two") target = pos + 3;
      return true;
    });
    editor.select(target);
    editor.commands.insertText("!");
    expect(host.querySelector("ul")).toBe(ul);
    expect(host.querySelector("ol")).toBe(ol);
    expect(host.textContent).toContain("two!");
  });

  it("reads a composition inside a nested list item back at the right position", () => {
    const { host, editor, view } = mount();
    let target = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "b") target = pos + 1;
      return true;
    });
    view.focus();
    editor.select(target);
    host.dispatchEvent(new CompositionEvent("compositionstart"));
    const textNode = [...host.querySelectorAll("ol p")].at(1)?.firstChild as Text;
    textNode.data = "bé";
    document.getSelection()?.collapse(textNode, 2);
    host.dispatchEvent(new CompositionEvent("compositionend"));
    const json = JSON.stringify(editor.getDocument().content);
    expect(json).toContain('"text":"bé"');
    expect(json).toContain('"text":"a"'); // the sibling item is untouched
    expect(editor.state.selection.head).toBe(target + 1);
  });

  it("shows a node selection on a rule as a DOM range around it, and keeps it", () => {
    const { host, editor, view } = mount();
    let rulePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "horizontalRule") rulePos = pos;
      return true;
    });
    view.focus();
    editor.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, rulePos)));
    const hr = host.querySelector("hr") as HTMLElement;
    expect(hr.classList.contains("foli-selected-node")).toBe(true);
    const sel = document.getSelection() as globalThis.Selection;
    expect(sel.anchorNode).toBe(hr.parentNode);
    expect(sel.focusOffset - sel.anchorOffset).toBe(1);
    // Reading the DOM back keeps the node selection (selectionchange does not replace it).
    document.dispatchEvent(new Event("selectionchange"));
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    // Moving away removes the class.
    editor.select(2);
    expect(hr.classList.contains("foli-selected-node")).toBe(false);
  });

  it("selects a rule inside a list item as a node too (its end is not the next block's start)", () => {
    const { host, editor, view } = mount({
      type: "doc",
      content: [
        { type: "bulletList", content: [item(p("x"), { type: "horizontalRule" }), item(p("y"))] },
      ],
    } as DocJSON);
    view.focus();
    const hr = host.querySelector("hr") as HTMLElement;
    hr.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    document.dispatchEvent(new Event("selectionchange"));
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe("horizontalRule");
  });

  it("selects a nested paragraph on triple-click", () => {
    const { host, editor, view } = mount();
    view.focus();
    const a = [...host.querySelectorAll("ol p")][0] as HTMLElement;
    a.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 3 }));
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(TextSelection);
    expect(editor.state.doc.textBetween(selection.from, selection.to)).toBe("a");
  });

  it("renders links, colors and alignment; a click on a link does not navigate", () => {
    const { host } = mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { align: "center" },
          content: [
            {
              type: "text",
              text: "go",
              marks: [{ type: "link", attrs: { href: "https://x.test/" } }, { type: "bold" }],
            },
            {
              type: "text",
              text: "red",
              marks: [{ type: "textColor", attrs: { color: "#c00000" } }],
            },
            {
              type: "text",
              text: "lit",
              marks: [{ type: "highlight", attrs: { color: "#ffff00" } }],
            },
          ],
        },
        { type: "heading", attrs: { level: 2, align: "end" }, content: [text("h")] },
      ],
    } as DocJSON);
    const para = host.querySelector("p") as HTMLElement;
    expect(para.style.textAlign).toBe("center");
    expect((host.querySelector("h2") as HTMLElement).style.textAlign).toBe("end");
    const link = para.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://x.test/");
    expect(link.firstElementChild?.tagName).toBe("STRONG"); // the link wraps the formatting
    expect((para.querySelector("span") as HTMLElement).style.color).toBe("rgb(192, 0, 0)");
    expect(para.querySelectorAll("span")[1]?.style.backgroundColor).toBe("rgb(255, 255, 0)");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("copies nested blocks as real lists", () => {
    const { editor } = mount();
    const { doc } = editor.state;
    const { html } = serializeRange(doc, 0, doc.content.size, document);
    expect(html).toContain("<ul><li>");
    expect(html).toContain('<ol start="3"><li>');
    expect(html).toContain("<hr>");
    expect(html).not.toContain("data-foli-wrapper");
  });
});

describe("nested blocks: review regressions (PR #35)", () => {
  const listType = (editor: ReturnType<typeof mount>["editor"]) =>
    editor.state.schema.nodes.bulletList as NonNullable<
      ReturnType<typeof mount>["editor"]["state"]["schema"]["nodes"]["bulletList"]
    >;

  it("wraps a reused block in a new list without losing its place (A, B, C: wrap A)", () => {
    const { host, editor } = mount({ type: "doc", content: [p("A"), p("B"), p("C")] } as DocJSON);
    const { doc } = editor.state;
    const range = doc.resolve(1).blockRange(doc.resolve(2));
    const wrappers = range && findWrapping(range, listType(editor));
    expect(range && wrappers).toBeTruthy();
    editor.dispatch(editor.state.tr.wrap(range as never, wrappers as never));
    expect(pageHTML(host)).toBe("<ul><li><p>A</p></li></ul><p>B</p><p>C</p>");
    editor.commands.undo();
    expect(pageHTML(host)).toBe("<p>A</p><p>B</p><p>C</p>");
  });

  it("indents a middle item into a nested list (ul > li > [X, Y, Z]: wrap Y)", () => {
    const { host, editor } = mount({
      type: "doc",
      content: [{ type: "bulletList", content: [item(p("X"), p("Y"), p("Z"))] }],
    } as DocJSON);
    const { doc } = editor.state;
    let y = -1;
    doc.descendants((node, pos) => {
      if (node.textContent === "Y" && node.isTextblock) y = pos + 1;
      return true;
    });
    const range = doc.resolve(y).blockRange(doc.resolve(y + 1));
    const wrappers = range && findWrapping(range, listType(editor));
    editor.dispatch(editor.state.tr.wrap(range as never, wrappers as never));
    expect(pageHTML(host)).toBe("<ul><li><p>X</p><ul><li><p>Y</p></li></ul><p>Z</p></li></ul>");
  });

  it("measures a block again when it moves into a container (its width changed)", () => {
    const { host, editor } = mount({ type: "doc", content: [p("A"), p("B")] } as DocJSON);
    const a = host.querySelector("p") as HTMLElement;
    const spy = vi.spyOn(a, "getBoundingClientRect");
    const { doc } = editor.state;
    const range = doc.resolve(1).blockRange(doc.resolve(2));
    const wrappers = range && findWrapping(range, listType(editor));
    editor.dispatch(editor.state.tr.wrap(range as never, wrappers as never));
    expect(host.querySelector("li > p")).toBe(a); // the same element, reused
    expect(spy).toHaveBeenCalled(); // and measured again
  });

  it("does not move later list items when one item moves to the next page", () => {
    const { host, view } = mount({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: ["1", "2", "3", "4", "5", "6"].map((t) => item(p(t))),
        },
      ],
    } as DocJSON);
    // place() is private; this reaches it to give it page assignments a jsdom flow cannot.
    const internal = view as unknown as {
      place(b: unknown, pages: number[][], chains: unknown): void;
      blocks: unknown;
      chains: unknown;
    };
    internal.place(internal.blocks, [[0], [0], [0], [1], [1], [1]], internal.chains);
    const byText = (t: string) =>
      [...host.querySelectorAll("p")].find((el) => el.textContent === t);
    const fifth = byText("5");
    const li = fifth?.parentElement;
    const thirdLi = byText("3")?.parentElement;
    internal.place(internal.blocks, [[0], [0], [1], [1], [1], [1]], internal.chains);
    expect(fifth?.parentElement).toBe(li); // still in its own <li>
    // The item that moved to the next page took its <li> along, as a paragraph moves itself.
    expect(byText("3")?.parentElement).toBe(thirdLi);
    expect(host.querySelectorAll(".foli-page")[1]?.firstElementChild?.firstElementChild).toBe(
      thirdLi,
    );
    const pages = host.querySelectorAll(".foli-page");
    expect(pages[1]?.querySelectorAll("li > p")).toHaveLength(4);
  });

  it("copies a word from a list item as text, not as a one-item list", () => {
    const { editor } = mount();
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "two") at = pos;
      return true;
    });
    const { html, json } = serializeRange(editor.state.doc, at, at + 3, document);
    expect(html).toBe('<p style="white-space: pre-wrap;">two</p>');
    expect(json).toContain('"listItem"'); // the JSON keeps the context
  });

  it("keeps a node selection out of a Shift+click on a rule (the native extension applies)", () => {
    const { host, editor, view } = mount();
    view.focus();
    editor.select(2);
    const hr = host.querySelector("hr") as HTMLElement;
    hr.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1, shiftKey: true }),
    );
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
  });
});

describe("justified text across a page break", () => {
  it("keeps a split justified paragraph justified up to the break, not after its end", () => {
    const { editor } = mount({
      type: "doc",
      content: [{ type: "paragraph", attrs: { align: "justify" }, content: [text("abcdef")] }],
    } as DocJSON);
    const node = editor.state.doc.child(0);
    const { fragments } = renderBlock(node, document, [2, 4]);
    expect(fragments.map((f) => f.style.textAlignLast)).toEqual(["justify", "justify", ""]);
    expect(fragments.map((f) => f.style.textAlign)).toEqual(["justify", "justify", "justify"]);
    // Other alignments do not justify a fragment's last line.
    // A fragment holding a forced break keeps the default: text-align-last would also stretch
    // the line before the break, which the whole paragraph shows start-aligned.
    const withBreak = editor.state.schema.nodes.paragraph?.create({ align: "justify" }, [
      editor.state.schema.text("ab"),
      editor.state.schema.node("hardBreak"),
      editor.state.schema.text("cdef"),
    ]);
    const broken = renderBlock(withBreak as typeof node, document, [5]);
    expect(broken.fragments.map((f) => f.style.textAlignLast)).toEqual(["", ""]);
    const centered = editor.state.schema.nodes.paragraph?.create({ align: "center" }, node.content);
    const split = renderBlock(centered as typeof node, document, [3]);
    expect(split.fragments.map((f) => f.style.textAlignLast)).toEqual(["", ""]);
  });
});
