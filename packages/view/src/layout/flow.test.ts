import { DEFAULT_SETTINGS } from "@foli/core";
import { describe, expect, it } from "vitest";
import { type BlockBox, contentHeight, type Fragment, flow, PX_PER_MM } from "./flow.js";

/** A block of `lines` lines of `lineHeight` px (default: one line of `height`). */
const box = (height: number, marginTop = 0, marginBottom = 0, lineHeight = height): BlockBox => ({
  height,
  marginTop,
  marginBottom,
  lines: () =>
    Array.from({ length: Math.round(height / lineHeight) }, (_, i) => (i + 1) * lineHeight),
});
const whole = (page: number): Fragment => ({ page, fromLine: 0, toLine: Infinity });
/** The page of each block that is not split. */
const pagesOf = (result: Fragment[][]) =>
  result.map((fragments) => (fragments.length === 1 ? fragments[0]?.page : fragments));

describe("flow: whole blocks", () => {
  it("keeps blocks that fit on one page", () => {
    expect(pagesOf(flow([box(40), box(40), box(20)], 100))).toEqual([0, 0, 0]);
  });

  it("starts a new page with a one-line block that does not fit", () => {
    expect(pagesOf(flow([box(40), box(40), box(40), box(90), box(10)], 100))).toEqual([
      0, 0, 1, 2, 2,
    ]);
  });

  it("collapses adjacent margins to the larger one and keeps the first top margin", () => {
    // 10 + 30 = 40 | + max(20, 5) + 30 = 90 | + max(20, 10) + 20 = 130 (+ its bottom margin 0)
    const boxes = [box(30, 10, 20), box(30, 5, 20), box(20, 10, 0)];
    expect(pagesOf(flow(boxes, 130))).toEqual([0, 0, 0]);
    // The second block needs 90 + its own bottom margin 20 = 110.
    expect(pagesOf(flow(boxes, 110))).toEqual([0, 0, 1]);
    expect(pagesOf(flow(boxes, 100))).toEqual([0, 1, 1]);
  });

  it("keeps the last block's bottom margin inside the page", () => {
    // 40 | + max(10, 0) + 45 = 95, + its bottom margin 10 = 105 > 100: the page would grow.
    expect(pagesOf(flow([box(40, 0, 10), box(45, 0, 10)], 100))).toEqual([0, 1]);
    expect(pagesOf(flow([box(40, 0, 10), box(45, 0, 5)], 100))).toEqual([0, 0]);
  });

  it("collapses with the previous block's bottom margin, not its own", () => {
    // 20 (bottom margin 5) | + max(5, 0) + 70 = 95, + own bottom margin 0: fits.
    expect(pagesOf(flow([box(20, 0, 5), box(70, 0, 0)], 100))).toEqual([0, 0]);
    // A large own bottom margin does not widen the gap above: 20 + 5 + 70 + 5 = 100.
    expect(pagesOf(flow([box(20, 0, 5), box(70, 0, 5)], 100))).toEqual([0, 0]);
  });

  it("tolerates sub-pixel rounding", () => {
    expect(pagesOf(flow([box(50.2), box(50.2)], 100))).toEqual([0, 0]);
    expect(pagesOf(flow([box(50.4), box(50.4)], 100))).toEqual([0, 1]);
  });

  it("measures lines only for blocks that do not fit", () => {
    let measured = 0;
    const counting = (height: number): BlockBox => ({
      ...box(height),
      lines: () => {
        measured++;
        return [height];
      },
    });
    flow([counting(40), counting(40), counting(40)], 100);
    expect(measured).toBe(1);
  });

  it("handles an empty document", () => {
    expect(flow([], 100)).toEqual([]);
  });
});

describe("flow: split blocks", () => {
  it("splits a block at the last line that fits and continues it on the next page", () => {
    // 30 used; the 10-line block of 10px lines has room for 7 lines.
    expect(flow([box(30), box(100, 0, 0, 10)], 100)).toEqual([
      [whole(0)],
      [
        { page: 0, fromLine: 0, toLine: 7 },
        { page: 1, fromLine: 7, toLine: 10 },
      ],
    ]);
  });

  it("continues a block over as many pages as it takes", () => {
    expect(flow([box(250, 0, 0, 10)], 100)[0]).toEqual([
      { page: 0, fromLine: 0, toLine: 10 },
      { page: 1, fromLine: 10, toLine: 20 },
      { page: 2, fromLine: 20, toLine: 25 },
    ]);
  });

  it("counts the gap above the first fragment, and the bottom margin only after the last line", () => {
    // 20 + max(0, 15) = 35 above; lines of 10: 6 fit (95). The rest: 4 lines + margin 8 = 48.
    const result = flow([box(20), box(100, 15, 8, 10)], 100);
    expect(result[1]).toEqual([
      { page: 0, fromLine: 0, toLine: 6 },
      { page: 1, fromLine: 6, toLine: 10 },
    ]);
    // The next block follows the continuation: 40 + max(8, 0) + 20 = 68.
    expect(pagesOf(flow([box(20), box(100, 15, 8, 10), box(20)], 100))[2]).toBe(1);
  });

  it("moves a block whose first line does not fit to the next page", () => {
    expect(flow([box(95), box(30, 0, 0, 10)], 100)[1]).toEqual([whole(1)]);
  });

  it("places a line taller than a page on a page of its own", () => {
    expect(flow([box(10), box(150)], 100)).toEqual([[whole(0)], [whole(1)]]);
    expect(flow([box(150), box(10)], 100)).toEqual([[whole(0)], [whole(1)]]);
  });

  it("splits the last line off when only the bottom margin does not fit", () => {
    // 20 + 7 lines of 10 = 90, + bottom margin 15 = 105 > 100: the last line moves.
    expect(flow([box(20), box(70, 0, 15, 10)], 100)[1]).toEqual([
      { page: 0, fromLine: 0, toLine: 6 },
      { page: 1, fromLine: 6, toLine: 7 },
    ]);
  });
});

describe("contentHeight", () => {
  it("is the page height minus the vertical margins, in CSS px", () => {
    expect(contentHeight(DEFAULT_SETTINGS)).toBeCloseTo((297 - 2 * 25.4) * PX_PER_MM);
    expect(PX_PER_MM * 25.4).toBeCloseTo(96);
  });
});
