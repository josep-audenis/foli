// @vitest-environment jsdom
// Regressions (input and clipboard): each test failed before its fix.
import {
  CellSelection,
  createDocument,
  createEditor,
  DEFAULT_SETTINGS,
  type DocJSON,
  type FoliDocumentV2,
  type NodeJSON,
  parseDocument,
} from "@folijs/core";
import { afterEach, describe, expect, it } from "vitest";
import { htmlToDoc } from "./clipboard.js";
import { EditorView } from "./index.js";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

/** Mounts schema v2 paragraphs (migrated), focused. */
function mount(...texts: string[]) {
  const content = {
    type: "doc",
    content: texts.map((text) => ({
      type: "paragraph",
      ...(text ? { content: [{ type: "text", text }] } : {}),
    })),
  } as DocJSON;
  const v2: FoliDocumentV2 = { schemaVersion: 2, settings: DEFAULT_SETTINGS, content };
  const host = document.createElement("div");
  document.body.append(host);
  const editor = createEditor({ document: v2 });
  const view = new EditorView(host, editor);
  views.push(view);
  view.focus();
  return { host, editor, view };
}
const clip = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? "" });
type Block = { attrs?: { borders?: unknown }; content?: { text?: string }[] };
const blocksOf = (editor: ReturnType<typeof createEditor>) =>
  editor.getDocument().content.content as Block[];
const textOf = (block: Block) => (block.content ?? []).map((node) => node.text ?? "").join("");
/** Characters XML 1.0 cannot hold: `exportDocx` throws on them (docx `checkCharacters`). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const UNWRITABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/;

describe("paste: characters a .docx cannot hold", () => {
  it("plain text with a vertical tab (Word's line break) or other control characters", () => {
    const { view, editor } = mount("abcd");
    editor.select(3);
    view.paste(clip({ "text/plain": "x\u000by\u0000z\u000cw" }));
    expect(blocksOf(editor).map(textOf).join("\n")).not.toMatch(UNWRITABLE);
  });

  it("HTML with control characters", () => {
    const { view, editor } = mount("abcd");
    editor.select(3);
    view.paste(clip({ "text/html": "<p>x&#11;y&#1;z</p>" }));
    expect(blocksOf(editor).map(textOf).join("\n")).not.toMatch(UNWRITABLE);
  });
});

describe("paste: a rule at an end of the pasted HTML", () => {
  const ruled = (editor: ReturnType<typeof createEditor>) =>
    blocksOf(editor).filter((block) => block.attrs?.borders);

  it("stays between the pasted text and the text after the caret", () => {
    const { view, editor } = mount("abcd");
    editor.select(3);
    view.paste(clip({ "text/html": "<p>x</p><hr>" }));
    // Today: [abx] [cd, with the rule's border under it].
    expect(ruled(editor).map(textOf)).toEqual([""]);
  });

  it("is kept when it comes first", () => {
    const { view, editor } = mount("abcd");
    editor.select(3);
    view.paste(clip({ "text/html": "<hr><p>x</p>" }));
    // Today: [ab] [xcd], the rule gone.
    expect(ruled(editor)).toHaveLength(1);
  });

  it("is pasted when it is all there is", () => {
    const { view, editor } = mount("abcd", "");
    editor.select(7);
    expect(view.paste(clip({ "text/html": "<hr>" }))).toBe(true);
    expect(ruled(editor)).toHaveLength(1);
  });
});

describe("htmlToDoc", () => {
  it("reads a long run of spaces in preformatted text in linear time", () => {
    const spaces = " ".repeat(80_000);
    const started = performance.now();
    htmlToDoc(`<pre>${spaces}x\ny</pre>`);
    htmlToDoc(`<p><span style="white-space:pre">${spaces}x</span></p>`);
    // Today about 2 s each (` +$` retried from every space); 1 MB of spaces hangs the page.
    expect(performance.now() - started).toBeLessThan(500);
  }, 60_000);

  it("keeps block elements it does not list apart (details, summary, center, legend)", () => {
    const lines = (html: string) =>
      (htmlToDoc(html)?.content ?? []).map((block) => textOf(block as Block));
    expect(lines("<details><summary>Title</summary>Body</details>")).toEqual(["Title", "Body"]);
    expect(lines("<center>one</center><center>two</center>")).toEqual(["one", "two"]);
    expect(lines("<fieldset><legend>Legend</legend>text</fieldset>")).toEqual(["Legend", "text"]);
  });

  it("reads a form feed between words as white space", () => {
    const [block] = htmlToDoc("<p>a\fb</p>")?.content ?? [];
    expect(textOf(block as Block)).toBe("a b");
  });
});

describe("destroy", () => {
  it("leaves none of its attributes on the host after a cell selection", () => {
    const p = (value: string): NodeJSON => ({
      type: "paragraph",
      content: [{ type: "text", text: value }],
    });
    const cell = (value: string): NodeJSON => ({ type: "tableCell", content: [p(value)] });
    const table: NodeJSON = {
      type: "table",
      attrs: { grid: [2000, 3000] },
      content: [{ type: "tableRow", content: [cell("A1"), cell("B1")] }],
    };
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createEditor({
      document: parseDocument(createDocument({ type: "doc", content: [p("a"), table, p("z")] })),
    });
    const view = new EditorView(host, editor);
    view.focus();
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    editor.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, cells[0] as number, cells[1] as number),
      ),
    );
    view.destroy();
    expect(host.getAttributeNames()).toEqual([]);
  });
});

describe("page translation (21.5)", () => {
  it("is off on the editing host while the view is on it", () => {
    const { host, view } = mount("Hello");
    expect(host.getAttribute("translate")).toBe("no");
    view.destroy();
    views.splice(views.indexOf(view), 1);
    expect(host.hasAttribute("translate")).toBe(false);
  });
});
