import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import type { ControlJSON, FoliDocument } from "../v3/document.js";
import { createDocument, SCHEMA_VERSION } from "../v3/document.js";
import { createEditor, type Editor } from "./editor.js";
import { toggleFieldCodes } from "./fields.js";
import { findAll, findInText, nextMatch, replace, replaceAll } from "./find.js";
import { undoDepth } from "./history.js";
import { rejectAllChanges } from "./review.js";
import { setReviewView } from "./track.js";

type Inline = NodeJSON | string;
const t = (text: string, ...marks: string[]): NodeJSON => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const p = (...content: Inline[]): NodeJSON => ({
  type: "paragraph",
  content: content.map((c) => (typeof c === "string" ? t(c) : c)),
});
const atom = (type: string, attrs?: Record<string, unknown>): NodeJSON => ({
  type,
  ...(attrs ? { attrs } : {}),
});
const docOf = (...content: NodeJSON[]): NodeJSON => ({ type: "doc", content });
const field = (code: string, ...result: Inline[]): NodeJSON[] => [
  atom("fieldStart"),
  atom("fieldCode", { text: code }),
  atom("fieldSeparator"),
  ...result.map((c) => (typeof c === "string" ? t(c) : c)),
  atom("fieldEnd"),
];
const control = (id: string, ...content: Inline[]): NodeJSON[] => [
  atom("controlStart", { id }),
  ...content.map((c) => (typeof c === "string" ? t(c) : c)),
  atom("controlEnd", { id }),
];

function documentOf(content: NodeJSON[], more: Partial<FoliDocument> = {}): FoliDocument {
  return {
    ...createDocument(),
    schemaVersion: SCHEMA_VERSION,
    content: docOf(...content),
    ...more,
  };
}
const open = (content: NodeJSON[], more: Partial<FoliDocument> = {}, track = false) =>
  createEditor({ document: documentOf(content, more), trackChanges: track, author: "Me" });
const texts = (editor: Editor, query: string, options = {}) =>
  findAll(editor, query, options).map((m) => m.text);
const STORIES: FoliDocument["stories"] = {
  h1: { kind: "header", content: docOf(p("cat in the header")) },
  "footnote:1": { kind: "footnote", content: docOf(p(atom("noteMark"), " a cat in a note")) },
  "footnote:-1": { kind: "footnote", noteType: "separator", content: docOf(p("cat")) },
};
const paragraphs = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((node) => {
    out.push(node.textContent);
  });
  return out;
};
const storyText = (editor: Editor, id: string) => editor.story(id)?.state.doc.textContent;

describe("findInText, Word's rules", () => {
  const words = (text: string, query: string, options = {}) =>
    findInText(text, query, options).map(([a, b]) => `${a}:${text.slice(a, b)}`);

  it("whole words end at anything but letters and digits", () => {
    const text = "Cat cat's cat-fish cat_fish cat1 1cat concat (cat) cat.";
    expect(words(text, "cat", { wholeWord: true })).toEqual([
      "0:Cat",
      "4:cat",
      "10:cat",
      "19:cat",
      "46:cat",
      "51:cat",
    ]);
  });

  it("ignores whole words when the query has a space", () => {
    expect(words("1cat cat2", "cat cat", { wholeWord: true })).toEqual(["1:cat cat"]);
  });

  it("checks whole words only on an end that is a word character", () => {
    expect(words("cat.x", "cat.", { wholeWord: true })).toEqual(["0:cat."]);
    expect(words("x-cat", "-cat", { wholeWord: true })).toEqual(["1:-cat"]);
  });

  it("folds case but not accents or expansions", () => {
    const text = "café cafe CAFÉ straße STRASSE";
    expect(words(text, "cafe")).toEqual(["5:cafe"]);
    expect(words(text, "café").length).toBe(2);
    expect(words(text, "café", { matchCase: true })).toEqual(["0:café"]);
    expect(words(text, "strasse")).toEqual(["22:STRASSE"]);
  });

  it("keeps offsets where lower case changes a length", () => {
    expect(findInText("İx cat", "cat")).toEqual([[3, 6]]);
  });

  it("finds curly quotes and no-break spaces from the plain ones only", () => {
    const text = "it’s it's a b a b “q”";
    expect(words(text, "it's").length).toBe(2);
    expect(words(text, "it’s")).toEqual(["0:it’s"]);
    expect(words(text, "a b").length).toBe(2);
    expect(words(text, "a b").length).toBe(1);
    expect(words(text, '"').length).toBe(2);
  });

  it("does not overlap, and an empty query finds nothing", () => {
    expect(findInText("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(findInText("abc", "")).toEqual([]);
  });
});

describe("findAll", () => {
  it("covers the body and the stories, not note separators, with the story's id", () => {
    const editor = open([p("a cat")], { stories: STORIES });
    expect(findAll(editor, "cat").map((m) => m.story)).toEqual([null, "h1", "footnote:1"]);
    const [body, header] = findAll(editor, "cat");
    expect(body).toMatchObject({ from: 3, to: 6, text: "cat" });
    expect(header).toMatchObject({ from: 1, to: 4 });
  });

  it("takes a document as well as an editor, and an editor of a story", () => {
    const document = documentOf([p("a cat")], { stories: STORIES });
    expect(findAll(document, "cat").length).toBe(3);
    const editor = createEditor({ document });
    expect(findAll(editor.story("h1") as Editor, "cat").length).toBe(3);
  });

  it("runs across runs, marks and what draws nothing", () => {
    const editor = open([
      p(
        t("ca", "bold"),
        atom("bookmarkStart", { id: 1, name: "b" }),
        t("t", "italic"),
        atom("bookmarkEnd", { id: 1 }),
        atom("commentStart", { id: 1 }),
        "fish",
        atom("commentEnd", { id: 1 }),
      ),
    ]);
    expect(texts(editor, "catfish")).toEqual(["catfish"]);
  });

  it("stops at a note reference and a picture's like", () => {
    const editor = open([p("ab", atom("noteReference", { story: "footnote:1" }), "cd")], {
      stories: STORIES,
    });
    expect(texts(editor, "abcd")).toEqual([]);
    expect(texts(editor, "ab")).toEqual(["ab"]);
  });

  it("reads a tab and a line break as characters", () => {
    const editor = open([p("a", atom("tab"), "b", atom("hardBreak"), "c")]);
    expect(texts(editor, "a\tb\nc")).toEqual(["a\tb\nc"]);
  });

  it("does not look in a paragraph break", () => {
    expect(texts(open([p("ab"), p("cd")]), "bc")).toEqual([]);
  });

  it("skips hidden field codes, finds them while codes show, and then not results", () => {
    const editor = open([p("x", ...field(" QUOTE ", "abc"), "y")]);
    expect(texts(editor, "QUOTE")).toEqual([]);
    expect(texts(editor, "abc")).toEqual(["abc"]);
    expect(texts(editor, "xabcy")).toEqual(["xabcy"]);
    editor.run(toggleFieldCodes);
    expect(texts(editor, "QUOTE")).toEqual(["QUOTE"]);
    expect(texts(editor, "abc")).toEqual([]);
  });

  it("skips a code with a field nested in it", () => {
    const nested = [
      atom("fieldStart"),
      atom("fieldCode", { text: " IF " }),
      ...field(" MERGEFIELD x ", "inner"),
      atom("fieldSeparator"),
      t("outer"),
      atom("fieldEnd"),
    ];
    const editor = open([p(...nested)]);
    expect(texts(editor, "inner")).toEqual([]);
    expect(texts(editor, "outer")).toEqual(["outer"]);
  });

  it("does not take a story's page number for its text", () => {
    const stories = { h1: { kind: "header", content: docOf(p(...field(" PAGE ", "7"))) } } as const;
    expect(findAll(open([p("7")], { stories }), "7").map((m) => m.story)).toEqual([null]);
  });

  it("follows the review view for tracked deletions", () => {
    const editor = open([p("one two three")], {}, true);
    editor.select(5, 8);
    editor.commands.deleteSelection();
    expect(texts(editor, "two")).toEqual(["two"]);
    editor.run(setReviewView("final"));
    expect(texts(editor, "two")).toEqual([]);
    expect(texts(editor, "one  three")).toEqual(["one  three"]);
    editor.run(setReviewView("simple"));
    expect(texts(editor, "two")).toEqual([]);
  });

  it("does not find a control's placeholder", () => {
    const controls: Record<string, ControlJSON> = {
      c: { kind: "text", placeholder: { showing: true, text: "Type here" } },
      d: { kind: "text" },
    };
    const editor = open([p(...control("c", "Type here"), " ", ...control("d", "Type there"))], {
      controls,
    });
    expect(texts(editor, "Type")).toEqual(["Type"]);
    expect(findAll(editor, "Type")[0]?.from).toBeGreaterThan(10);
  });
});

describe("replace", () => {
  it("takes the first character's formatting and leaves what draws nothing", () => {
    const editor = open([
      p(
        "xx",
        t("He", "bold"),
        atom("bookmarkStart", { id: 1, name: "b" }),
        t("llo", "italic"),
        atom("bookmarkEnd", { id: 1 }),
        "yy",
      ),
    ]);
    expect(replaceAll(editor, "Hello", "Bye").replaced).toBe(1);
    expect(paragraphs(editor)).toEqual(["xxByeyy"]);
    const json = JSON.stringify(editor.state.doc.toJSON());
    expect(json).toContain('"text":"Bye","marks":[{"type":"bold"');
    expect(json).toContain("bookmarkStart");
    expect(json).toContain("bookmarkEnd");
  });

  it("follows the capitals of what it replaces unless the case must match", () => {
    const make = () => open([p("hello Hello HELLO hEllo")]);
    const editor = make();
    replaceAll(editor, "hello", "new world");
    expect(paragraphs(editor)).toEqual(["new world New world NEW WORLD new world"]);
    const exact = make();
    replaceAll(exact, "hello", "world", { matchCase: true });
    expect(paragraphs(exact)).toEqual(["world Hello HELLO hEllo"]);
  });

  it("makes tabs and line breaks, and drops what a file cannot hold", () => {
    const editor = open([p("c")]);
    replaceAll(editor, "c", "x\ty\nz\u0001");
    const types = editor.state.doc.firstChild?.content.toJSON()?.map((n: NodeJSON) => n.type);
    expect(types).toEqual(["text", "tab", "text", "hardBreak", "text"]);
    expect(editor.state.doc.textContent).toBe("xyz");
  });

  it("is one undo step over every story, and undoing gives everything back", () => {
    const editor = open([p("a cat, a cat")], { stories: STORIES });
    const before = JSON.stringify(editor.getDocument());
    const depth = undoDepth(editor.state);
    const report = replaceAll(editor, "cat", "dog");
    expect(report).toEqual({ replaced: 4, refused: [] });
    expect(paragraphs(editor)).toEqual(["a dog, a dog"]);
    expect(storyText(editor, "h1")).toBe("dog in the header");
    expect(storyText(editor, "footnote:1")).toContain("a dog in a note");
    expect(storyText(editor, "footnote:-1")).toBe("cat");
    expect(undoDepth(editor.state)).toBe(depth + 1);
    editor.commands.undo();
    expect(JSON.stringify(editor.getDocument())).toBe(before);
    editor.commands.redo();
    expect(storyText(editor, "h1")).toBe("dog in the header");
  });

  it("is one step when only stories change, apart from the edit before it", () => {
    const editor = open([p("nothing")], { stories: STORIES });
    editor.select(1);
    editor.commands.insertText("z");
    const depth = undoDepth(editor.state);
    replaceAll(editor, "cat", "dog");
    expect(undoDepth(editor.state)).toBe(depth + 1);
    editor.commands.undo();
    expect(storyText(editor, "h1")).toBe("cat in the header");
    expect(paragraphs(editor)).toEqual(["znothing"]);
  });

  it("is tracked while tracking, in every story, ids apart, and rejected back", () => {
    const editor = open([p("a cat")], { stories: STORIES }, true);
    expect(replaceAll(editor, "cat", "dog").replaced).toBe(3);
    expect(paragraphs(editor)).toEqual(["a catdog"]);
    expect(storyText(editor, "h1")).toBe("catdog in the header");
    const ids: number[] = [];
    const walk = (node: NodeJSON) => {
      for (const mark of node.marks ?? [])
        if (mark.type === "insertion" || mark.type === "deletion")
          ids.push(mark.attrs?.id as number);
      node.content?.forEach(walk);
    };
    const document = editor.getDocument();
    walk(document.content);
    for (const story of Object.values(document.stories ?? {})) walk(story.content);
    expect(new Set(ids).size).toBe(6);
    editor.run(rejectAllChanges());
    expect(paragraphs(editor)).toEqual(["a cat"]);
    expect(storyText(editor, "h1")).toBe("cat in the header");
  });

  it("reports what is locked, and replaces the rest", () => {
    const controls: Record<string, ControlJSON> = {
      l: { kind: "richText", lock: "contentLocked" },
      s: { kind: "richText", lock: "sdtContentLocked" },
      b: { kind: "richText", binding: { xpath: "/a" } } as ControlJSON,
      o: { kind: "richText", lock: "sdtLocked" },
      d: { kind: "dropDown" },
    };
    const editor = open(
      [
        p(
          "cat ",
          ...control("l", "cat"),
          ...control("s", "cat"),
          ...control("b", "cat"),
          ...control("o", "cat"),
          ...control("d", "cat"),
        ),
      ],
      { controls },
    );
    const { replaced, refused } = replaceAll(editor, "cat", "dog");
    expect(replaced).toBe(2);
    expect(refused.map((r) => r.reason)).toEqual(["locked", "locked", "locked", "control"]);
    expect(paragraphs(editor)).toEqual(["dog catcatcatdogcat"]);
  });

  it("refuses a match over a control's edge", () => {
    const controls: Record<string, ControlJSON> = { c: { kind: "richText" } };
    const editor = open([p("x", ...control("c", "aa"), "y")], { controls });
    expect(replaceAll(editor, "xaa", "Q").refused[0]?.reason).toBe("control");
    expect(paragraphs(editor)).toEqual(["xaay"]);
  });

  it("refuses a match over a field's edge and replaces inside its result", () => {
    const editor = open([p("x", ...field(" QUOTE ", "abc"), "y")]);
    expect(replaceAll(editor, "xab", "Z").refused[0]?.reason).toBe("field");
    expect(replaceAll(editor, "xabcy", "Z").refused[0]?.reason).toBe("field");
    expect(replaceAll(editor, "abc", "Q").replaced).toBe(1);
    expect(paragraphs(editor)).toEqual(["xQy"]);
    expect(JSON.stringify(editor.state.doc.toJSON())).toContain("QUOTE");
  });

  it("refuses a code while codes show", () => {
    const editor = open([p(...field(" QUOTE ", "abc"))]);
    editor.run(toggleFieldCodes);
    expect(replaceAll(editor, "QUOTE", "Z").refused[0]?.reason).toBe("field-code");
  });

  it("refuses text already deleted", () => {
    const editor = open([p("one two")], {}, true);
    editor.select(5, 8);
    editor.commands.deleteSelection();
    expect(replaceAll(editor, "two", "x").refused[0]?.reason).toBe("deleted");
  });

  it("leaves deleted text between the pieces of a match the view hides it from", () => {
    const editor = open([p("abXcd")], {}, true);
    editor.select(3, 4);
    editor.commands.deleteSelection();
    editor.run(setReviewView("final"));
    expect(replaceAll(editor, "abcd", "Z").replaced).toBe(1);
    editor.run(rejectAllChanges());
    expect(paragraphs(editor)).toEqual(["abXcd"]);
  });

  it("replaces one match, the caret after it, in a story too", () => {
    const editor = open([p("cat cat")], { stories: STORIES });
    const [first, second] = findAll(editor, "cat");
    expect(replace(editor, second as never, "horse").replaced).toBe(1);
    expect(paragraphs(editor)).toEqual(["cat horse"]);
    expect(editor.state.selection.head).toBe(10);
    // Still good: nothing before it changed.
    expect(replace(editor, first as never, "ox").replaced).toBe(1);
    const inHeader = findAll(editor, "cat").find((m) => m.story === "h1");
    expect(replace(editor, inHeader as never, "dog").replaced).toBe(1);
    expect(storyText(editor, "h1")).toBe("dog in the header");
    expect(editor.story("h1")?.state.selection.head).toBe(4);
  });

  it("does not replace a match that is out of date", () => {
    const editor = open([p("cat")]);
    const [match] = findAll(editor, "cat");
    editor.select(1, 4);
    editor.commands.insertText("dog");
    expect(replace(editor, match as never, "x")).toMatchObject({
      replaced: 0,
      refused: [{ reason: "stale" }],
    });
  });

  it("empties with an empty replacement", () => {
    const editor = open([p("a cat b")]);
    replaceAll(editor, "cat ", "");
    expect(paragraphs(editor)).toEqual(["a b"]);
  });

  it("does nothing, in no undo step, when nothing is found", () => {
    const editor = open([p("a")]);
    expect(replaceAll(editor, "zzz", "y")).toEqual({ replaced: 0, refused: [] });
    expect(undoDepth(editor.state)).toBe(0);
  });
});

describe("nextMatch", () => {
  it("goes on from the selection, around the end, backward too", () => {
    const editor = open([p("cat cat")], { stories: STORIES });
    const matches = findAll(editor, "cat");
    editor.select(1);
    expect(nextMatch(editor, matches)).toBe(matches[0]);
    editor.select(1, 4);
    expect(nextMatch(editor, matches)).toBe(matches[1]);
    expect(nextMatch(editor, matches, true)).toBe(matches[matches.length - 1]);
    editor.select(8);
    expect(nextMatch(editor, matches)).toBe(matches[2]);
    expect(nextMatch(editor, matches, true)).toBe(matches[1]);
    expect(nextMatch(editor, [])).toBeNull();
  });
});

describe("properties", () => {
  const word = fc.constantFrom("cat", "Cat", "dog", "a", "catcat", " ", "x y");
  const line = fc.array(word, { minLength: 1, maxLength: 6 }).map((w) => w.join(""));
  const lines = fc.array(line, { minLength: 1, maxLength: 4 });
  const replacement = fc.constantFrom("", "z", "cat", "longer text", "Cat");

  it("replace all then undo gives the original, across stories, tracked or not", () => {
    fc.assert(
      fc.property(lines, line, replacement, fc.boolean(), (body, head, text, track) => {
        const editor = open(
          body.map((l) => p(l)),
          { stories: { h1: { kind: "header", content: docOf(p(head)) } } },
          track,
        );
        const before = JSON.stringify(editor.getDocument());
        const { replaced } = replaceAll(editor, "cat", text, { matchCase: true });
        if (replaced) editor.commands.undo();
        expect(JSON.stringify(editor.getDocument())).toBe(before);
      }),
    );
  });

  it("leaves no match and the text around them as it was", () => {
    fc.assert(
      fc.property(lines, (body) => {
        const editor = open(body.map((l) => p(l)));
        replaceAll(editor, "cat", "#", { matchCase: true });
        expect(findAll(editor, "cat", { matchCase: true })).toEqual([]);
        expect(paragraphs(editor)).toEqual(body.map((l) => l.replaceAll("cat", "#")));
      }),
    );
  });

  it("gives positions holding what was found", () => {
    fc.assert(
      fc.property(lines, (body) => {
        const editor = open(body.map((l) => p(l)));
        for (const match of findAll(editor, "cat"))
          expect(editor.state.doc.textBetween(match.from, match.to).toLowerCase()).toBe("cat");
      }),
    );
  });
});
