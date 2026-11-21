// Regressions: fields, notes, content controls, accepting changes and bookmarks.
import { describe, expect, it } from "vitest";
import type { NodeJSON } from "./model/index.js";
import { insertText } from "./state/commands.js";
import { controlProperties, controlValues, setControlValue } from "./state/controls.js";
import { createEditor, type Editor } from "./state/editor.js";
import { formatDatePicture, updateFields } from "./state/fieldupdate.js";
import { renameBookmark } from "./state/navigation.js";
import { noteNumbers } from "./state/notes.js";
import { acceptAllChanges } from "./state/review.js";
import type { FoliDocument } from "./v3/document.js";
import { createDocument, SCHEMA_VERSION } from "./v3/document.js";

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
