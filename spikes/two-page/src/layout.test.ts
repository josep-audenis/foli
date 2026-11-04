import { describe, expect, it } from "vitest";
import { paginate } from "./layout.js";
import { charRange, replace } from "./model.js";

const base = { lineHeight: 10, paraGap: 5, pageHeight: 100 };

describe("paginate", () => {
  it("keeps short paragraphs on one page", () => {
    const pages = paginate({ ...base, lineStarts: [[0], [0, 5]], lengths: [3, 9] });
    expect(pages).toEqual([
      [
        { para: 0, start: 0, end: 3, continues: false },
        { para: 1, start: 0, end: 9, continues: false },
      ],
    ]);
  });

  it("splits a paragraph at the line that overflows", () => {
    // para 0: 8 lines (80px) + gap 5 → 15px left = 1 line of para 1, rest on page 2
    const pages = paginate({
      ...base,
      lineStarts: [
        [0, 1, 2, 3, 4, 5, 6, 7],
        [0, 10, 20],
      ],
      lengths: [8, 30],
    });
    expect(pages).toEqual([
      [
        { para: 0, start: 0, end: 8, continues: false },
        { para: 1, start: 0, end: 10, continues: true },
      ],
      [{ para: 1, start: 10, end: 30, continues: false }],
    ]);
  });

  it("moves a paragraph to the next page when no line fits", () => {
    const pages = paginate({
      ...base,
      lineStarts: [Array.from({ length: 10 }, (_, i) => i), [0]],
      lengths: [10, 4],
    });
    expect(pages.map((page) => page.map((f) => f.para))).toEqual([[0], [1]]);
  });

  it("spreads a paragraph longer than a page over several pages", () => {
    const pages = paginate({
      ...base,
      lineStarts: [Array.from({ length: 25 }, (_, i) => i * 2)],
      lengths: [50],
    });
    expect(pages.map((page) => page.map((f) => [f.start, f.end]))).toEqual([
      [[0, 20]],
      [[20, 40]],
      [[40, 50]],
    ]);
  });

  it("gives an empty paragraph one line", () => {
    expect(paginate({ ...base, lineStarts: [[0]], lengths: [0] })).toEqual([
      [{ para: 0, start: 0, end: 0, continues: false }],
    ]);
  });
});

describe("toy model", () => {
  it("replaces across paragraphs and splits on newlines", () => {
    expect(replace(["hello", "world"], { p: 0, o: 2 }, { p: 1, o: 3 }, "X\nY")).toEqual({
      paras: ["heX", "Yld"],
      caret: { p: 1, o: 1 },
    });
  });

  it("finds character ranges across paragraph boundaries and surrogate pairs", () => {
    expect(charRange(["ab", "c"], { p: 1, o: 0 }, -1)).toEqual([
      { p: 0, o: 2 },
      { p: 1, o: 0 },
    ]);
    expect(charRange(["a😀"], { p: 0, o: 3 }, -1)).toEqual([
      { p: 0, o: 1 },
      { p: 0, o: 3 },
    ]);
    expect(charRange(["ab"], { p: 0, o: 0 }, -1)).toBeNull();
  });
});
