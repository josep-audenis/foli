import { describe, expect, it } from "vitest";
import { type Block, type FlowBlock, flow, paginate, type Styles } from "./layout.js";

const styles: Styles = {
  title: { size: 20, line: 20, before: 0, after: 0, keepNext: true },
  heading: { size: 10, line: 10, before: 0, after: 0, keepNext: true },
  body: { size: 10, line: 10, before: 0, after: 0, keepNext: false },
};
const ON = { widows: true, keepWithNext: true };
const OFF = { widows: false, keepWithNext: false };

/** A block of `count` one-word lines. */
function block(kind: FlowBlock["kind"], count: number): FlowBlock {
  const word = { id: 0, text: "x", marks: [], glued: false };
  return { kind, lines: Array.from({ length: count }, () => [{ word, x: 0, width: 1 }]) };
}
const perPage = (result: ReturnType<typeof paginate>, block: number) =>
  result.lines
    .filter((l) => l.block === block)
    .reduce<Record<number, number>>((all, l) => {
      all[l.page] = (all[l.page] ?? 0) + 1;
      return all;
    }, {});

describe("flow", () => {
  const words = (texts: string[], glued: number[] = []): Block => ({
    kind: "body",
    words: texts.map((text, id) => ({ id, text, marks: [], glued: glued.includes(id) })),
  });
  const measure = (w: { text: string }) => w.text.length;

  it("breaks at the width and keeps glued punctuation on its line", () => {
    const [out] = flow([words(["aaaa", "bbbb", ".", "cc"], [2])], 9, measure, () => 1);
    expect(out?.lines.map((l) => l.map((w) => w.word.text))).toEqual([
      ["aaaa", "bbbb", "."],
      ["cc"],
    ]);
  });

  it("closes up around hidden words", () => {
    const [out] = flow(
      [words(["a", "gone", "b"])],
      9,
      measure,
      () => 1,
      (w) => w.text !== "gone",
    );
    expect(out?.lines[0]?.map((w) => w.x)).toEqual([0, 2]);
  });
});

describe("paginate", () => {
  it("leaves a widow when the rule is off and moves a line when it is on", () => {
    const blocks = [block("body", 6)];
    const off = paginate(blocks, styles, 50, OFF);
    expect(perPage(off, 0)).toEqual({ 0: 5, 1: 1 });
    expect(off.flags.map((f) => f.kind)).toEqual(["widow"]);
    const on = paginate(blocks, styles, 50, ON);
    expect(perPage(on, 0)).toEqual({ 0: 4, 1: 2 });
    expect(on.flags).toEqual([]);
  });

  it("moves a paragraph that would leave one line alone at the bottom", () => {
    const blocks = [block("body", 4), block("body", 4)];
    const off = paginate(blocks, styles, 50, OFF);
    expect(off.flags.map((f) => f.kind)).toContain("orphan");
    const on = paginate(blocks, styles, 50, ON);
    expect(perPage(on, 1)).toEqual({ 1: 4 });
    expect(on.flags).toEqual([]);
  });

  it("keeps a heading with its paragraph", () => {
    const blocks = [block("body", 4), block("heading", 1), block("body", 3)];
    const off = paginate(blocks, styles, 50, OFF);
    expect(off.flags.map((f) => f.kind)).toContain("stranded");
    const on = paginate(blocks, styles, 50, ON);
    expect(on.lines.find((l) => l.block === 1)?.page).toBe(1);
    expect(on.flags).toEqual([]);
  });

  it("always places every line, even when a page is too short", () => {
    const result = paginate([block("title", 2)], styles, 5, ON);
    expect(result.lines).toHaveLength(2);
    expect(result.pages).toBe(2);
  });
});
