// Regressions: fields, notes, content controls, accepting changes and bookmarks.
import { describe, expect, it } from "vitest";
import type { NodeJSON } from "./model/index.js";
import { insertText } from "./state/commands.js";
import { resolveComment } from "./state/comments.js";
import { controlProperties, controlValues, setControlValue } from "./state/controls.js";
import { createEditor, type Editor } from "./state/editor.js";
import { formatDatePicture, updateFields } from "./state/fieldupdate.js";
import { renameBookmark } from "./state/navigation.js";
import { noteNumbers } from "./state/notes.js";
import { acceptAllChanges } from "./state/review.js";
import type { FoliDocument } from "./v3/document.js";
import { createDocument, parseDocument, SCHEMA_VERSION } from "./v3/document.js";
import { formatNumber } from "./v3/resolve.js";

type Inline = NodeJSON | string;
const t = (text: string, marks?: NodeJSON["marks"]): NodeJSON => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const p = (...content: Inline[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content: content.map((c) => (typeof c === "string" ? t(c) : c)) } : {}),
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
const bm = (id: number, name: string, ...inner: Inline[]): NodeJSON[] => [
  atom("bookmarkStart", { id, name }),
  ...inner.map((c) => (typeof c === "string" ? t(c) : c)),
  atom("bookmarkEnd", { id }),
];
function documentOf(content: NodeJSON[], more: Partial<FoliDocument> = {}): FoliDocument {
  return {
    ...createDocument(),
    schemaVersion: SCHEMA_VERSION,
    content: docOf(...content),
    ...more,
  };
}
const open = (content: NodeJSON[], more: Partial<FoliDocument> = {}) =>
  createEditor({ document: documentOf(content, more), author: "Me" });
const paragraphs = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((node) => {
    out.push(node.textContent);
  });
  return out;
};

describe("regressions: fields", () => {
  it("a SEQ naming a bookmark shows the number at the bookmark, also when it comes later", () => {
    // Word: `{ SEQ figure bookmark }` cross-references the figure the bookmark marks.
    const editor = open([
      p("See figure ", ...field("SEQ f bk", "9")),
      p(...field("SEQ f", "9")),
      p(...bm(3, "bk", ...field("SEQ f", "9"))),
    ]);
    updateFields(editor);
    expect(paragraphs(editor)).toEqual(["See figure 2", "1", "2"]);
  });

  it("a SEQ naming a bookmark around a SEQ field shows that field's number", () => {
    const editor = open([
      p(...field("SEQ f", "9")),
      p(...bm(3, "bk", ...field("SEQ f", "9"))),
      p(...field("SEQ f", "9")),
      p("See figure ", ...field("SEQ f bk", "9")),
    ]);
    updateFields(editor);
    expect(paragraphs(editor)).toEqual(["1", "2", "3", "See figure 2"]);
  });

  it("a date picture takes d and y in either case, as Word does", () => {
    const date = new Date(2024, 0, 5);
    expect(formatDatePicture(date, "DD/MM/YYYY")).toBe("05/01/2024");
  });

  it("a MERGEFIELD date given as yyyy-mm-dd shows that day in any time zone", () => {
    // Core has no Node types: the test runner's `process`, typed here.
    const { process } = globalThis as unknown as {
      process: { env: Record<string, string | undefined> };
    };
    const zone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const editor = open([p(...field('MERGEFIELD d \\@ "d MMMM yyyy"', "old"))]);
      updateFields(editor, { data: { d: "2024-03-05" } });
      expect(paragraphs(editor)).toEqual(["5 March 2024"]);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

describe("regressions: notes", () => {
  it("numbers a chicago footnote from a large start without throwing", () => {
    const editor = open([p("a", atom("noteReference", { story: "footnote:1" }))], {
      stories: { "footnote:1": { kind: "footnote", content: docOf(p(atom("noteMark"), " n")) } },
      // The largest start `parseDocument` takes.
      settings: { footnotes: { format: "chicago", start: 2147483647 } },
    });
    const texts = () => noteNumbers(editor.state.doc, editor.getDocument()).map((n) => n.text);
    expect(texts).not.toThrow();
    // Bounded, as `letters` is (resolve.ts): no string of half a billion marks.
    expect((texts()[0] as string).length).toBeLessThan(1000);
  });
});

describe("regressions: content controls", () => {
  it("a multi-line text control takes CRLF and CR as line breaks, leaving no CR in its text", () => {
    const editor = open([p("a", ...control("m", "old"), "b")], {
      controls: { m: { kind: "text", multiLine: true } },
    });
    expect(editor.run(setControlValue("m", "l1\r\nl2\rl3"))).toBe(true);
    expect(controlValues(editor.state)[0]?.text).toBe("l1\nl2\nl3");
  });

  it("reads a date typed in a format that has am/pm", () => {
    const editor = open([p("a", ...control("d", "x"), "b")], {
      controls: { d: { kind: "date", dateFormat: "M/d/yyyy h:mm am/pm" } },
    });
    editor.select(3, 4);
    expect(editor.run(insertText("3/5/2024 3:04 pm"))).toBe(true);
    expect(controlProperties(editor.state, "d")?.date).toBe("2024-03-05T00:00:00Z");
  });

  it("a date control's hostile format reads typing at once (21.2)", () => {
    const editor = open([p("a", ...control("d", "x"), "b")], {
      controls: { d: { kind: "date", dateFormat: "hdhdhdhdhdhd" } },
    });
    editor.select(3, 4);
    const started = performance.now();
    expect(editor.run(insertText(`${"1".repeat(32)}!`))).toBe(true);
    expect(performance.now() - started).toBeLessThan(500);
    // A long format of numbers side by side reads the text once, not once a number.
    const long = open([p("a", ...control("d", "x"), "b")], {
      controls: { d: { kind: "date", dateFormat: "dh".repeat(127) } },
    });
    long.select(3, 4);
    const again = performance.now();
    expect(long.run(insertText("1".repeat(200000)))).toBe(true);
    expect(performance.now() - again).toBeLessThan(1000);
  });

  it.each([
    ["ddMMyyyy", "05032024", "2024-03-05T00:00:00Z"],
    ["d. MMM. yyyy", "5. Mar. 2024", "2024-03-05T00:00:00Z"],
    ["MMM d, yyyy", "mar. 5, 2024", "2024-03-05T00:00:00Z"],
    ["dddd, MMMM d, yyyy", "Tuesday, March 5, 2024", "2024-03-05T00:00:00Z"],
    ["'on' d/M/yy", "on 5/3/24", "2024-03-05T00:00:00Z"],
    ["M/d/yyyy h:mm am/pm", "3/5/2024 3:05 p.m.", "2024-03-05T00:00:00Z"],
    ["d/M/yyyy", "5/3/2024x", undefined],
  ])("reads a date typed in the format %s", (dateFormat, typed, date) => {
    const editor = open([p("a", ...control("d", "x"), "b")], {
      controls: { d: { kind: "date", dateFormat } },
    });
    editor.select(3, 4);
    expect(editor.run(insertText(typed))).toBe(true);
    expect(controlProperties(editor.state, "d")?.date).toBe(date);
  });

  it("a drop-down given an item's value takes that item, not another shown as that text", () => {
    const editor = open([p("a", ...control("dd", "x"), "b")], {
      controls: {
        dd: {
          kind: "dropDown",
          items: [
            { value: "1", display: "2" },
            { value: "2", display: "1" },
          ],
        },
      },
    });
    expect(editor.run(setControlValue("dd", "2"))).toBe(true);
    // `controlValues` gives "2" for the second item: setting it back must pick the same one.
    expect(controlValues(editor.state)[0]?.value).toBe("2");
  });
});

describe("regressions: accepting changes", () => {
  it("accepting a paragraph deleted whole before a table removes it", () => {
    const by = { id: 1, author: "X", date: "2024-01-01T00:00:00Z" };
    const cell = { type: "tableCell", content: [p("x")] };
    const table = {
      type: "table",
      attrs: { grid: [2000] },
      content: [{ type: "tableRow", content: [cell] }],
    } as unknown as NodeJSON;
    const editor = open([
      p("keep"),
      {
        ...p(t("gone", [{ type: "deletion", attrs: by }])),
        attrs: { revision: { deletion: by } },
      },
      table,
      p("end"),
    ]);
    expect(editor.run(acceptAllChanges())).toBe(true);
    // As the same deletion untracked leaves it, and as Word does: no empty paragraph stays.
    expect(editor.getDocument().content.content?.map((n) => n.type)).toEqual([
      "paragraph",
      "table",
      "paragraph",
    ]);
  });
});

describe("regressions: bookmarks", () => {
  it("renaming a bookmark follows a link to it written in another case", () => {
    // Bookmark names do not differ by case alone (`bookmarksIn`): "intro" links to "Intro".
    const editor = open([
      p(...bm(0, "Intro", "target")),
      p(t("go", [{ type: "link", attrs: { anchor: "intro" } }])),
    ]);
    expect(renameBookmark(editor, "Intro", "Start").ok).toBe(true);
    const link = editor.getDocument().content.content?.[1]?.content?.[0]?.marks?.[0];
    expect(link?.attrs?.anchor).toBe("Start");
  });
});

describe("updateFields' maxWritten (a review of code mode, #175)", () => {
  // What a document from someone else can make its fields write: far more than it holds.
  const picture = `"${"dddd ".repeat(2000)}"`;
  const many = (n: number, code: string) =>
    Array.from({ length: n }, () => p(...field(code, "old")));
  const now = new Date(Date.UTC(2026, 10, 18));

  it("past it, nothing is changed and it throws", () => {
    for (const [name, content] of [
      ["date pictures", many(50, `DATE \\@ ${picture}`)],
      ["a merge value", many(50, "MERGEFIELD Name")],
      [
        "references to a bookmark",
        [p(...bm(1, "Big", "x".repeat(20_000))), ...many(50, "REF Big")],
      ],
      [
        // Short text, heavy formatting: what a position count did not see.
        "references to formatting",
        [
          p(
            ...bm(
              1,
              "Heavy",
              ...Array.from({ length: 20 }, (_, i) =>
                t(String(i % 10), [
                  {
                    type: "runExt",
                    attrs: { xml: `<w:rPr><w:lang w:val="${"x".repeat(20_000)}"/></w:rPr>` },
                  },
                ]),
              ),
            ),
          ),
          ...many(50, "REF Heavy"),
        ],
      ],
    ] as const) {
      const editor = open([...content]);
      const before = editor.getDocument();
      expect(
        () =>
          updateFields(editor, { now, data: { Name: "v".repeat(20_000) }, maxWritten: 300_000 }),
        name,
      ).toThrow(RangeError);
      expect(editor.getDocument(), name).toEqual(before);
    }
  });

  it("under it, or without it, the update is as it was", () => {
    const editor = open(many(3, "MERGEFIELD Name"));
    expect(updateFields(editor, { data: { Name: "Ada" }, maxWritten: 300_000 }).updated).toBe(3);
    expect(paragraphs(editor)).toEqual(["Ada", "Ada", "Ada"]);
    const unlimited = open(many(50, "MERGEFIELD Name"));
    expect(updateFields(unlimited, { data: { Name: "v".repeat(20_000) } }).updated).toBe(50);
  });
});

describe("hint (18.2)", () => {
  it("goes to the view, a bookmark by name with any capitals; false without a view or a bookmark", async () => {
    const { hint } = await import("./state/navigation.js");
    const editor = open([p("Before "), p(...bm(1, "Intro", "the start"))]);
    expect(hint(editor, { story: null, from: 1, to: 3 })).toBe(false);
    const seen: unknown[] = [];
    editor.storyView = {
      hint: (target: unknown, options: unknown) => {
        seen.push([target, options]);
        return true;
      },
    } as never;
    expect(hint(editor, { bookmark: "intro" }, { ms: 500 })).toBe(true);
    const [[target, options]] = seen as [[{ story: null; from: number; to: number }, unknown]];
    expect(options).toEqual({ ms: 500 });
    expect(editor.state.doc.textBetween(target.from, target.to)).toBe("the start");
    expect(hint(editor, { bookmark: "Nope" })).toBe(false);
    expect(hint(editor, "Intro" as never)).toBe(false);
    expect(hint(editor, { bookmark: null } as never)).toBe(false);
    // A view of another make, without hint: false.
    editor.storyView = {} as never;
    expect(hint(editor, { bookmark: "Intro" })).toBe(false);
  });
});

describe("one's own inserted paragraph, deleted whole while tracking", () => {
  it("goes without a trace: the paragraph after it keeps its own mark", async () => {
    const { rejectAllChanges, trackedChanges } = await import("./state/index.js");
    const editor = createEditor({
      document: documentOf([p("One"), p("Two"), p("Three")]),
      author: "Me",
      trackChanges: true,
    });
    const original = JSON.stringify(editor.getDocument().content);
    const { schema } = editor.state;
    // A paragraph inserted after "One", as a node, the way an agent inserts it.
    editor.dispatch(
      editor.state.tr.insert(
        5,
        (schema.nodes.paragraph as never as { create: (a: null, c: unknown) => never }).create(
          null,
          schema.text("New"),
        ),
      ),
    );
    expect(paragraphs(editor)).toEqual(["One", "New", "Two", "Three"]);
    const node = editor.state.doc.nodeAt(5);
    editor.dispatch(editor.state.tr.delete(5, 5 + (node?.nodeSize ?? 0)));
    expect(paragraphs(editor)).toEqual(["One", "Two", "Three"]);
    expect(trackedChanges(editor.state.doc)).toEqual([]);
    expect(JSON.stringify(editor.getDocument().content)).toBe(original);
    // Rejecting what is left joins nothing.
    editor.run(rejectAllChanges());
    expect(paragraphs(editor)).toEqual(["One", "Two", "Three"]);
  });
});

describe("one's own inserted paragraph, deleted whole, at the end of the document or of a cell", () => {
  it.each(["the document", "a cell"])("goes with nothing left, at the end of %s", async (where) => {
    const { acceptAllChanges, rejectAllChanges, trackedChanges } = await import("./state/index.js");
    const content =
      where === "a cell"
        ? [
            p("Before"),
            {
              type: "table",
              content: [
                { type: "tableRow", content: [{ type: "tableCell", content: [p("Cell")] }] },
              ],
            },
            p("After"),
          ]
        : [p("One"), p("Two")];
    const editor = createEditor({
      document: documentOf(content as never),
      author: "Me",
      trackChanges: true,
    });
    const original = JSON.stringify(editor.getDocument().content);
    // Where the last paragraph of the document, or of the cell, ends.
    let end = editor.state.doc.content.size;
    if (where === "a cell")
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === "Cell") end = pos + node.nodeSize;
        return true;
      });
    const { schema } = editor.state;
    const made = (
      schema.nodes.paragraph as never as { create: (a: null, c: unknown) => never }
    ).create(null, schema.text("New"));
    editor.dispatch(editor.state.tr.insert(end, made));
    const node = editor.state.doc.nodeAt(end);
    expect(node?.textContent).toBe("New");
    editor.dispatch(editor.state.tr.delete(end, end + (node?.nodeSize ?? 0)));
    expect(trackedChanges(editor.state.doc)).toEqual([]);
    expect(JSON.stringify(editor.getDocument().content)).toBe(original);
    editor.run(acceptAllChanges());
    editor.run(rejectAllChanges());
    expect(JSON.stringify(editor.getDocument().content)).toBe(original);
  });

  it("still keeps a paragraph that holds another author's text, as a deletion", async () => {
    const { trackedChanges } = await import("./state/index.js");
    const editor = createEditor({
      document: documentOf([p("One"), p("Two")]),
      author: "Me",
      trackChanges: true,
    });
    const node = editor.state.doc.lastChild;
    const at = editor.state.doc.content.size - (node?.nodeSize ?? 0);
    editor.dispatch(editor.state.tr.delete(at, at + (node?.nodeSize ?? 0)));
    expect(paragraphs(editor)).toEqual(["One", "Two"]);
    expect(trackedChanges(editor.state.doc).length).toBeGreaterThan(0);
  });
});

describe("several of one's own paragraphs, deleted together at the document's end", () => {
  it("go with nothing left", async () => {
    const { acceptAllChanges, rejectAllChanges, trackedChanges } = await import("./state/index.js");
    const editor = createEditor({
      document: documentOf([p("One"), p("Two")]),
      author: "Me",
      trackChanges: true,
    });
    const original = JSON.stringify(editor.getDocument().content);
    const { schema } = editor.state;
    const make = (t: string) =>
      (schema.nodes.paragraph as never as { create: (a: null, c: unknown) => never }).create(
        null,
        schema.text(t),
      );
    const start = editor.state.doc.content.size;
    editor.dispatch(editor.state.tr.insert(start, [make("New1"), make("New2")] as never));
    expect(paragraphs(editor)).toEqual(["One", "Two", "New1", "New2"]);
    editor.dispatch(editor.state.tr.delete(start, editor.state.doc.content.size));
    expect(trackedChanges(editor.state.doc)).toEqual([]);
    expect(JSON.stringify(editor.getDocument().content)).toBe(original);
    editor.run(acceptAllChanges());
    editor.run(rejectAllChanges());
    expect(JSON.stringify(editor.getDocument().content)).toBe(original);
  });
});

describe("duplicate comment ids (21.3)", () => {
  it("are given anew, anchors with them, so a command by id acts on one comment", () => {
    const comment = (id: number, author: string) => ({
      id,
      author,
      content: [{ type: "paragraph" }],
    });
    const anchored = (id: number, text: string): NodeJSON => ({
      type: "paragraph",
      content: [
        { type: "commentStart", attrs: { id } },
        { type: "text", text },
        { type: "commentEnd", attrs: { id } },
        { type: "commentReference", attrs: { id } },
      ],
    });
    // Nested ranges of one id: each end closes the start opened last.
    const nested: NodeJSON = {
      type: "paragraph",
      content: [
        { type: "commentStart", attrs: { id: 5 } },
        { type: "commentStart", attrs: { id: 5 } },
        { type: "text", text: "x" },
        { type: "commentEnd", attrs: { id: 5 } },
        { type: "commentEnd", attrs: { id: 5 } },
      ],
    };
    const input = {
      ...createDocument(docOf(anchored(1, "a"), anchored(1, "b"), anchored(2, "c"), nested)),
      comments: [
        comment(1, "A"),
        comment(1, "B"),
        comment(2, "C"),
        comment(5, "D"),
        comment(5, "E"),
      ],
    };
    const before = JSON.stringify(input);
    const doc = parseDocument(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(doc.comments.map((c) => [c.id, c.author])).toEqual([
      [1, "A"],
      [6, "B"],
      [2, "C"],
      [5, "D"],
      [7, "E"],
    ]);
    const ids = doc.content.content?.map((b) =>
      (b.content ?? []).filter((n) => n.type !== "text").map((n) => n.attrs?.id),
    );
    expect(ids).toEqual([
      [1, 1, 1],
      [6, 6, 6],
      [2, 2, 2],
      [5, 7, 7, 5],
    ]);
    const editor = createEditor({ document: input });
    expect(editor.commands.resolveComment(6)).toBe(true);
    const by = (id: number) => editor.getDocument().comments.find((c) => c.id === id);
    expect([by(1)?.done, by(6)?.done]).toEqual([undefined, true]);
  });
});

describe("smaller bugs of the audit (21.7)", () => {
  it("a new tracked change takes an id above a table row's revision", () => {
    const row = (id: number): NodeJSON => ({
      type: "tableRow",
      attrs: { revision: { insertion: { id, author: "Other" } } },
      content: [{ type: "tableCell", content: [p("cell")] }],
    });
    const editor = createEditor({
      document: documentOf([p("text"), { type: "table", content: [row(40)] }, p("end")]),
      author: "Me",
      trackChanges: true,
    });
    editor.select(2);
    editor.run(insertText("x"));
    const ids: number[] = [];
    editor.state.doc.descendants((node) => {
      for (const mark of node.marks)
        if (mark.type.name === "insertion") ids.push(mark.attrs.id as number);
      return true;
    });
    expect(ids).toEqual([41]);
  });

  it("a MERGEFIELD date picture reads ISO dates only, not what Date.parse guesses", () => {
    const merged = (value: string) => {
      const editor = open([p(...field('MERGEFIELD d \\@ "yyyy-MM-dd"', "old"))]);
      updateFields(editor, { data: { d: value } });
      return paragraphs(editor)[0];
    };
    expect(merged("12")).toBe("12");
    expect(merged("March 5")).toBe("March 5");
    expect(merged("2024-03-05")).toBe("2024-03-05");
    expect(merged("2024-03-05T10:00:00Z")).toMatch(/^2024-03-0[45]$/);
  });

  it("a SEQ \\r with no number counts on", () => {
    const editor = open([
      p(...field("SEQ f", "9")),
      p(...field("SEQ f \\r", "9")),
      p(...field("SEQ f \\r 5", "9")),
    ]);
    updateFields(editor);
    expect(paragraphs(editor)).toEqual(["1", "2", "5"]);
  });

  it("roman, letter and ordinal numbers of fractions and negatives", () => {
    expect(formatNumber(1.5, "upperRoman")).toBe("1.5");
    expect(formatNumber(2.5, "lowerLetter")).toBe("2.5");
    expect(formatNumber(1.5, "ordinal")).toBe("1.5");
    expect(formatNumber(-1, "ordinal")).toBe("-1st");
    expect(formatNumber(-12, "ordinal")).toBe("-12th");
    expect(formatNumber(-3, "upperRoman")).toBe("-3");
    expect(formatNumber(1.5, "none")).toBe("");
  });

  it("a reply whose parent is missing is resolved as a thread of its own", () => {
    const comment = { author: "A", content: [{ type: "paragraph" }] };
    const editor = open([p("text")], { comments: [{ ...comment, id: 2, parent: 9 }] });
    expect(editor.run(resolveComment(2))).toBe(true);
    expect(editor.getDocument().comments[0]?.done).toBe(true);
  });

  it("a string schemaVersion is told to be a number", () => {
    expect(() => parseDocument({ ...createDocument(), schemaVersion: "6" })).toThrow(
      'schemaVersion must be a number, not the string "6"',
    );
  });
});
