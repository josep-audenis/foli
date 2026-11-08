// @vitest-environment jsdom
/// <reference types="vite/client" />
import { createDocument, createEditor, type DocJSON, parseContent } from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import googleDocs from "../fixtures/clipboard/google-docs.html?raw";
import googleDocsLists from "../fixtures/clipboard/google-docs-lists.html?raw";
import libreOffice from "../fixtures/clipboard/libreoffice.html?raw";
import webPage from "../fixtures/clipboard/web-page.html?raw";
import word from "../fixtures/clipboard/word.html?raw";
import wordLists from "../fixtures/clipboard/word-lists.html?raw";
import { FOLI_MIME, htmlToDoc, parseColor, serializeRange, textToDoc } from "./clipboard.js";
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
const hr = { type: "horizontalRule" };
const item = (...content: unknown[]) => ({ type: "listItem", content });
const ul = (...items: unknown[]) => ({ type: "bulletList", content: items });
const ol = (start: number, ...items: unknown[]) => ({
  type: "orderedList",
  ...(start !== 1 ? { attrs: { start } } : {}),
  content: items,
});
const pa = (align: string, ...content: unknown[]) => ({
  type: "paragraph",
  attrs: { align },
  ...(content.length ? { content } : {}),
});
/** Text with marks given as JSON (links, colors). */
const tm = (text: string, ...marks: object[]) => ({ type: "text", text, marks });
const link = (href: string) => ({ type: "link", attrs: { href } });
const color = (type: string, value: string) => ({ type, attrs: { color: value } });

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
      ul(item(p(t("First "), t("point", "underline")))),
      p(t("Line one"), br, t("line two  end")),
    ]);
  });

  it("reads Word lists: levels nest, numbers keep their start, colors, alignment, links", () => {
    expect(parsed(wordLists)).toEqual([
      ol(
        3,
        item(
          p(t("Third step")),
          ul(item(p(t("Detail "), tm("red", color("textColor", "#c00000"))))),
        ),
        item(p(t("Fourth step"))),
        item(p(tm("Fifth", color("highlight", "#ffff00")))),
      ),
      pa("center", t("Centered black")),
      // A link inside the source document (#…) keeps its text only.
      p(tm("the report", link("https://example.com/report")), t(" and a heading")),
    ]);
  });

  it("reads Google Docs lists: nested <ul> in <ul>, start, alignment, links, colors, rules", () => {
    expect(parsed(googleDocsLists)).toEqual([
      ul(
        item(p(t("Alpha")), ul(item(p(tm("a link", link("https://example.com/x")))))),
        item(pa("center", tm("Beta", color("highlight", "#ffff00")))),
      ),
      ol(2, item(p(t("Two", "bold")))),
      hr,
      pa("justify", tm("Red", color("textColor", "#ff0000"))),
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
      p(
        t("Read the "),
        tm("docs", link("https://example.com/docs")),
        t(" and use "),
        t("care", "bold"),
        t(", "),
        t("always", "italic"),
        t("."),
      ),
      ul(item(p(t("Item one"))), item(p(t("Item two")))),
      p(t("Nested "), t("div", "bold")),
      p(t("keep   these"), br, t("spaces")),
      p(t("Cell A")),
      p(t("Cell B")),
    ]);
    expect(JSON.stringify(content)).not.toMatch(/alert|steal|never|onerror/);
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

describe("htmlToDoc lists, links, colors, alignment", () => {
  it("nests lists in items and in lists, starts numbers, gives items their first paragraph", () => {
    expect(
      parsed(
        '<ol start="0"><li>a<ul><li>b</li></ul></li><li><h3>c</h3><p>d</p></li><li></li></ol>' +
          "<ul><ul><li>deep</li></ul></ul><ul></ul><li>loose</li>",
      ),
    ).toEqual([
      ol(0, item(p(t("a")), ul(item(p(t("b"))))), item(p(t("c")), p(t("d"))), item(p())),
      ul(item(p(), ul(item(p(t("deep")))))),
      p(t("loose")),
    ]);
    // A start the schema does not take is dropped, not the list.
    expect(parsed('<ol start="-2"><li>x</li></ol><ol start="abc"><li>y</li></ol>')).toEqual([
      ol(1, item(p(t("x")))),
      ol(1, item(p(t("y")))),
    ]);
  });

  it("keeps only safe links: unsafe protocols and in-page anchors keep their text", () => {
    for (const href of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "java\tscript:x",
      "data:text/html,x",
      "vbscript:x",
      "#top",
      "",
    ]) {
      expect(parsed(`<p><a href="${href}">x</a></p>`)).toEqual([p(t("x"))]);
    }
    expect(parsed('<p><a href=" https://a.test/b c ">x</a></p>')).toEqual([
      p(tm("x", link("https://a.test/b%20c"))),
    ]);
    expect(parsed('<p><a href="mailto:a@b.co"><u>m</u></a></p>')).toEqual([
      p(tm("m", link("mailto:a@b.co"))),
    ]);
  });

  it("reads inline colors; black text, white highlight and transparent are defaults", () => {
    expect(
      parsed(
        '<p><span style="color:#C00">a</span><span style="color: rgb(31, 95, 191)">b</span>' +
          '<font color="green">c</font><span style="color:black">d</span>' +
          '<span style="background-color: rgba(255, 255, 0, 1)">e</span>' +
          '<span style="background-color:transparent">f</span><span style="background:#fff">g</span>' +
          '<span style="color:windowtext">h</span></p>' +
          '<div style="background:yellow;color:red"><p>block colors are layout</p></div>',
      ),
    ).toEqual([
      p(
        tm("a", color("textColor", "#cc0000")),
        tm("b", color("textColor", "#1f5fbf")),
        tm("c", color("textColor", "#008000")),
        t("d"),
        tm("e", color("highlight", "#ffff00")),
        t("fgh"),
      ),
      p(t("block colors are layout")),
    ]);
  });

  it("reads block alignment from text-align or align, inherited by blocks inside", () => {
    expect(
      parsed(
        '<p style="text-align:right">r</p><p align="center">c</p><div style="text-align:justify">' +
          '<p>j</p><h2 style="text-align:left">l</h2></div><p style="text-align:start">s</p>',
      ),
    ).toEqual([
      pa("end", t("r")),
      pa("center", t("c")),
      pa("justify", t("j")),
      h(2, t("l")),
      p(t("s")),
    ]);
  });

  it("parseColor reads hex, rgb() and basic names; others are null", () => {
    expect(parseColor("#ABC")).toBe("#aabbcc");
    expect(parseColor(" #A1b2C3 ")).toBe("#a1b2c3");
    expect(parseColor("rgb(255,0,128)")).toBe("#ff0080");
    expect(parseColor("rgb(255 0 128 / 50%)")).toBe("#ff0080");
    expect(parseColor("rgba(1, 2, 3, 0)")).toBeNull();
    expect(parseColor("Navy")).toBe("#000080");
    for (const value of ["", "transparent", "windowtext", "inherit", "#12345", "hsl(0,0%,0%)"]) {
      expect(parseColor(value)).toBeNull();
    }
  });

  it("copy writes HTML that reads back as the same document", () => {
    const content = [
      pa("center", t("Title", "bold")),
      ol(
        4,
        item(
          p(
            tm("link", link("https://a.test/")),
            t(" and "),
            tm("red", color("textColor", "#c00000")),
          ),
          ul(item(p(tm("lit", color("highlight", "#fff59d"))))),
        ),
      ),
      hr,
      pa("justify", t("end")),
    ];
    const doc = parseContent({ type: "doc", content } as DocJSON);
    const { html } = serializeRange(doc, 0, doc.content.size, document);
    expect(parsed(html)).toEqual(content);
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

  it("does not read Word's column break as a page break", () => {
    expect(parsed("<p>a<br clear=all style='mso-column-break-before:always'>b</p>")).toEqual([
      p(t("a"), br, t("b")),
    ]);
  });

  it("keeps an ordinary <br> and <hr> what they were", () => {
    expect(parsed("<p>a<br>b</p><hr><p>c</p>")).toEqual([p(t("a"), br, t("b")), hr, p(t("c"))]);
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

  it("autolinks pasted text that is one URL: inserted as a link, or linking the selection", () => {
    const link = (href: string) => ({ type: "link", attrs: { href } });
    const { editor, view } = mount(doc(p(t("ab"))));
    editor.select(2);
    expect(view.paste(data({ "text/plain": " www.example.com\n", "text/html": "<p>x</p>" }))).toBe(
      true,
    );
    expect(blocks(editor)).toEqual([
      p(t("a"), { ...t("www.example.com"), marks: [link("https://www.example.com")] }, t("b")),
    ]);
    // Its own undo step.
    editor.commands.undo();
    expect(blocks(editor)).toEqual([p(t("ab"))]);
    editor.select(1, 3);
    expect(view.paste(data({ "text/plain": "https://x.test\\a" }))).toBe(true);
    expect(blocks(editor)).toEqual([p({ ...t("ab"), marks: [link("https://x.test/a")] })]);
    // Unsafe or not a lone URL: plain text.
    editor.select(3);
    view.paste(data({ "text/plain": "javascript:alert(1)" }));
    view.paste(data({ "text/plain": " see https://x.test" }));
    expect(editor.state.doc.textContent).toBe("abjavascript:alert(1) see https://x.test");
    expect(JSON.stringify(blocks(editor))).not.toContain('javascript:alert(1)","marks');
  });

  it("does not autolink a paste as plain text (Ctrl+Shift+V), nor Foli content", () => {
    const { host, editor } = mount(doc(p()));
    host.dispatchEvent(
      new KeyboardEvent("keydown", { key: "V", ctrlKey: true, shiftKey: true, cancelable: true }),
    );
    const { event, store } = clipboardEvent("paste");
    store.set("text/plain", "https://x.test");
    host.dispatchEvent(event);
    expect(blocks(editor)).toEqual([p(t("https://x.test"))]);
    const json = JSON.stringify({ open: true, content: doc(p(t("foli"))) });
    view?.paste(data({ [FOLI_MIME]: json, "text/plain": "https://x.test" }));
    expect(editor.state.doc.textContent).toBe("https://x.testfoli");
  });

  it("rejects Foli JSON with an unsafe link (falls back to the plain text)", () => {
    const { editor, view } = mount(doc(p()));
    const evil = {
      ...t("click"),
      marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
    };
    view.paste(
      data({
        [FOLI_MIME]: JSON.stringify({ open: true, content: doc(p(evil)) }),
        "text/plain": "click",
      }),
    );
    expect(blocks(editor)).toEqual([p(t("click"))]);
  });

  it("T3: every fixture pastes at every text position without corrupting the document", {
    timeout: 60_000,
  }, () => {
    const fixtures = [word, wordLists, googleDocs, googleDocsLists, libreOffice, webPage];
    const targets = [
      doc(p(t("ab")), h(2, t("cd"))),
      doc(ul(item(p(t("ab")), p()), item(p(t("cd")), ol(1, item(p(t("ef"))))))),
      doc(p(), hr, p(t("gh"))),
    ];
    let pastes = 0;
    for (const html of fixtures) {
      // Each pasted textblock's text must be in the result, in one piece.
      const pieces: string[] = [];
      parseContent(htmlToDoc(html) as DocJSON).descendants((node) => {
        if (node.isTextblock && node.textContent) pieces.push(node.textContent);
        return !node.isTextblock;
      });
      for (const target of targets) {
        const { editor, view } = mount(target);
        const positions: number[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock)
            for (let i = 0; i <= node.content.size; i++) positions.push(pos + 1 + i);
        });
        for (const at of positions) {
          const before = editor.state.doc;
          editor.select(at);
          expect(view.paste(data({ "text/html": html }))).toBe(true);
          editor.state.doc.check();
          for (const piece of pieces) expect(editor.state.doc.textContent).toContain(piece);
          editor.commands.undo();
          expect(editor.state.doc.eq(before)).toBe(true);
          pastes++;
        }
        view.destroy();
      }
    }
    expect(pastes).toBeGreaterThan(100);
  });

  it("pastes a list into a paragraph: split around it, at its start or end; undo restores", () => {
    const list = "<ul><li>a</li><li>b</li></ul>";
    const pastedList = ul(item(p(t("a"))), item(p(t("b"))));
    const cases: [number, unknown[]][] = [
      [2, [p(t("x")), pastedList, p(t("y"))]],
      [1, [pastedList, p(t("xy"))]],
      [3, [p(t("xy")), pastedList]],
    ];
    for (const [at, after] of cases) {
      const { editor, view } = mount(doc(p(t("xy"))));
      editor.select(at);
      expect(view.paste(data({ "text/html": list }))).toBe(true);
      expect(blocks(editor)).toEqual(after);
      expect(editor.state.selection.$from.parent.textContent).toBe("b"); // after the paste
      editor.commands.undo();
      expect(blocks(editor)).toEqual([p(t("xy"))]);
      view.destroy();
    }
  });

  it("pastes a list into a list item as sibling items (an empty item is replaced)", () => {
    const list = "<ol><li>a</li><li>b</li></ol>";
    const into = (blocksBefore: unknown[], at: number) => {
      const { editor, view } = mount(doc(...blocksBefore));
      editor.select(at);
      expect(view.paste(data({ "text/html": list }))).toBe(true);
      const result = blocks(editor);
      view.destroy();
      return result;
    };
    const a = item(p(t("a")));
    const b = item(p(t("b")));
    expect(into([ul(item(p(t("xy"))))], 4)).toEqual([ul(item(p(t("x"))), a, b, item(p(t("y"))))]);
    expect(into([ul(item(p(t("xy"))))], 5)).toEqual([ul(item(p(t("xy"))), a, b)]);
    expect(into([ul(item(p(t("xy"))))], 3)).toEqual([ul(a, b, item(p(t("xy"))))]);
    expect(into([ul(item(p(t("xy"))), item(p()))], 9)).toEqual([ul(item(p(t("xy"))), a, b)]);
  });

  it("keeps an item's first paragraph first, replaces an empty nested one, keeps rules", () => {
    const start = mount(doc(ul(item(p(t("xy"))))));
    start.editor.select(3); // the start of the item's (first) paragraph
    expect(start.view.paste(data({ "text/html": "<hr><ul><li>b</li></ul>" }))).toBe(true);
    expect(blocks(start.editor)).toEqual([ul(item(p(), hr, ul(item(p(t("b")))), p(t("xy"))))]);
    start.view.destroy();
    const nested = mount(doc(ul(item(p(t("x")), p()))));
    nested.editor.select(6); // in the empty second paragraph
    expect(nested.view.paste(data({ "text/html": "<p>A</p><ul><li>b</li></ul>" }))).toBe(true);
    expect(blocks(nested.editor)).toEqual([ul(item(p(t("x")), p(t("A")), ul(item(p(t("b"))))))]);
    // A rule pasted with text into a paragraph's middle stays a rule.
    const middle = mount(doc(p(t("xy"))));
    middle.editor.select(2);
    expect(middle.view.paste(data({ "text/html": "<p>A</p><hr><p>B</p>" }))).toBe(true);
    expect(blocks(middle.editor)).toEqual([p(t("xA")), hr, p(t("By"))]);
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
