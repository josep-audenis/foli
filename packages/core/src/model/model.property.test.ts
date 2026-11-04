import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDocument, parseDocument } from "../document.js";
import { schema } from "../schema.js";
import { docJSON, testSchema } from "../testing/index.js";
import { Mark, type Node, ReplaceError } from "./index.js";

const RUNS = { numRuns: 10_000 };
const TIMEOUT = 120_000;

/** Plain assertion for hot loops; vitest's expect is too slow for millions of checks. */
function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const richDocs = docJSON({ rich: true }).map((json) => testSchema.nodeFromJSON(json));

/** A document with two positions in it, `from <= to`. */
const docWithRange = richDocs.chain((doc) =>
  fc
    .tuple(fc.nat(doc.content.size), fc.nat(doc.content.size))
    .map(([a, b]) => ({ doc, from: Math.min(a, b), to: Math.max(a, b) })),
);

function assertNormalForm(node: Node): void {
  node.check();
  const children = node.content.content;
  children.forEach((child, i) => {
    const ranks = child.marks.map((m) => m.type.rank);
    ok(
      ranks.every((rank, j) => !j || (ranks[j - 1] as number) < rank),
      `mark order ${child}`,
    );
    const prev = children[i - 1];
    ok(!(prev?.isText && child.isText && Mark.sameSet(prev.marks, child.marks)), `${node}`);
    assertNormalForm(child);
  });
}

describe("model properties (10k runs each)", () => {
  it(
    "fromJSON(toJSON(x)) = x, and toJSON is canonical",
    () => {
      fc.assert(
        fc.property(richDocs, (doc) => {
          const json = doc.toJSON();
          const again = testSchema.nodeFromJSON(json);
          expect(again.eq(doc)).toBe(true);
          // Same keys in the same order: the serialized form is canonical.
          expect(JSON.stringify(again.toJSON())).toBe(JSON.stringify(json));
          assertNormalForm(doc);
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );

  it(
    "v1 documents load, normalize idempotently and keep their text",
    () => {
      fc.assert(
        fc.property(docJSON({ rich: false }), (content) => {
          const loaded = parseDocument(
            JSON.parse(JSON.stringify(createDocument(content as never))),
          );
          expect(parseDocument(loaded)).toEqual(loaded);
          expect(schema.nodeFromJSON(loaded.content).textContent).toBe(
            schema.nodeFromJSON(content).textContent,
          );
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );

  it(
    "resolve: every position has a consistent tree context",
    () => {
      fc.assert(
        fc.property(richDocs, (doc) => {
          for (let pos = 0; pos <= doc.content.size; pos++) {
            const $pos = doc.resolve(pos);
            const at = `@${pos}`; // fast-check prints the doc itself
            ok($pos.pos === pos && $pos.doc === doc, at);
            for (let d = 0; d <= $pos.depth; d++) {
              ok($pos.start(d) <= pos && $pos.end(d) >= pos, `${at} start/end ${d}`);
              if (d > 0) {
                ok($pos.node(d) === $pos.node(d - 1).child($pos.index(d - 1)), `${at} node ${d}`);
                ok($pos.before(d) === $pos.posAtIndex($pos.index(d - 1), d - 1), `${at} before`);
                ok($pos.after(d) === $pos.before(d) + $pos.node(d).nodeSize, `${at} after`);
                ok(doc.nodeAt($pos.before(d)) === $pos.node(d), `${at} nodeAt`);
              }
            }
            ok(!$pos.parent.isText, `${at} parent`);
            ok(pos === $pos.posAtIndex($pos.index()) + $pos.textOffset, `${at} posAtIndex`);
            ok($pos.parentOffset === pos - $pos.start(), `${at} parentOffset`);
            const after = $pos.nodeAfter;
            const before = $pos.nodeBefore;
            if (!$pos.textOffset) {
              ok(after === doc.nodeAt(pos), `${at} nodeAfter`);
            } else {
              const text = $pos.parent.child($pos.index()).text;
              ok(`${before?.text}${after?.text}` === text, `${at} text split`);
            }
            ok($pos.indexAfter() === $pos.index() + ($pos.textOffset ? 1 : 0), `${at} indexAfter`);
          }
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );

  it(
    "slice: size, JSON round trip, and replacing a range with its own slice is a no-op",
    () => {
      fc.assert(
        fc.property(docWithRange, ({ doc, from, to }) => {
          const slice = doc.slice(from, to);
          expect(slice.size).toBe(to - from);
          expect(testSchema.sliceFromJSON(slice.toJSON()).eq(slice)).toBe(true);
          expect(doc.replace(from, to, slice).eq(doc)).toBe(true);
          expect(doc.textBetween(from, to)).toBe(slice.content.textBetween(0, slice.content.size));
        }),
        RUNS,
      );
    },
    TIMEOUT,
  );

  it(
    "replace: valid result of the expected size, unchanged before `from`",
    () => {
      const input = docWithRange.chain(({ doc, from, to }) =>
        fc
          .tuple(fc.nat(doc.content.size), fc.nat(doc.content.size))
          .map(([a, b]) => ({ doc, from, to, slice: doc.slice(Math.min(a, b), Math.max(a, b)) })),
      );
      let applied = 0;
      fc.assert(
        fc.property(input, ({ doc, from, to, slice }) => {
          let result: Node;
          try {
            result = doc.replace(from, to, slice);
          } catch (error) {
            expect(error).toBeInstanceOf(ReplaceError);
            return;
          }
          applied++;
          result.check();
          assertNormalForm(result);
          expect(result.content.size).toBe(doc.content.size - (to - from) + slice.size);
          expect(result.slice(0, from).eq(doc.slice(0, from))).toBe(true);
          expect(testSchema.nodeFromJSON(result.toJSON()).eq(result)).toBe(true);
        }),
        RUNS,
      );
      // Guard against a generator that only produces rejected replaces.
      expect(applied).toBeGreaterThan(RUNS.numRuns / 5);
    },
    TIMEOUT,
  );
});
