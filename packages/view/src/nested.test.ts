// @vitest-environment jsdom
import {
  createDocument,
  createEditor,
  type DocJSON,
  NodeSelection,
  TextSelection,
} from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { serializeRange } from "./clipboard.js";
import { EditorView } from "./index.js";

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
