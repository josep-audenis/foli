import {
  createDocument,
  createEditor,
  type Extension,
  type FoliDocument,
  type NodeJSON,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";
import { DocxError, readPackage } from "./package.js";

// ADR-0008: custom nodes and marks as content controls tagged `foli:` + type and attributes.
const acme: Extension = {
  name: "acme",
  nodes: {
    "acme:mention": {
      inline: true,
      attrs: { id: {}, label: {} },
      text: (attrs) => `@${String(attrs.label)}`,
    },
    "acme:card": { attrs: { id: {} }, text: (attrs) => `Card ${String(attrs.id)}` },
  },
  marks: { "acme:topic": { attrs: { topic: {} }, inclusive: false } },
};
const extensions = [acme];

const text = (value: string, marks?: NodeJSON["marks"]): NodeJSON => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const mention = (id: string, label: string, marks?: NodeJSON["marks"]): NodeJSON => ({
  type: "acme:mention",
  attrs: { id, label },
  ...(marks ? { marks } : {}),
});
const topic = (value: string) => ({ type: "acme:topic", attrs: { topic: value } });
const bold = { type: "bold" };

function sample(): FoliDocument {
  const cell = (content: NodeJSON[]): NodeJSON => ({
    type: "tableCell",
    content: [{ type: "paragraph", content }],
  });
  return createDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          text("Ask "),
          mention("u-42", "Ada Lovelace"),
          text(" about the "),
          text("budget", [topic("finance")]),
          text(" and "),
          text("plan", [bold, topic("finance")]),
          text("."),
        ],
      },
      { type: "acme:card", attrs: { id: "c-1" } },
      {
        type: "table",
        attrs: { grid: [4000, 4000] },
        content: [
          {
            type: "tableRow",
            content: [
              cell([mention("u-7", "Grace", [bold])]),
              cell([text("roadmap", [topic("product-2027")])]),
            ],
          },
        ],
      },
      { type: "paragraph" },
    ],
  });
}

/** The custom nodes and the text under custom marks, in order, with their other marks. */
function customs(tree: NodeJSON): unknown[] {
  const found: unknown[] = [];
  const walk = (node: NodeJSON) => {
    // `runExt` is the `w:rPr` an import keeps verbatim, not formatting of its own.
    const marks = (node.marks ?? []).filter((m) => m.type !== "runExt");
    if (node.type.includes(":")) found.push({ node: node.type, attrs: node.attrs, marks });
    else if (marks.some((m) => m.type.includes(":"))) found.push({ text: node.text, marks });
    node.content?.forEach(walk);
  };
  walk(tree);
  return found;
}

/** The tags and text of the controls in a document read without the mapping. */
const tagged = (document: FoliDocument) =>
  Object.values(document.controls ?? {}).map((c) => [c.kind, c.lock ?? null, c.tag]);

describe("custom nodes and marks in .docx (ADR-0008)", () => {
  it("go out as tagged content controls and come back the same", async () => {
    const bytes = await exportDocx(sample(), undefined, { extensions });
    const { document } = await importDocx(bytes);
    expect(customs(document.content)).toEqual(customs(sample().content));
    // The mapping's controls are gone; nothing else changed.
    expect(document.controls ?? {}).toEqual({});
    expect(customs(document.content)).toContainEqual({
      node: "acme:mention",
      attrs: { id: "u-7", label: "Grace" },
      marks: [bold],
    });
    // Read again by an editor with the extension: valid, and saved the same.
    const editor = createEditor({ document, extensions });
    expect(customs(editor.getDocument().content)).toEqual(customs(sample().content));
  });

  it("are written as controls Word lists: kind, lock, tag and the node's text", async () => {
    const bytes = await exportDocx(sample(), undefined, { extensions });
    const pkg = await readPackage(bytes);
    const body = pkg.xml(pkg.mainDocument).source;
    expect(
      [...body.matchAll(/<w:tag w:val="([^"]*)"/g)].map((m) => m[1]?.replaceAll("&#34;", '"')),
    ).toEqual([
      'foli:{"node":"acme:mention","attrs":{"id":"u-42","label":"Ada Lovelace"}}',
      'foli:{"mark":"acme:topic","attrs":{"topic":"finance"}}',
      'foli:{"mark":"acme:topic","attrs":{"topic":"finance"}}',
      'foli:{"node":"acme:card","attrs":{"id":"c-1"}}',
      'foli:{"node":"acme:mention","attrs":{"id":"u-7","label":"Grace"}}',
      'foli:{"mark":"acme:topic","attrs":{"topic":"product-2027"}}',
    ]);
    expect(body).toContain("@Ada Lovelace");
    expect(body).toContain("Card c-1");
  });

  it("keep a foreign node's control text, or write its type when loaded from JSON", async () => {
    const bytes = await exportDocx(sample(), undefined, { extensions });
    // An editor without the extension: the content is foreign, written back the same, with the
    // text Word showed.
    const imported = (await importDocx(bytes)).document;
    const editor = createEditor({ document: imported });
    expect(editor.state.doc.firstChild?.child(1).type.name).toBe("foreignInline");
    const again = await exportDocx(editor.getDocument());
    const back = (await importDocx(again)).document;
    expect(customs(back.content)).toEqual(customs(sample().content));
    const text = async (document: FoliDocument) => {
      const pkg = await readPackage(await exportDocx(document));
      return pkg.xml(pkg.mainDocument).source;
    };
    expect(await text(editor.getDocument())).toContain("@Ada Lovelace");
    // Loaded from stored JSON: no text but the type.
    const stored = JSON.parse(JSON.stringify(editor.getDocument())) as FoliDocument;
    const plain = await text(stored);
    expect(plain).toContain("[acme:mention]");
    expect(plain).toContain("[acme:card]");
    expect(customs((await importDocx(await exportDocx(stored))).document.content)).toEqual(
      customs(sample().content),
    );
  });

  it("refuses attributes too long for a tag instead of cutting them", async () => {
    const doc = createDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [mention("u-1", "x".repeat(250))] }],
    });
    await expect(exportDocx(doc, undefined, { extensions })).rejects.toThrow(DocxError);
    await expect(exportDocx(doc)).rejects.toThrow(/acme:mention: its attributes do not fit/);
  });

  it("leave a control whose tag only looks like Foli's as a control", async () => {
    const doc = createDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "controlStart", attrs: { id: "1" } },
            text("kept"),
            { type: "controlEnd", attrs: { id: "1" } },
          ],
        },
      ],
    });
    for (const tag of [
      "foli:{not json",
      'foli:{"node":"plain"}',
      'foli:{"node":"a:b","attrs":5}',
    ]) {
      const read = (
        await importDocx(await exportDocx({ ...doc, controls: { "1": { kind: "richText", tag } } }))
      ).document;
      expect(tagged(read)).toEqual([["richText", null, tag]]);
    }
  });

  it("leave a tagged control as a control when converting it would lose anything", async () => {
    const node = 'foli:{"node":"acme:mention","attrs":{"id":"u-1","label":"A"}}';
    const card = 'foli:{"node":"acme:card","attrs":{"id":"c-1"}}';
    const mark = 'foli:{"mark":"acme:topic","attrs":{"topic":"t"}}';
    const start = (id: string): NodeJSON => ({ type: "controlStart", attrs: { id } });
    const end = (id: string): NodeJSON => ({ type: "controlEnd", attrs: { id } });
    const p = (content: NodeJSON[], attrs?: Record<string, unknown>): NodeJSON => ({
      type: "paragraph",
      ...(attrs ? { attrs } : {}),
      ...(content.length ? { content } : {}),
    });
    const kept = async (
      blocks: NodeJSON[],
      controls: NonNullable<FoliDocument["controls"]>,
      extra: Partial<FoliDocument> = {},
    ) => {
      const doc = {
        ...createDocument({ type: "doc", content: [...blocks, p([])] }),
        controls,
        ...extra,
      };
      const read = (await importDocx(await exportDocx(doc))).document;
      expect(customs(read.content)).toEqual([]);
      expect(
        tagged(read)
          .map((t) => t[2])
          .sort(),
      ).toEqual(
        Object.values(controls)
          .map((c) => c.tag)
          .sort(),
      );
      return read;
    };
    const textControl = (tag: string) => ({
      kind: "text" as const,
      lock: "contentLocked" as const,
      tag,
    });
    // A node's control holding a bookmark, or text formatted two ways.
    const bookmarked = await kept(
      [
        p([
          start("1"),
          { type: "bookmarkStart", attrs: { id: 0, name: "here" } },
          text("@A"),
          { type: "bookmarkEnd", attrs: { id: 0 } },
          end("1"),
        ]),
      ],
      { "1": textControl(node) },
    );
    expect(JSON.stringify(bookmarked.content)).toContain("bookmarkStart");
    await kept([p([start("1"), text("@"), text("A", [bold]), end("1")])], {
      "1": textControl(node),
    });
    // A mark's control with nothing in it.
    await kept([p([text("x"), start("1"), end("1")])], { "1": { kind: "richText", tag: mark } });
    // A block node's control: inside another control, with properties, a section, a tracked
    // insertion, formatted text, a comment anchor, or around two paragraphs.
    const outer = { kind: "richText" as const, tag: "outer" };
    await kept([p([text("Card c-1")], { controls: ["2", "1"] })], {
      "2": outer,
      "1": textControl(card),
    });
    await kept([p([text("Card c-1")], { controls: ["1"], justification: "center" })], {
      "1": textControl(card),
    });
    await kept([p([text("Card c-1")], { controls: ["1"], section: {} }), p([text("next")])], {
      "1": textControl(card),
    });
    const revision = { insertion: { id: 1, author: "A", date: null } };
    await kept([p([text("Card c-1")], { controls: ["1"], revision })], { "1": textControl(card) });
    await kept([p([text("Card c-1", [bold])], { controls: ["1"] })], { "1": textControl(card) });
    const comment = { id: 0, author: "A", content: [p([text("note")])] };
    await kept(
      [
        p(
          [
            { type: "commentStart", attrs: { id: 0 } },
            text("Card c-1"),
            { type: "commentEnd", attrs: { id: 0 } },
          ],
          { controls: ["1"] },
        ),
      ],
      { "1": textControl(card) },
      { comments: [comment] },
    );
    await kept([p([text("Card")], { controls: ["1"] }), p([text("c-1")], { controls: ["1"] })], {
      "1": textControl(card),
    });
  });
});
