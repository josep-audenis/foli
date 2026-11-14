import { describe, expect, it } from "vitest";
import { parseContent } from "../document.js";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import type {
  AbstractNumberingJSON,
  CommentJSON,
  FoliDocumentV3,
  StyleJSON,
} from "../v3/document.js";
import { createEditor } from "./editor.js";
import { wordContext } from "./word.js";
import { copiedDefinitions, fitPaste, fitPastedV2, type WordDefinitions } from "./wordclip.js";
import { levels } from "./wordformat.js";

const STYLES: StyleJSON[] = [
  { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
  { id: "Title", type: "paragraph", name: "Title", basedOn: "Normal" },
  {
    id: "Heading1",
    type: "paragraph",
    name: "heading 1",
    basedOn: "Normal",
    link: "Heading1Char",
    run: [{ type: "bold" }],
  },
  { id: "Heading1Char", type: "character", name: "Heading 1 Char", link: "Heading1" },
  { id: "CommentText", type: "paragraph", name: "annotation text", basedOn: "Normal" },
  {
    id: "DefaultParagraphFont",
    type: "character",
    name: "Default Paragraph Font",
    isDefault: true,
  },
  { id: "Hyperlink", type: "character", name: "Hyperlink", basedOn: "DefaultParagraphFont" },
];
const BULLETS: AbstractNumberingJSON = {
  id: 0,
  multiLevelType: "hybridMultilevel",
  levels: levels("bulletList"),
};

const text = (value: string, marks?: MarkJSON[]): NodeJSON =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const p = (attrs: Record<string, unknown>, ...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
const docOf = (...blocks: NodeJSON[]): NodeJSON => ({ type: "doc", content: blocks });
const comment = (id: number, extra: Partial<CommentJSON> = {}): CommentJSON => ({
  id,
  author: "A",
  content: [p({ style: "CommentText", attributes: { "w14:paraId": "0000000A" } }, text("note"))],
  ...extra,
});

function editorOf(blocks: NodeJSON[], over: Partial<FoliDocumentV3> = {}) {
  return createEditor({
    document: {
      schemaVersion: 3,
      section: {},
      defaults: {},
      styles: STYLES,
      numbering: { abstracts: [BULLETS], instances: [{ id: 1, abstract: 0 }] },
      comments: [],
      content: docOf(...blocks),
      ...over,
    },
  });
}
const envelopeOf = (editor: ReturnType<typeof editorOf>) =>
  wordContext(editor.state)?.envelope as NonNullable<ReturnType<typeof wordContext>>["envelope"];

describe("copiedDefinitions", () => {
  it("takes the styles, numbering and comments the content references, and what they name", () => {
    const numberedHeading: AbstractNumberingJSON = {
      id: 7,
      levels: [{ level: 0, format: "decimal", text: "%1.", style: "Title" }],
    };
    const editor = editorOf(
      [
        p(
          { style: "Heading1" },
          { type: "commentStart", attrs: { id: 4 } },
          text("a", [{ type: "characterStyle", attrs: { id: "Hyperlink" } }]),
        ),
        p({ numbering: { id: 1, level: 0 } }, text("b")),
      ],
      {
        styles: [
          ...STYLES,
          {
            id: "Numbered",
            type: "paragraph",
            name: "Numbered",
            paragraph: { numbering: { id: 9 } },
          },
        ],
        numbering: {
          abstracts: [BULLETS, numberedHeading],
          instances: [
            { id: 1, abstract: 0 },
            { id: 9, abstract: 7 },
          ],
        },
        comments: [comment(4), comment(5)],
      },
    );
    const { state } = editor;
    const first = editorOf([p({ style: "Numbered" }, text("c"))], envelopeOf(editor)).state;
    const defs = copiedDefinitions(envelopeOf(editor), state.doc);
    expect(defs.styles.map((s) => s.id).sort()).toEqual([
      "CommentText",
      "DefaultParagraphFont",
      "Heading1",
      "Heading1Char",
      "Hyperlink",
      "Normal",
    ]);
    expect(defs.numbering).toEqual({ abstracts: [BULLETS], instances: [{ id: 1, abstract: 0 }] });
    expect(defs.comments.map((c) => c.id)).toEqual([4]);
    // A style's numbering, and the styles its levels number.
    const styled = copiedDefinitions(envelopeOf(editor), first.doc);
    expect(styled.numbering.instances.map((n) => n.id)).toEqual([9]);
    expect(styled.styles.map((s) => s.id).sort()).toEqual(["Normal", "Numbered", "Title"]);
  });
});

describe("fitPaste", () => {
  it("pastes inside one document as it is: same styles and lists, nothing added", () => {
    const editor = editorOf([p({ style: "Heading1", numbering: { id: 1, level: 0 } }, text("a"))]);
    const envelope = envelopeOf(editor);
    const content = editor.state.doc.toJSON();
    const fitted = fitPaste(editor.state, content, copiedDefinitions(envelope, editor.state.doc));
    expect(fitted.envelope).toBe(envelope);
    expect(fitted.doc.toJSON()).toEqual(content);
    // Without definitions (plain text, older copies): the document's own.
    expect(fitPaste(editor.state, content).envelope).toBe(envelope);
  });

  it("uses the target's style of the same name, adds the others with free ids", () => {
    const editor = editorOf([p({}, text("x"))]);
    const definitions: WordDefinitions = {
      styles: [
        // Another definition of a style the target has: the target's is used.
        { id: "Kop1", type: "paragraph", name: "Heading 1", run: [{ type: "italic" }] },
        // A style the target lacks, based on one it has, its id taken by another style.
        { id: "Title", type: "paragraph", name: "Fancy", basedOn: "Base", next: "Kop1" },
        { id: "Base", type: "paragraph", name: "Normal" },
        { id: "Quote", type: "paragraph", name: "Quote", link: "QuoteChar" },
        { id: "QuoteChar", type: "character", name: "Quote Char", link: "Quote" },
      ],
      numbering: { abstracts: [], instances: [] },
      comments: [],
    };
    const fitted = fitPaste(
      editor.state,
      docOf(
        p({ style: "Kop1" }, text("h")),
        p(
          { style: "Title", formatChange: { id: 1, author: "A", previous: { style: "Kop1" } } },
          text("t"),
        ),
        p({ style: "Quote" }, text("q", [{ type: "characterStyle", attrs: { id: "QuoteChar" } }])),
        p({ style: "Missing" }, text("m")),
      ),
      definitions,
    );
    expect(fitted.doc.toJSON().content?.map((b) => b.attrs?.style)).toEqual([
      "Heading1",
      "Title1",
      "Quote",
      "Missing",
    ]);
    expect(fitted.doc.toJSON().content?.[1]?.attrs?.formatChange).toEqual({
      id: 1,
      author: "A",
      previous: { style: "Heading1" },
    });
    expect(fitted.doc.toJSON().content?.[2]?.content?.[0]?.marks).toEqual([
      { type: "characterStyle", attrs: { id: "QuoteChar" } },
    ]);
    const added = fitted.envelope.styles.slice(STYLES.length);
    expect(added).toEqual([
      { id: "Title1", type: "paragraph", name: "Fancy", basedOn: "Normal", next: "Heading1" },
      { id: "Quote", type: "paragraph", name: "Quote", link: "QuoteChar" },
      { id: "QuoteChar", type: "character", name: "Quote Char", link: "Quote" },
    ]);
  });

  it("gives a list from another document an instance of its own, reusing an equal definition", () => {
    const editor = editorOf([p({ numbering: { id: 1, level: 0 } }, text("x"))]);
    const numbers: AbstractNumberingJSON = {
      id: 3,
      levels: [{ level: 0, format: "decimal", text: "%1." }],
    };
    const definitions: WordDefinitions = {
      styles: [],
      numbering: {
        abstracts: [{ ...BULLETS, id: 5 }, numbers],
        // Instance 1 as the target has it, but of another definition: not the target's list.
        instances: [
          { id: 1, abstract: 3, overrides: [{ level: 0, start: 4 }] },
          { id: 2, abstract: 5 },
        ],
      },
      comments: [],
    };
    const fitted = fitPaste(
      editor.state,
      docOf(
        p({ numbering: { id: 1, level: 0 } }, text("a")),
        p({ numbering: { id: 2, level: 1 } }, text("b")),
        p({ numbering: { id: 1, level: 0 } }, text("c")),
        p({ numbering: { id: 0 } }, text("d")),
      ),
      definitions,
    );
    expect(fitted.doc.toJSON().content?.map((b) => b.attrs?.numbering)).toEqual([
      { id: 2, level: 0 },
      { id: 3, level: 1 },
      { id: 2, level: 0 },
      { id: 0 },
    ]);
    expect(fitted.envelope.numbering).toEqual({
      abstracts: [BULLETS, { ...numbers, id: 1 }],
      instances: [
        { id: 1, abstract: 0 },
        { id: 2, abstract: 1, overrides: [{ level: 0, start: 4 }] },
        { id: 3, abstract: 0 },
      ],
    });
  });

  it("goes on with the document's list only when instance and definition are both the same", () => {
    const editor = editorOf([p({ numbering: { id: 1, level: 0 } }, text("x"))]);
    const numbers: AbstractNumberingJSON = { id: 0, levels: [{ level: 0, format: "decimal" }] };
    const idFor = (definitions: WordDefinitions) =>
      fitPaste(
        editor.state,
        docOf(p({ numbering: { id: 1, level: 0 } }, text("a"))),
        definitions,
      ).doc.toJSON().content?.[0]?.attrs?.numbering;
    const of = (
      instance: WordDefinitions["numbering"]["instances"][number],
      abstract = BULLETS,
    ) => ({
      styles: [],
      numbering: { abstracts: [abstract], instances: [instance] },
      comments: [],
    });
    expect(idFor(of({ id: 1, abstract: 0 }))).toEqual({ id: 1, level: 0 });
    // The same definition, another instance (a restart): a list of its own.
    expect(idFor(of({ id: 1, abstract: 0, overrides: [{ level: 0, start: 4 }] }))).toEqual({
      id: 2,
      level: 0,
    });
    // The same instance of another definition.
    expect(idFor(of({ id: 1, abstract: 0 }, numbers))).toEqual({ id: 2, level: 0 });
  });

  it("uses an unnamed style the target has by id", () => {
    const unnamed: StyleJSON = { id: "Plain", type: "paragraph", basedOn: "Normal" };
    const editor = editorOf([p({}, text("x"))], { styles: [...STYLES, unnamed] });
    const fitted = fitPaste(editor.state, docOf(p({ style: "Plain" }, text("a"))), {
      styles: [unnamed],
      numbering: { abstracts: [], instances: [] },
      comments: [],
    });
    expect(fitted.doc.toJSON().content?.[0]?.attrs?.style).toBe("Plain");
    expect(fitted.envelope.styles).toHaveLength(STYLES.length + 1);
  });

  it("numbers a level's style through the map; a style and its list name each other", () => {
    const editor = editorOf([p({}, text("x"))]);
    // The style's id is the target's Title: it is added as Title1, and named so everywhere.
    const definitions: WordDefinitions = {
      styles: [
        { id: "Title", type: "paragraph", name: "Numbered H", paragraph: { numbering: { id: 1 } } },
      ],
      numbering: {
        abstracts: [{ id: 0, levels: [{ level: 0, format: "decimal", style: "Title" }] }],
        instances: [
          {
            id: 1,
            abstract: 0,
            overrides: [{ level: 1, definition: { level: 1, style: "Title" } }],
          },
        ],
      },
      comments: [],
    };
    const fitted = fitPaste(editor.state, docOf(p({ style: "Title" }, text("a"))), definitions);
    expect(fitted.doc.toJSON().content?.[0]?.attrs?.style).toBe("Title1");
    expect(fitted.envelope.styles.at(-1)).toEqual({
      id: "Title1",
      type: "paragraph",
      name: "Numbered H",
      paragraph: { numbering: { id: 2 } },
    });
    expect(fitted.envelope.numbering.abstracts.at(-1)?.levels[0]?.style).toBe("Title1");
    expect(fitted.envelope.numbering.instances.at(-1)).toEqual({
      id: 2,
      abstract: 1,
      overrides: [{ level: 1, definition: { level: 1, style: "Title1" } }],
    });
  });

  it("copies comments with new ids, drops paragraph ids, and keeps a reply with its comment", () => {
    const editor = editorOf(
      [
        p({}, { type: "commentStart", attrs: { id: 0 } }, text("x"), {
          type: "commentEnd",
          attrs: { id: 0 },
        }),
      ],
      { comments: [comment(0)] },
    );
    const anchors = (id: number) => [
      { type: "commentStart", attrs: { id } },
      text(`r${id}`),
      { type: "commentEnd", attrs: { id } },
      { type: "commentReference", attrs: { id } },
    ];
    const definitions: WordDefinitions = {
      styles: STYLES,
      numbering: { abstracts: [], instances: [] },
      comments: [comment(0), comment(1, { parent: 0, done: true }), comment(2, { parent: 9 })],
    };
    const fitted = fitPaste(
      editor.state,
      docOf(
        p(
          { attributes: { "w14:paraId": "1A2B3C4D", "w14:textId": "77777777", "w:rsidR": "00AB" } },
          ...anchors(0),
          ...anchors(1),
          ...anchors(2),
        ),
        p({ attributes: { "w14:paraId": "1A2B3C4E" } }, { type: "commentStart", attrs: { id: 6 } }),
      ),
      definitions,
    );
    const [first, second] = fitted.doc.toJSON().content ?? [];
    expect(first?.attrs?.attributes).toEqual({ "w:rsidR": "00AB" });
    expect(second?.attrs?.attributes).toBeUndefined();
    expect(first?.content?.filter((n) => n.type !== "text").map((n) => n.attrs?.id)).toEqual([
      1, 1, 1, 2, 2, 2, 3, 3, 3,
    ]);
    // An anchor without its comment still gets an id of its own.
    expect(second?.content?.[0]?.attrs?.id).toBe(4);
    expect(fitted.envelope.comments).toStrictEqual([
      comment(0),
      { ...comment(1), content: [p({ style: "CommentText" }, text("note"))] },
      {
        ...comment(2),
        parent: 1,
        done: true,
        content: [p({ style: "CommentText" }, text("note"))],
      },
      { ...comment(3), content: [p({ style: "CommentText" }, text("note"))] },
    ]);
  });

  it("numbers new comments above the target's comments and its anchors without one", () => {
    const pasted = docOf(p({}, { type: "commentReference", attrs: { id: 0 } }));
    const idOf = (editor: ReturnType<typeof editorOf>) =>
      fitPaste(editor.state, pasted).doc.toJSON().content?.[0]?.content?.[0]?.attrs?.id;
    expect(idOf(editorOf([p({})], { comments: [comment(9)] }))).toBe(10);
    expect(idOf(editorOf([p({}, { type: "commentReference", attrs: { id: 12 } })]))).toBe(13);
  });

  it("leaves out a bookmark whose name the document has; others get new ids", () => {
    const editor = editorOf([
      p({}, { type: "bookmarkStart", attrs: { id: 3, name: "taken" } }, text("x"), {
        type: "bookmarkEnd",
        attrs: { id: 3 },
      }),
    ]);
    const fitted = fitPaste(
      editor.state,
      docOf(
        p(
          {},
          { type: "bookmarkStart", attrs: { id: 10, name: "taken" } },
          { type: "bookmarkStart", attrs: { id: 11, name: "free" } },
          text("a"),
          { type: "bookmarkEnd", attrs: { id: 10 } },
          { type: "bookmarkEnd", attrs: { id: 11 } },
          { type: "bookmarkStart", attrs: { id: 12, name: "free" } },
          { type: "bookmarkEnd", attrs: { id: 12 } },
        ),
      ),
    );
    expect(fitted.doc.toJSON().content?.[0]?.content).toEqual([
      { type: "bookmarkStart", attrs: { id: 4, name: "free" } },
      text("a"),
      { type: "bookmarkEnd", attrs: { id: 4 } },
    ]);
  });

  it("refuses definitions that are not a document's: a style based on itself, wrong types", () => {
    const editor = editorOf([p({}, text("x"))]);
    const content = docOf(p({}, text("a")));
    const looped = {
      styles: [{ id: "A", type: "paragraph", basedOn: "A" }],
      numbering: { abstracts: [], instances: [] },
      comments: [],
    };
    expect(() => fitPaste(editor.state, content, looped)).toThrow(/based on itself/);
    expect(() => fitPaste(editor.state, content, { styles: "x" })).toThrow();
    expect(() => fitPaste(editor.state, content, 7)).toThrow();
    expect(() => fitPaste(editor.state, { type: "heading" })).toThrow();
  });
});

describe("fitPastedV2 formatting", () => {
  it("drops bold, italic, underline and strike the paragraph's style gives, keeps the rest", () => {
    const heading: StyleJSON = {
      id: "Heading1",
      type: "paragraph",
      name: "heading 1",
      run: [{ type: "bold" }, { type: "underline" }, { type: "strike" }],
    };
    const editor = editorOf([p({}, text("x"))], {
      styles: [...STYLES.filter((s) => s.id !== "Heading1"), heading],
    });
    const marks = ["bold", "italic", "underline", "strike"].map((type) => ({ type }));
    const fitted = fitPastedV2(
      editor.state,
      parseContent({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "h", marks }] },
          { type: "paragraph", content: [{ type: "text", text: "p", marks }] },
        ],
      }),
    );
    const [h, para] = fitted.doc.toJSON().content ?? [];
    expect(h?.content?.[0]?.marks).toEqual([{ type: "italic" }]);
    expect(para?.content?.[0]?.marks?.map((m) => m.type)).toEqual([
      "bold",
      "italic",
      "underline",
      "strike",
    ]);
  });
});

describe("fitPastedV2", () => {
  const v2 = (content: unknown[]) => parseContent({ type: "doc", content });
  const item = (value: string) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  });

  it("adds Word's built-in styles the paste uses, and reuses the document's list definition", () => {
    const editor = editorOf([p({ numbering: { id: 1, level: 0 } }, text("x"))], {
      styles: STYLES.filter((s) => s.id !== "Hyperlink"),
    });
    const fitted = fitPastedV2(
      editor.state,
      v2([
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H" }] },
        { type: "bulletList", content: [item("a")] },
        { type: "orderedList", content: [item("b")] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "l", marks: [{ type: "link", attrs: { href: "https://e.x/" } }] },
          ],
        },
      ]),
    );
    const blocks = fitted.doc.toJSON().content ?? [];
    expect(blocks.map((b) => b.attrs?.style ?? null)).toEqual([
      "Heading2",
      "ListParagraph",
      "ListParagraph",
      null,
    ]);
    expect(blocks[3]?.content?.[0]?.marks).toEqual([
      { type: "link", attrs: { href: "https://e.x/" } },
      { type: "characterStyle", attrs: { id: "Hyperlink" } },
    ]);
    const added = fitted.envelope.styles.slice(STYLES.length - 1);
    expect(added.map((s) => s.id)).toEqual(["Heading2", "ListParagraph", "Hyperlink"]);
    // Word's definitions, based on the document's own Normal and Default Paragraph Font.
    expect(added[0]).toMatchObject({
      basedOn: "Normal",
      next: "Normal",
      paragraph: { outlineLevel: 1, spacing: { before: 40, after: 0 } },
    });
    expect(added[2]).toMatchObject({ basedOn: "DefaultParagraphFont" });
    // Each pasted list is a new one, even where its instance id is the document's (1): the
    // bullets on the document's definition, the numbers on one of their own.
    const [, bullets, numbers] = blocks.map((b) => b.attrs?.numbering as { id: number });
    const { instances, abstracts } = fitted.envelope.numbering;
    expect(bullets?.id).not.toBe(1);
    expect(instances.find((n) => n.id === bullets?.id)?.abstract).toBe(0);
    expect(numbers?.id).not.toBe(1);
    expect(abstracts.map((a) => a.levels[0]?.format)).toEqual(["bullet", "decimal"]);
  });
});
