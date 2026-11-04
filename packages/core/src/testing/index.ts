// Test-only helpers: excluded from the build and the published package.
import fc from "fast-check";
import type { MarkJSON, NodeJSON } from "../model/index.js";
import { Schema } from "../model/index.js";

/**
 * A schema richer than v1, built through the public spec API: nested blocks (blockquote), a
 * block leaf (rule), a mark with attrs (link) and a mark that excludes all others (code).
 */
export const testSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: {
        level: {
          default: 1,
          validate: (v) => (v === 1 || v === 2 ? undefined : "level must be 1 or 2"),
        },
      },
    },
    blockquote: { group: "block", content: "block+" },
    rule: { group: "block" },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true },
  },
  marks: {
    bold: {},
    italic: {},
    link: { attrs: { href: {} } },
    code: { excludes: "_" },
  },
});

export interface JSONOptions {
  /** Use testSchema's extra node and mark types (blockquote, rule, link, code). */
  rich: boolean;
}

/**
 * Valid but not necessarily canonical content JSON: marks in any order, adjacent text runs
 * with equal marks, empty `content` arrays.
 */
export function docJSON({ rich }: JSONOptions): fc.Arbitrary<NodeJSON> {
  const plainMarks = fc
    .record({
      bold: fc.boolean(),
      italic: fc.boolean(),
      link: rich ? fc.option(fc.constantFrom("a", "b")) : fc.constant(null),
    })
    .map(({ bold, italic, link }): MarkJSON[] => [
      ...(bold ? [{ type: "bold" }] : []),
      ...(italic ? [{ type: "italic" }] : []),
      ...(link === null ? [] : [{ type: "link", attrs: { href: link } }]),
    ]);
  const marks = (
    rich ? fc.oneof(plainMarks, fc.constant<MarkJSON[]>([{ type: "code" }])) : plainMarks
  ).chain((set) => fc.shuffledSubarray(set, { minLength: set.length }));
  const withMarks = (node: NodeJSON, set: MarkJSON[]) =>
    set.length ? { ...node, marks: set } : node;

  const inline = fc.oneof(
    {
      weight: 4,
      arbitrary: fc
        .tuple(
          fc.string({ unit: fc.constantFrom("a", "b", " ", "é"), minLength: 1, maxLength: 4 }),
          marks,
        )
        .map(([text, set]) => withMarks({ type: "text", text }, set)),
    },
    { weight: 1, arbitrary: marks.map((set) => withMarks({ type: "hardBreak" }, set)) },
  );
  const inlineContent = fc.array(inline, { maxLength: 5 });
  const textblock = fc.oneof(
    fc.tuple(inlineContent, fc.boolean()).map(([content, keepEmpty]) => ({
      type: "paragraph",
      ...(content.length || keepEmpty ? { content } : {}),
    })),
    fc.tuple(fc.constantFrom(1, 2), inlineContent).map(([level, content]) => ({
      type: "heading",
      attrs: { level },
      content,
    })),
  );

  if (!rich) {
    return fc
      .array(textblock, { minLength: 1, maxLength: 4 })
      .map((content) => ({ type: "doc", content }));
  }
  const { block } = fc.letrec<{ block: NodeJSON }>((tie) => ({
    block: fc.oneof(
      { maxDepth: 3, depthIdentifier: "block" },
      textblock,
      fc.constant({ type: "rule" }),
      fc
        .array(tie("block"), { minLength: 1, maxLength: 3, depthIdentifier: "block" })
        .map((content) => ({ type: "blockquote", content })),
    ),
  }));
  return fc
    .array(block, { minLength: 1, maxLength: 4 })
    .map((content) => ({ type: "doc", content }));
}

/**
 * A v1 document of roughly `pages` A4 pages: per page a heading and five ~600-character
 * paragraphs with a few marked runs and a hard break. Deterministic.
 */
export function pagesFixture(pages: number): NodeJSON {
  const words =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor".split(" ");
  const sentence = (seed: number, length: number) =>
    Array.from({ length }, (_, i) => words[(seed * 7 + i * 3) % words.length]).join(" ");
  const content: NodeJSON[] = [];
  for (let page = 0; page < pages; page++) {
    content.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: `Section ${page + 1}` }],
    });
    for (let p = 0; p < 5; p++) {
      const seed = page * 5 + p;
      content.push({
        type: "paragraph",
        content: [
          { type: "text", text: `${sentence(seed, 30)} ` },
          { type: "text", text: sentence(seed + 1, 4), marks: [{ type: "bold" }] },
          { type: "text", text: ` ${sentence(seed + 2, 30)} ` },
          {
            type: "text",
            text: sentence(seed + 3, 3),
            marks: [{ type: "bold" }, { type: "italic" }],
          },
          { type: "hardBreak" },
          { type: "text", text: sentence(seed + 4, 30) },
        ],
      });
    }
  }
  return { type: "doc", content };
}
