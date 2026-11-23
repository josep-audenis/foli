// @vitest-environment jsdom
// Regressions (second sweep): each test failed before its fix.
import {
  createDocument,
  createEditor,
  type FoliDocument,
  type NodeJSON,
  parseDocument,
  type StoryJSON,
} from "@folijs/core";
import { Resolver } from "@folijs/core/internal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToDoc } from "./clipboard.js";
import { EditorView } from "./index.js";
import { headerHeight } from "./word/pages.js";
import { PageRegions } from "./word/regions.js";

const text = (value: string): NodeJSON => ({ type: "text", text: value });
const p = (...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(...blocks: NodeJSON[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({
    document: parseDocument(createDocument({ type: "doc", content: blocks })),
  });
  const view = new EditorView(host, editor);
  views.push(view);
  view.focus();
  return { host, editor, view };
}

describe("headerHeight", () => {
  /** A table block of rows 20 px tall, the first `headers` of them header rows. */
  const table = (rows: number, headers: number) => {
    const block = document.createElement("div");
    const body = document.createElement("tbody");
    const rect = (top: number, bottom: number) => () => ({ top, bottom }) as DOMRect;
    for (let i = 0; i < rows; i++) {
      const row = document.createElement("tr");
      if (i < headers) row.dataset.foliHeader = "";
      row.getBoundingClientRect = rect(i * 20, (i + 1) * 20);
      body.append(row);
    }
    block.getBoundingClientRect = rect(0, rows * 20);
    block.append(document.createElement("table"));
    block.firstElementChild?.append(body);
    return block;
  };

  it("repeats nothing when every row is a header row (Word: only before a body row)", () => {
    expect(headerHeight(table(3, 1))).toBe(20);
    // Today 60: each continuation would repeat the whole table.
    expect(headerHeight(table(3, 3))).toBe(0);
  });
});

describe("paste as plain text", () => {
  it("does not outlive a Ctrl+Shift+V whose paste event never came", () => {
    const { host, editor } = mount(p());
    const keys = { key: "V", ctrlKey: true, shiftKey: true, cancelable: true };
    host.dispatchEvent(new KeyboardEvent("keydown", keys));
    host.dispatchEvent(new KeyboardEvent("keyup", keys));
    // An ordinary paste later (the menu: no key press).
    const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
    const data: Record<string, string> = { "text/html": "<b>bold</b>", "text/plain": "bold" };
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => data[type] ?? "" },
    });
    host.dispatchEvent(event);
    const [block] = editor.getDocument().content.content as NodeJSON[];
    expect(JSON.stringify(block?.content?.[0]?.marks ?? [])).toContain("bold");
  });
});

describe("htmlToDoc", () => {
  it("reads <p>&nbsp;</p> (Outlook's and web editors' empty line) as an empty paragraph", () => {
    const blocks = htmlToDoc("<p>a</p><p>&nbsp;</p><p>b</p>")?.content ?? [];
    expect(blocks.map((block) => (block as NodeJSON).content?.length ?? 0)).toEqual([1, 0, 1]);
  });
});

describe("destroy", () => {
  it("leaves no cursor on the host while the pointer is on a column border", () => {
    const cell: NodeJSON = { type: "tableCell", content: [p(text("A1"))] };
    const table: NodeJSON = {
      type: "table",
      attrs: { grid: [2000, 3000] },
      content: [{ type: "tableRow", content: [cell, cell] }],
    };
    const { host, view } = mount(p(text("a")), table, p(text("z")));
    // jsdom lays nothing out: every edge is at 0, where the pointer is.
    host
      .querySelector('[data-foli-frame="table"]')
      ?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 0 }));
    expect(host.style.cursor).toBe("col-resize");
    views.splice(0);
    view.destroy();
    expect(host.style.cursor).toBe("");
    expect(host.getAttributeNames()).toEqual([]);
  });
});

describe("page fields in a header", () => {
  const field = (code: string): NodeJSON[] => [
    { type: "fieldStart" },
    { type: "fieldCode", attrs: { text: code } },
    { type: "fieldSeparator" },
    text("1"),
    { type: "fieldEnd" },
  ];
  /** What the header of page `number` shows. */
  const header = (content: NodeJSON[], number = 3) => {
    const story: StoryJSON = { kind: "header", content: { type: "doc", content: [p(...content)] } };
    const doc: FoliDocument = {
      schemaVersion: 5,
      section: {},
      defaults: {},
      styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
      numbering: { abstracts: [], instances: [] },
      comments: [],
      stories: { h: story },
      content: { type: "doc", content: [p(text("body"))] },
    };
    const regions = new PageRegions(document, { measureIn: () => document.body }, new WeakMap());
    regions.setDocument(doc, [{ headers: { default: "h" } }], new Resolver(doc));
    const page = { first: false, number, index: number - 1 };
    return regions.drawing(0, "header", page)?.content.content.textContent;
  };

  it("takes the number format of any `\\*` switch, not only the first", () => {
    expect(header(field(" PAGE "))).toBe("3");
    expect(header(field(" PAGE \\* roman \\* MERGEFORMAT "))).toBe("iii");
    expect(header(field(" PAGE \\* MERGEFORMAT \\* roman "))).toBe("iii");
    expect(header(field(" PAGE \\* MERGEFORMAT \\* Arabic "))).toBe("3");
  });

  it("reads Roman and Alphabetic with an initial capital as the uppercase formats", () => {
    expect(header(field(" PAGE \\* Roman "))).toBe("III");
    expect(header(field(" PAGE \\* Alphabetic "))).toBe("C");
    expect(header(field(" PAGE \\* alphabetic "))).toBe("c");
  });

  it("keeps private-use characters of the text that look like a page field's mark", () => {
    const own = "ab";
    expect(header([text(own), ...field(" PAGE ")])).toBe(`${own}3`);
    expect(header([text(own)])).toBe(own);
  });
});

describe("Ctrl+click on a link to a bookmark (21.8)", () => {
  const target = (): NodeJSON[] => [
    { type: "bookmarkStart", attrs: { id: 1, name: "_Toc1" } },
    text("Target"),
    { type: "bookmarkEnd", attrs: { id: 1 } },
  ];
  const field = (code: string, shown: string): NodeJSON[] => [
    { type: "fieldStart" },
    { type: "fieldCode", attrs: { text: code } },
    { type: "fieldSeparator" },
    text(shown),
    { type: "fieldEnd" },
  ];
  const click = (host: HTMLElement, shown: string, ctrlKey = true) => {
    const span = [...host.querySelectorAll("span")].find((s) => s.textContent === shown);
    span?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey }));
  };
  const selected = (editor: ReturnType<typeof createEditor>) =>
    editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);

  it.each([
    [
      "a link's anchor",
      p({ type: "text", text: "Go", marks: [{ type: "link", attrs: { anchor: "_toc1" } }] }),
    ],
    ["a table of contents' HYPERLINK", p(...field(' HYPERLINK \\l "_Toc1" ', "Go"))],
    ["a cross-reference with \\h", p(...field(" REF _Toc1 \\h ", "Go"))],
  ])("goes to the bookmark from %s", (_, link) => {
    const { host, editor } = mount(link, p(text("between")), p(...target()));
    click(host, "Go", false);
    expect(selected(editor)).toBe("");
    click(host, "Go");
    expect(selected(editor)).toBe("Target");
  });

  it("not from a cross-reference without \\h", () => {
    const { host, editor } = mount(p(...field(" REF _Toc1 ", "Go")), p(...target()));
    click(host, "Go");
    expect(selected(editor)).toBe("");
  });
});

describe("beforeinput types the view does not carry out (21.8)", () => {
  const input = (host: HTMLElement, inputType: string, data: string | null = null) => {
    const event = new InputEvent("beforeinput", { inputType, data, cancelable: true });
    host.dispatchEvent(event);
    return event;
  };

  it("are said once each, never silently dropped; the DOM stays the view's", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, editor } = mount(p(text("abc")));
      const before = JSON.stringify(editor.state.doc.toJSON());
      expect(input(host, "formatJustifyCenter").defaultPrevented).toBe(true);
      input(host, "formatJustifyCenter");
      input(host, "insertTranspose");
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
        `Foli: the browser's "formatJustifyCenter" input is not supported; nothing was changed.`,
        `Foli: the browser's "insertTranspose" input is not supported; nothing was changed.`,
      ]);
      // Paste and drop have their own handlers: nothing said.
      input(host, "insertFromPaste");
      expect(warn).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
    } finally {
      warn.mockRestore();
    }
  });

  it("indents, outdents and yanks", () => {
    const { host, editor } = mount(p(text("abc")));
    input(host, "formatIndent");
    const indent = () =>
      (editor.state.doc.firstChild?.attrs.indent as { left?: number } | null)?.left ?? 0;
    expect(indent()).toBeGreaterThan(0);
    input(host, "formatOutdent");
    expect(indent()).toBe(0);
    input(host, "insertFromYank", "Y");
    expect(editor.state.doc.textContent).toContain("Y");
  });
});
