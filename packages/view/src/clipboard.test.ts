// @vitest-environment jsdom
/// <reference types="vite/client" />
import { createDocument, createEditor, type DocJSON, parseContent } from "@foli/core";
import { afterEach, describe, expect, it } from "vitest";
import googleDocs from "../fixtures/clipboard/google-docs.html?raw";
import libreOffice from "../fixtures/clipboard/libreoffice.html?raw";
import webPage from "../fixtures/clipboard/web-page.html?raw";
import word from "../fixtures/clipboard/word.html?raw";
import { FOLI_MIME, htmlToDoc, textToDoc } from "./clipboard.js";
import { EditorView } from "./view.js";

/** The parsed HTML after schema validation and normalization (what paste inserts). */
const parsed = (html: string) => {
  const doc = htmlToDoc(html);
  return doc ? (parseContent(doc).toJSON() as DocJSON).content : null;
};

const p = (...content: unknown[]) => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});
const h = (level: number, ...content: unknown[]) => ({
  type: "heading",
  attrs: { level },
  content,
});
const t = (text: string, ...marks: string[]) => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const br = { type: "hardBreak" };

describe("htmlToDoc fixtures", () => {
  it("reads Word HTML: classes, <o:p>, list bullets and conditional comments dropped", () => {
    expect(parsed(word)).toEqual([
      h(1, t("Quarterly report")),
      p(
        t("Revenue grew "),
        t("twelve percent", "bold"),
        t(" and "),
        t("margins", "italic"),
        t(" held."),
      ),
      p(),
      p(t("First "), t("point", "underline")),
      p(t("Line one"), br, t("line two  end")),
    ]);
  });

  it("reads Google Docs HTML: the normal-weight wrapper, styled spans, <br> as empty line", () => {
    expect(parsed(googleDocs)).toEqual([
      h(2, t("Meeting notes")),
      p(t("Decided: "), t("ship it", "bold"), t("  soon", "italic")),
      p(),
      p(t("Owner", "underline"), t(" nobody", "strike")),
    ]);
  });

  it("reads LibreOffice HTML: <font>, source line breaks, <br/> empty paragraph", () => {
    expect(parsed(libreOffice)).toEqual([
      h(2, t("Chapter one")),
      p(t("It was a "), t("dark", "bold"), t(" and "), t("stormy", "italic"), t(" night.")),
      p(),
      p(t("Underlined", "underline"), t(" and "), t("struck", "strike"), t(".")),
    ]);
  });

  it("reads a web page: drops scripts, images and handlers, keeps link text, flattens blocks", () => {
    const content = parsed(webPage);
    expect(content).toEqual([
      h(2, t("How to paste", "bold")),
      p(t("Read the docs and use "), t("care", "bold"), t(", "), t("always", "italic"), t(".")),
      p(t("Item one")),
      p(t("Item two")),
      p(t("Nested "), t("div", "bold")),
      p(t("keep   these"), br, t("spaces")),
      p(t("Cell A")),
      p(t("Cell B")),
    ]);
    expect(JSON.stringify(content)).not.toMatch(/alert|steal|never|onerror|https:/);
  });
});

describe("htmlToDoc rules", () => {
  it("collapses whitespace like HTML layout and drops a trailing <br>", () => {
    expect(parsed("<p>  a \n  b  <br>  c <br></p>")).toEqual([p(t("a b"), br, t("c"))]);
  });

  it("does not trust prototype names as tags", () => {
    expect(parsed("<p><constructor>x</constructor><tostring>y</tostring></p>")).toEqual([
      p(t("xy")),
    ]);
  });

  it("keeps trailing non-breaking spaces and spaces in pre", () => {
    expect(parsed("<p>a&nbsp;</p><pre>b  </pre>")).toEqual([p(t("a ")), p(t("b  "))]);
  });

  it("drops hidden text", () => {
    expect(
      parsed(
        '<p>a<span style="display:none">X</span><span hidden>Y</span><span style="mso-hide:all">Z</span></p>',
      ),
    ).toEqual([p(t("a"))]);
  });

  it("keeps an inherited underline that a child cannot remove in CSS", () => {
    expect(parsed('<u><span style="text-decoration:none">x</span></u>')).toEqual([
      p(t("x", "underline")),
    ]);
  });

  it("reads a <br> between blocks as an empty line, whatever the source formatting", () => {
    expect(parsed("<p>a</p>\n<br>\n<p>b</p>")).toEqual([p(t("a")), p(), p(t("b"))]);
  });

  it("returns null when nothing readable is left", () => {
    expect(htmlToDoc("<script>x</script><img src=x>")).toBeNull();
  });
});

describe("htmlToDoc page breaks", () => {
  const pb = { type: "pageBreak" };
  it("reads Word's and Foli's page-break <br>", () => {
    expect(
      parsed(
        "<p>a<br clear=all style='mso-special-character:line-break;page-break-before:always'>b</p>",
      ),
    ).toEqual([p(t("a"), pb, t("b"))]);
    expect(parsed('<p>a<br data-page-break="">b</p>')).toEqual([p(t("a"), pb, t("b"))]);
    expect(parsed('<p>a<br style="break-before: page">b</p>')).toEqual([p(t("a"), pb, t("b"))]);
  });

  it("reads Google Docs' hidden <hr> between blocks into the end of the previous one", () => {
    expect(parsed('<p>a</p><hr style="page-break-before:always;display:none;"><p>b</p>')).toEqual([
      p(t("a"), pb),
      p(t("b")),
    ]);
    expect(parsed('<hr style="page-break-after: always"><p>b</p>')).toEqual([p(pb), p(t("b"))]);
  });

  it("keeps an ordinary <br> and <hr> what they were", () => {
    expect(parsed("<p>a<br>b</p><hr><p>c</p>")).toEqual([p(t("a"), br, t("b")), p(t("c"))]);
  });
});

describe("textToDoc", () => {
  it("makes one paragraph per line, with the given marks", () => {
    expect(textToDoc("a\r\n\nb", [{ type: "bold" }]).content).toEqual([
      p(t("a", "bold")),
      p(),
      p(t("b", "bold")),
    ]);
  });
});

describe("EditorView clipboard", () => {
  let view: EditorView | undefined;
  afterEach(() => {
    view?.destroy();
    view?.host.remove();
  });

  function mount(content: DocJSON) {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({ document: createDocument(content) });
    view = new EditorView(host, editor);
    view.focus();
    return { host, editor, view };
  }
  const doc = (...content: unknown[]) => ({ type: "doc", content }) as DocJSON;
  const data = (types: Record<string, string>) => ({
    getData: (type: string) => types[type] ?? "",
  });
  const blocks = (editor: ReturnType<typeof mount>["editor"]) =>
    editor.getDocument().content.content;

  function clipboardEvent(type: string) {
    const store = new Map<string, string>();
    const event = new Event(type, { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (k: string, v: string) => store.set(k, v),
        getData: (k: string) => store.get(k) ?? "",
      },
    });
    return { event, store };
  }

  it("copies a page break as a line break in text and a page-breaking <br> in HTML", () => {
    const { host, editor } = mount(doc(p(t("a"), { type: "pageBreak" }, t("b"))));
    editor.select(1, 4);
    const { event, store } = clipboardEvent("copy");
    host.dispatchEvent(event);
    expect(store.get("text/plain")).toBe("a\nb");
    expect(store.get("text/html")).toBe(
      '<p style="white-space: pre-wrap;">a<br data-page-break="" style="page-break-before: always; break-before: page;">b</p>',
    );
    expect(JSON.parse(store.get(FOLI_MIME) ?? "").content.content[0].content[1]).toEqual({
      type: "pageBreak",
    });
  });

  it("copies the model selection as text, HTML and Foli JSON", () => {
    const { host, editor } = mount(doc(p(t("ab"), t("cd", "bold")), h(2, t("ef"))));
    editor.select(2, 8); // "b" + bold "cd" | heading "e"
    const { event, store } = clipboardEvent("copy");
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(store.get("text/plain")).toBe("bcd\ne");
    expect(store.get("text/html")).toBe(
      '<p style="white-space: pre-wrap;">b<strong>cd</strong></p><h2 style="white-space: pre-wrap;">e</h2>',
    );
    expect(JSON.parse(store.get(FOLI_MIME) ?? "")).toEqual({
      open: false,
      content: doc(p(t("b"), t("cd", "bold")), h(2, t("e"))),
    });
  });

  /** Copies `from..to` of `content` and returns the clipboard types. */
  function copy(content: DocJSON, from: number, to: number) {
    const { host, editor } = mount(content);
    editor.select(from, to);
    const { event, store } = clipboardEvent("copy");
    host.dispatchEvent(event);
    view?.destroy();
    view?.host.remove();
    view = undefined;
    return Object.fromEntries(store);
  }

  it("keeps the target block type when pasting text copied from inside a heading", () => {
    const copied = copy(doc(h(1, t("Big title"))), 1, 4); // "Big"
    expect(JSON.parse(copied[FOLI_MIME] ?? "").open).toBe(true);
    const { editor, view: target } = mount(doc(p(t("a")), p()));
    editor.select(4);
    target.paste(data(copied));
    expect(blocks(editor)).toEqual([p(t("a")), p(t("Big"))]);
  });

  it("keeps repeated and leading spaces through the HTML copy", () => {
    const copied = copy(doc(h(3, t("  two  spaces"))), 1, 14);
    const { editor, view: target } = mount(doc(p(t("x"))));
    editor.select(2);
    target.paste(data({ "text/html": copied["text/html"] ?? "" }));
    expect(blocks(editor)).toEqual([p(t("x  two  spaces"))]);
  });

  it("cut copies and deletes as its own undo step", () => {
    const { host, editor } = mount(doc(p(t("ab"))));
    editor.select(2);
    editor.commands.insertText("xyz"); // typing just before the cut
    editor.select(3, 5);
    const { event, store } = clipboardEvent("cut");
    host.dispatchEvent(event);
    expect(store.get("text/plain")).toBe("yz");
    expect(blocks(editor)).toEqual([p(t("axb"))]);
    editor.commands.undo();
    expect(blocks(editor)).toEqual([p(t("axyzb"))]);
  });

  it("pastes Foli JSON first and joins its open ends with the text around the caret", () => {
    const { editor, view } = mount(doc(p(t("xy"))));
    editor.select(2);
    const json = JSON.stringify({
      open: false,
      content: doc(p(t("b"), t("cd", "bold")), h(2, t("e"))),
    });
    expect(
      view.paste(data({ [FOLI_MIME]: json, "text/html": "<p>no</p>", "text/plain": "no" })),
    ).toBe(true);
    // The open end is a heading: the text after the caret joins it.
    expect(blocks(editor)).toEqual([p(t("xb"), t("cd", "bold")), h(2, t("ey"))]);
    editor.commands.undo();
    expect(blocks(editor)).toEqual([p(t("xy"))]);
  });

  it("falls back from invalid Foli JSON to HTML, and from HTML to plain text", () => {
    const { editor, view } = mount(doc(p()));
    view.paste(
      data({ [FOLI_MIME]: '{"type":"doc","content":[{"type":"evil"}]}', "text/html": "<b>h</b>" }),
    );
    expect(blocks(editor)).toEqual([p(t("h", "bold"))]);
    view.paste(data({ "text/html": "<script></script>", "text/plain": "1\n2" }));
    expect(blocks(editor)).toEqual([p(t("h1", "bold")), p(t("2", "bold"))]);
  });

  it("pastes plain text with the marks typing would get, over a selection", () => {
    const { editor, view } = mount(doc(p(t("ab", "italic"), t("cd"))));
    editor.select(2, 4);
    view.paste(data({ "text/plain": "X" }));
    expect(blocks(editor)).toEqual([p(t("aX", "italic"), t("d"))]);
  });

  it("pastes whole blocks into an empty block, so a heading stays a heading", () => {
    const { editor, view } = mount(doc(p(t("a")), p(), p(t("b"))));
    editor.select(4);
    view.paste(data({ "text/html": "<h2>Title</h2><p>text</p>" }));
    expect(blocks(editor)).toEqual([p(t("a")), h(2, t("Title")), p(t("text")), p(t("b"))]);
    expect(editor.state.selection.head).toBe(15); // end of "text"
  });

  it("keeps an empty heading a heading when pasting plain text or inline HTML", () => {
    const { editor, view } = mount(doc(h(1), p(t("b"))));
    editor.select(1);
    view.paste(data({ "text/plain": "Title" }));
    expect(blocks(editor)).toEqual([h(1, t("Title")), p(t("b"))]);
    view.paste(data({ "text/html": "<meta charset='utf-8'><span>&nbsp;and more</span>" }));
    expect(blocks(editor)).toEqual([h(1, t("Title and more")), p(t("b"))]);
  });

  it("pastes plain text on Ctrl/Cmd+Shift+V", () => {
    const { host, editor } = mount(doc(p()));
    const mod = { ctrlKey: true, cancelable: true }; // Mod in jsdom
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "V", shiftKey: true, ...mod }));
    const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: data({ "text/html": "<b>bold</b>", "text/plain": "bold" }),
    });
    host.dispatchEvent(event);
    expect(blocks(editor)).toEqual([p(t("bold"))]);
  });

  it("ignores a paste during a composition", () => {
    const { host, editor } = mount(doc(p()));
    host.dispatchEvent(new CompositionEvent("compositionstart"));
    const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: data({ "text/plain": "x" }) });
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(blocks(editor)).toEqual([p()]);
  });

  it("pastes over a select-all", () => {
    const { editor, view } = mount(doc(h(1, t("old")), p(t("text"))));
    editor.commands.selectAll();
    view.paste(data({ "text/plain": "new" }));
    expect(blocks(editor)).toEqual([p(t("new"))]);
  });
});
