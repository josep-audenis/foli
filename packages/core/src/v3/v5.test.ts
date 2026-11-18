import { describe, expect, it } from "vitest";
import type { NodeJSON } from "../model/index.js";
import { createEditor } from "../state/index.js";
import { createDocument, parseContent, parseDocument, SCHEMA_VERSION } from "./document.js";

/** Schema v5 (ADR-0007): stories, fields, content controls, notes, columns. */

const p = (...content: NodeJSON[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});
const text = (value: string): NodeJSON => ({ type: "text", text: value });
const doc = (...content: NodeJSON[]): NodeJSON => ({ type: "doc", content });
const table = (controls?: string[]): NodeJSON => ({
  type: "table",
  ...(controls ? { attrs: { controls } } : {}),
  content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p()] }] }],
});
const envelope = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: SCHEMA_VERSION,
  section: {},
  defaults: {},
  styles: [],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: doc(p()),
  ...overrides,
});
const reference = { type: "noteReference", attrs: { story: "footnote:1" } };

describe("schema v5", () => {
  it("keeps stories, controls, settings and section parts through a parse", () => {
    const input = envelope({
      section: {
        headers: { default: "rId7" },
        columns: { count: 2, space: 720, separator: true, widths: [{ width: 4000, space: 720 }] },
        pageNumbers: { start: 3, format: "lowerRoman" },
        footnotes: { position: "beneathText", restart: "eachPage" },
      },
      stories: {
        rId7: { kind: "header", content: doc(p(text("Header"))) },
        "footnote:1": {
          kind: "footnote",
          noteType: "normal",
          content: doc(p({ type: "noteMark" }, text(" A note"))),
        },
        "footnote:-1": { kind: "footnote", noteType: "separator", content: doc(p()) },
      },
      controls: {
        c1: {
          kind: "dropDown",
          tag: "state",
          alias: "State",
          lock: "sdtLocked",
          items: [{ value: "a", display: "A" }],
          placeholder: { showing: true, docPart: "DefaultPlaceholder" },
          binding: { xpath: "/a", storeItemId: "{1}" },
        },
      },
      settings: { evenAndOddHeaders: true, endnotes: { position: "docEnd", format: "decimal" } },
      content: doc(p(text("Body"), reference)),
    });
    const parsed = parseDocument(input);
    expect(parsed).toEqual(input);
    expect(parseDocument(parsed)).toEqual(parsed);
  });

  it("keeps a field's parts and nested fields, a control's ends and block controls", () => {
    const field = (...inside: NodeJSON[]) => [
      { type: "fieldStart", attrs: { dirty: true } },
      ...inside,
      { type: "fieldEnd" },
    ];
    const content = doc(
      {
        type: "paragraph",
        attrs: { controls: ["outer", "inner"] },
        content: [
          ...field(
            { type: "fieldCode", attrs: { text: " IF " } },
            ...field({ type: "fieldCode", attrs: { text: "MERGEFIELD x" } }),
            { type: "fieldSeparator" },
            text("result"),
          ),
          { type: "controlStart", attrs: { id: "c" } },
          text("in a control"),
          { type: "controlEnd", attrs: { id: "c" } },
        ],
      },
      { type: "opaqueBlock", attrs: { xml: "<w:sdt/>", controls: ["outer"] } },
      p(),
    );
    expect(parseContent(content).toJSON()).toEqual(content);
  });

  it("lets a table follow a table only in another content control", () => {
    expect(() => parseContent(doc(table(), table(), p()))).toThrow(/follow a table/);
    expect(() => parseContent(doc(table(["a"]), table(["a"]), p()))).toThrow(/follow a table/);
    expect(() => parseContent(doc(table(["a"]), table(["b"]), p()))).not.toThrow();
  });

  it("refuses what a story cannot hold", () => {
    const story = (kind: string, ...blocks: NodeJSON[]) =>
      envelope({ stories: { s: { kind, content: doc(...blocks) } } });
    const ending = { type: "paragraph", attrs: { section: {} } };
    expect(() => parseDocument(story("header", ending))).toThrow(/cannot end a section/);
    expect(() => parseDocument(story("footer", p(reference)))).toThrow(/note reference/);
    expect(() => parseDocument(story("footnote", p(reference)))).toThrow(/note reference/);
    expect(() => parseDocument(story("endnote", p({ type: "pageBreak" })))).toThrow(/pageBreak/);
    expect(() => parseDocument(story("header", p({ type: "pageBreak" })))).not.toThrow();
  });

  it("refuses malformed envelopes", () => {
    const bad = (overrides: Record<string, unknown>) => () => parseDocument(envelope(overrides));
    expect(bad({ stories: { s: { kind: "aside", content: doc(p()) } } })).toThrow(/kind/);
    expect(bad({ stories: { s: { kind: "header" } } })).toThrow(/content is required/);
    expect(
      bad({ stories: { s: { kind: "header", noteType: "separator", content: doc(p()) } } }),
    ).toThrow(/noteType is for notes/);
    expect(bad({ stories: JSON.parse('{"__proto__":{"kind":"header"}}') })).toThrow(/key/);
    expect(bad({ controls: { c: { tag: "x" } } })).toThrow(/kind is required/);
    expect(bad({ settings: { other: true } })).toThrow(/unknown key other/);
    expect(bad({ section: { columns: { count: 46 } } })).toThrow(/columns/);
    expect(
      bad({
        comments: [{ id: 1, author: "A", content: [p(reference)] }],
      }),
    ).toThrow(/comment cannot hold a note reference/);
  });

  it("accepts a reference whose note is missing, as Word opens it", () => {
    expect(() => parseDocument(envelope({ content: doc(p(reference)) }))).not.toThrow();
  });

  it("migrates v4 by its version only, and refuses what v4 cannot hold", () => {
    const v4 = envelope({ schemaVersion: 4, content: doc(p(text("kept"))) });
    expect(parseDocument(v4)).toEqual({ ...v4, schemaVersion: SCHEMA_VERSION });
    expect(() => parseDocument({ ...v4, stories: {} })).toThrow(/schema 5 and later/);
    expect(() => parseDocument({ ...v4, content: doc(p(reference)) })).toThrow(
      /noteReference is a schema 5 node \(the document says schema 4\)/,
    );
    expect(() =>
      parseDocument({
        ...v4,
        content: doc({ type: "paragraph", attrs: { controls: ["c"] } }),
      }),
    ).toThrow(/controls is a schema 5 node/);
    expect(() => parseDocument({ ...v4, section: { columns: { count: 2 } } })).toThrow(
      /columns is of schema 5/,
    );
    expect(() =>
      parseDocument({
        ...v4,
        content: doc({ type: "paragraph", attrs: { section: { columns: { count: 2 } } } }),
      }),
    ).toThrow(/columns is a schema 5 node/);
  });

  it("new documents are v5, and an editor gives its stories back", () => {
    expect(createDocument().schemaVersion).toBe(5);
    const stories = { rId1: { kind: "header", content: doc(p(text("H"))) } };
    const editor = createEditor({ document: parseDocument(envelope({ stories })) });
    expect(editor.getDocument()).toMatchObject({ schemaVersion: 5, stories });
  });
});
