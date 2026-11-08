import { describe, expect, it } from "vitest";
import { createDocument } from "../document.js";
import type { NodeJSON } from "../model/index.js";
import type { DocJSON } from "../schema.js";
import { isSafeHref } from "../schema.js";
import {
  autolinkHref,
  createEditor,
  type Editor,
  insertLink,
  linkAt,
  NodeSelection,
  normalizeHref,
  requestsLinkEditor,
  type Transaction,
} from "./index.js";

const link = (href: string) => ({ type: "link", attrs: { href } });
const t = (text: string, ...marks: object[]): NodeJSON =>
  (marks.length ? { type: "text", text, marks } : { type: "text", text }) as NodeJSON;
const p = (...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});
const h1 = (...content: NodeJSON[]): NodeJSON => ({
  type: "heading",
  attrs: { level: 1 },
  content,
});

function editorWith(...blocks: NodeJSON[]): Editor {
  return createEditor({ document: createDocument({ type: "doc", content: blocks } as DocJSON) });
}
const json = (editor: Editor) => editor.getDocument().content.content;

/** Runs `act`, checks the result, then undo restores the exact document and selection. */
function expectUndoable(editor: Editor, act: () => boolean, after: NodeJSON[]): void {
  const before = editor.state.doc;
  const selection = editor.state.selection;
  expect(act()).toBe(true);
  expect(json(editor)).toEqual(after);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.eq(before)).toBe(true);
  expect(editor.state.selection.eq(selection)).toBe(true);
}

const UNSAFE = [
  "javascript:alert(1)",
  " JavaScript:alert(1)",
  "java\tscript:alert(1)",
  "jav\u0000ascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "",
  "   ",
];

describe("normalizeHref and autolinkHref", () => {
  it("trims, turns backslashes into slashes, percent-encodes spaces, adds a left-out scheme", () => {
    expect(normalizeHref("  https://example.com/a b  ")).toBe("https://example.com/a%20b");
    expect(normalizeHref("https:\\\\example.com\\x")).toBe("https://example.com/x");
    expect(normalizeHref("example.com")).toBe("https://example.com");
    expect(normalizeHref("www.example.com/path?q=1")).toBe("https://www.example.com/path?q=1");
    expect(normalizeHref("sub.example.org:8080/x")).toBe("https://sub.example.org:8080/x");
    expect(normalizeHref("someone@example.com")).toBe("mailto:someone@example.com");
    // Host names and email addresses in any script.
    expect(normalizeHref("пример.рф/путь")).toBe("https://пример.рф/путь");
    expect(normalizeHref("имя@пример.рф")).toBe("mailto:имя@пример.рф");
    expect(isSafeHref(normalizeHref("пример.рф"))).toBe(true);
    // Already complete, or relative: unchanged.
    for (const href of ["https://example.com", "mailto:a@b.co", "tel:+34600", "/docs", "#top"]) {
      expect(normalizeHref(href)).toBe(href);
    }
    expect(normalizeHref("./page.html")).toBe("./page.html");
    // Normalizing twice changes nothing.
    expect(normalizeHref(normalizeHref(" www.a.com/b c "))).toBe("https://www.a.com/b%20c");
  });

  it("never turns an unsafe href into a safe-looking one", () => {
    for (const href of UNSAFE) expect(isSafeHref(normalizeHref(href))).toBe(false);
  });

  it("autolinks pasted text that is one URL, and nothing else", () => {
    expect(autolinkHref(" https://example.com/x \n")).toBe("https://example.com/x");
    expect(autolinkHref("www.example.com")).toBe("https://www.example.com");
    expect(autolinkHref("mailto:a@b.co")).toBe("mailto:a@b.co");
    for (const text of ["see https://a.com", "https://a.com b", "example.com", "hello", ""]) {
      expect(autolinkHref(text)).toBeNull();
    }
    for (const text of UNSAFE) expect(autolinkHref(text)).toBeNull();
    // Looks like a URL but holds a control character: not a safe href.
    expect(autolinkHref("https://a.test/\u0001x")).toBeNull();
  });
});

describe("link commands", () => {
  it("setLink links the selection, normalized, replacing a link there", () => {
    const editor = editorWith(p(t("go here", link("https://old.com")), t(" now")));
    editor.select(1, 8);
    expectUndoable(editor, () => editor.commands.setLink(" example.com "), [
      p(t("go here", link("https://example.com")), t(" now")),
    ]);
    editor.select(4, 12);
    expect(editor.commands.setLink("https://x.org")).toBe(true);
    expect(json(editor)).toEqual([
      p(t("go ", link("https://old.com")), t("here now", link("https://x.org"))),
    ]);
  });

  it("setLink at a caret in or just after a link changes the whole link", () => {
    const editor = editorWith(p(t("a "), t("link", link("https://old.com")), t(" b")));
    for (const pos of [4, 7]) {
      editor.select(pos);
      expect(linkAt(editor.state)).toBe("https://old.com");
      expectUndoable(editor, () => editor.commands.setLink("https://new.com"), [
        p(t("a "), t("link", link("https://new.com")), t(" b")),
      ]);
    }
  });

  it("a caret between two different links edits the one before it", () => {
    const editor = editorWith(p(t("ab", link("https://a.test")), t("cd", link("https://c.test"))));
    editor.select(3);
    expect(linkAt(editor.state)).toBe("https://a.test");
    expect(editor.commands.setLink("https://z.test")).toBe(true);
    expect(json(editor)).toEqual([
      p(t("ab", link("https://z.test")), t("cd", link("https://c.test"))),
    ]);
    // The same link again changes nothing: the command does not apply.
    expect(editor.commands.setLink("z.test")).toBe(false);
  });

  it("setLink at a caret outside links inserts the href as linked text", () => {
    const editor = editorWith(p(t("ab", { type: "bold" })));
    editor.select(2);
    expectUndoable(editor, () => editor.commands.setLink("x.com"), [
      p(
        t("a", { type: "bold" }),
        t("https://x.com", link("https://x.com"), { type: "bold" }),
        t("b", { type: "bold" }),
      ),
    ]);
    expect(editor.commands.setLink("x.com")).toBe(true);
    // The caret ends after the link; typing there is not linked (links are not inclusive).
    editor.commands.insertText("!");
    expect(linkAt(editor.state)).toBeNull();
  });

  it("every unsafe href is rejected: nothing changes", () => {
    const editor = editorWith(p(t("text")));
    for (const href of UNSAFE) {
      editor.select(1, 5);
      expect(editor.commands.setLink(href)).toBe(false);
      editor.select(2);
      expect(editor.commands.setLink(href)).toBe(false);
    }
    for (const href of UNSAFE) expect(editor.run(insertLink(href, "x"))).toBe(false);
    expect(json(editor)).toEqual([p(t("text"))]);
    expect(editor.commands.undo()).toBe(false);
  });

  it("removeLink removes the link around a caret, or the links in a range", () => {
    const editor = editorWith(p(t("a "), t("link", link("https://a.com")), t(" b")));
    editor.select(5);
    expectUndoable(editor, () => editor.commands.removeLink(), [p(t("a link b"))]);
    editor.select(1, 5);
    expectUndoable(editor, () => editor.commands.removeLink(), [
      p(t("a li"), t("nk", link("https://a.com")), t(" b")),
    ]);
    editor.select(1);
    expect(editor.commands.removeLink()).toBe(false);
  });

  it("linkAt gives the one link of a range, else null", () => {
    const editor = editorWith(
      p(t("ab", link("https://a.com")), t("cd", link("https://c.com")), t("ef")),
    );
    editor.select(1, 3);
    expect(linkAt(editor.state)).toBe("https://a.com");
    editor.select(1, 5);
    expect(linkAt(editor.state)).toBeNull();
    editor.select(5, 7);
    expect(linkAt(editor.state)).toBeNull();
    editor.commands.selectAll();
    expect(linkAt(editor.state)).toBeNull();
  });

  it("links work in headings and over several blocks; not on a rule", () => {
    const editor = editorWith(h1(t("title")), p(t("body")));
    editor.commands.selectAll();
    expect(editor.commands.setLink("https://a.com")).toBe(true);
    expect(json(editor)).toEqual([
      h1(t("title", link("https://a.com"))),
      p(t("body", link("https://a.com"))),
    ]);
    const rule = editorWith(p(t("a")), { type: "horizontalRule" });
    rule.dispatch(rule.state.tr.setSelection(NodeSelection.create(rule.state.doc, 3)));
    expect(rule.commands.setLink("https://a.com")).toBe(false);
    expect(rule.handleKey("Mod-k")).toBe(false);
  });

  it("Mod-K asks the UI for its link editor with a transaction that changes nothing", () => {
    const editor = editorWith(p(t("text")));
    const seen: Transaction[] = [];
    editor.subscribe((_state, transactions) => seen.push(...transactions));
    editor.select(2);
    seen.length = 0;
    const doc = editor.state.doc;
    expect(editor.handleKey("Mod-k")).toBe(true);
    expect(seen.some(requestsLinkEditor)).toBe(true);
    expect(editor.state.doc).toBe(doc);
    expect(editor.commands.undo()).toBe(false);
  });
});
