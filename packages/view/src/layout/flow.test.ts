import { DEFAULT_SETTINGS } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { type BlockBox, contentHeight, type Fragment, flow, flowFrom, PX_PER_MM } from "./flow.js";

/** No widow/orphan rules: pure geometry. */
const ANY = { orphans: 1, widows: 1 };

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
    expect(flow([box(30), box(100, 0, 0, 10)], 100, ANY)).toEqual([
      [whole(0)],
      [
        { page: 0, fromLine: 0, toLine: 7 },
        { page: 1, fromLine: 7, toLine: 10 },
      ],
    ]);
  });

  it("continues a block over as many pages as it takes", () => {
    expect(flow([box(250, 0, 0, 10)], 100, ANY)[0]).toEqual([
      { page: 0, fromLine: 0, toLine: 10 },
      { page: 1, fromLine: 10, toLine: 20 },
      { page: 2, fromLine: 20, toLine: 25 },
    ]);
  });

  it("counts the gap above the first fragment, and the bottom margin only after the last line", () => {
    // 20 + max(0, 15) = 35 above; lines of 10: 6 fit (95). The rest: 4 lines + margin 8 = 48.
    const result = flow([box(20), box(100, 15, 8, 10)], 100, ANY);
    expect(result[1]).toEqual([
      { page: 0, fromLine: 0, toLine: 6 },
      { page: 1, fromLine: 6, toLine: 10 },
    ]);
    // The next block follows the continuation: 40 + max(8, 0) + 20 = 68.
    expect(pagesOf(flow([box(20), box(100, 15, 8, 10), box(20)], 100, ANY))[2]).toBe(1);
  });

  it("moves a block whose first line does not fit to the next page", () => {
    expect(flow([box(95), box(30, 0, 0, 10)], 100, ANY)[1]).toEqual([whole(1)]);
  });

  it("places a line taller than a page on a page of its own", () => {
    expect(flow([box(10), box(150)], 100, ANY)).toEqual([[whole(0)], [whole(1)]]);
    expect(flow([box(150), box(10)], 100, ANY)).toEqual([[whole(0)], [whole(1)]]);
  });

  it("splits the last line off when only the bottom margin does not fit", () => {
    // 20 + 7 lines of 10 = 90, + bottom margin 15 = 105 > 100: the last line moves.
    expect(flow([box(20), box(70, 0, 15, 10)], 100, ANY)[1]).toEqual([
      { page: 0, fromLine: 0, toLine: 6 },
      { page: 1, fromLine: 6, toLine: 7 },
    ]);
  });
});

describe("flow: widows and orphans (2 lines each by default)", () => {
  it("carries at least two lines to the next page", () => {
    // 7 of 8 lines would fit: one would be a widow, so 6 stay.
    expect(flow([box(30), box(80, 0, 0, 10)], 100)[1]).toEqual([
      { page: 0, fromLine: 0, toLine: 6 },
      { page: 1, fromLine: 6, toLine: 8 },
    ]);
  });

  it("leaves at least two lines at the bottom of a page, else moves the block", () => {
    // Only 1 line fits: an orphan, so the block starts the next page.
    expect(flow([box(85), box(50, 0, 0, 10)], 100)[1]).toEqual([whole(1)]);
    // 2 fit: kept.
    expect(flow([box(75), box(50, 0, 0, 10)], 100)[1]).toEqual([
      { page: 0, fromLine: 0, toLine: 2 },
      { page: 1, fromLine: 2, toLine: 5 },
    ]);
  });

  it("moves a three-line block whole when both rules cannot hold", () => {
    // 2 fit, which would leave one widow; 1 would be an orphan.
    expect(flow([box(75), box(30, 0, 0, 10)], 100)[1]).toEqual([whole(1)]);
  });

  it("applies on an empty page too, as long as both counts hold", () => {
    // 11 lines on a page of 10: 9 stay so that 2 go on.
    expect(flow([box(110, 0, 0, 10)], 100)[0]).toEqual([
      { page: 0, fromLine: 0, toLine: 9 },
      { page: 1, fromLine: 9, toLine: 11 },
    ]);
  });

  it("gives way on an empty page, where nothing else could hold the lines", () => {
    // Lines of 40 on a page of 100: 2 fit and 1 goes on; keeping 2 for the next page would
    // leave a single line, and moving the block would not help.
    expect(flow([box(120, 0, 0, 40)], 100)[0]).toEqual([
      { page: 0, fromLine: 0, toLine: 2 },
      { page: 1, fromLine: 2, toLine: 3 },
    ]);
  });

  it("takes custom counts", () => {
    expect(flow([box(30), box(80, 0, 0, 10)], 100, { orphans: 3, widows: 3 })[1]).toEqual([
      { page: 0, fromLine: 0, toLine: 5 },
      { page: 1, fromLine: 5, toLine: 8 },
    ]);
  });
});

describe("flow: explicit page breaks", () => {
  const breaking = (height: number, lineHeight: number, after: number[]): BlockBox => ({
    ...box(height, 0, 0, lineHeight),
    breaksAfter: () => after,
  });

  it("ends the page after the line holding a break, even with room left", () => {
    expect(flow([breaking(40, 10, [1])], 100)[0]).toEqual([
      { page: 0, fromLine: 0, toLine: 2 },
      { page: 1, fromLine: 2, toLine: 4 },
    ]);
  });

  it("starts the next block on a new page after a break on the block's last line", () => {
    const result = flow([breaking(20, 10, [1]), box(10)], 100);
    expect(result[0]).toEqual([{ page: 0, fromLine: 0, toLine: 2 }]);
    expect(result[1]).toEqual([whole(1)]);
  });

  it("does not apply widow or orphan rules across a break", () => {
    // One line, then a break: that single line stays alone on page 0.
    expect(flow([box(50), breaking(30, 10, [0])], 100)[1]).toEqual([
      { page: 0, fromLine: 0, toLine: 1 },
      { page: 1, fromLine: 1, toLine: 3 },
    ]);
  });

  it("handles several breaks and natural splits between them", () => {
    // Lines 0-17, breaks after 2 and 15; a page holds 10 lines. Lines 3-15 split naturally.
    const parts = flow([breaking(180, 10, [2, 15])], 100)[0];
    expect(parts).toEqual([
      { page: 0, fromLine: 0, toLine: 3 },
      { page: 1, fromLine: 3, toLine: 13 },
      { page: 2, fromLine: 13, toLine: 16 },
      { page: 3, fromLine: 16, toLine: 18 },
    ]);
  });
});

describe("flow: keep with next", () => {
  const heading = (height: number): BlockBox => ({ ...box(height), keepWithNext: true });

  it("moves a heading to the next page with the block after it", () => {
    // The heading fits on page 0 but the one-line paragraph after it does not.
    expect(pagesOf(flow([box(70), heading(20), box(20)], 100))).toEqual([0, 1, 1]);
  });

  it("moves a chain of headings together", () => {
    expect(pagesOf(flow([box(50), heading(20), heading(20), box(20)], 100))).toEqual([0, 1, 1, 1]);
  });

  it("keeps a heading with the first lines of a split block", () => {
    // After the heading 2 lines of the paragraph fit: the heading stays, the block splits.
    const result = flow([box(50), heading(20), box(60, 0, 0, 10)], 100);
    expect(result[1]).toEqual([whole(0)]);
    expect(result[2]?.[0]).toEqual({ page: 0, fromLine: 0, toLine: 3 });
  });

  it("does not move a heading when the next block would not fit after it anyway", () => {
    // One unsplittable line of 90 after a heading of 20 does not fit any page of 100.
    expect(pagesOf(flow([box(50), heading(20), box(90)], 100))).toEqual([0, 0, 1]);
    // And the flow after that is the original one.
    expect(pagesOf(flow([box(50), heading(20), box(90), heading(20), box(20)], 100))).toEqual([
      0, 0, 1, 2, 2,
    ]);
  });

  it("leaves a heading that starts its page alone", () => {
    // Heading at the top of page 1 and a block taller than the rest: nothing to gain.
    expect(pagesOf(flow([box(100), heading(20), box(90)], 100))).toEqual([0, 1, 2]);
  });
});

describe("contentHeight", () => {
  it("is the page height minus the vertical margins, in CSS px", () => {
    expect(contentHeight(DEFAULT_SETTINGS)).toBeCloseTo((297 - 2 * 25.4) * PX_PER_MM);
    expect(PX_PER_MM * 25.4).toBeCloseTo(96);
  });
});

describe("flowFrom: incremental flow equals a full flow", () => {
  /** A small deterministic random generator (mulberry32), so failures reproduce. */
  function random(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randomBox(next: () => number): BlockBox {
    const lineHeight = [10, 12, 20][Math.floor(next() * 3)] as number;
    const lines = 1 + Math.floor(next() * (next() < 0.5 ? 3 : 12));
    const marginTop = Math.floor(next() * 3) * 4;
    const marginBottom = Math.floor(next() * 3) * 4;
    const breaks = next() < 0.1 ? [Math.floor(next() * lines)] : [];
    return {
      ...box(lines * lineHeight, marginTop, marginBottom, lineHeight),
      keepWithNext: next() < 0.35,
      breaksAfter: () => breaks,
    };
  }

  it("for random documents and random edits (insert, delete, replace)", { timeout: 30_000 }, () => {
    for (let seed = 1; seed <= 5000; seed++) {
      const next = random(seed);
      const before = Array.from({ length: Math.floor(next() * 40) }, () => randomBox(next));
      const previous = flowFrom(before, 100);
      // Replace `removed` boxes at `at` (up to the end: an append) with `added` new ones.
      const at = Math.floor(next() * (before.length + 1));
      const mode = next();
      // Some edits delete everything after `at`.
      const removed =
        mode < 0.1 ? before.length - at : Math.min(Math.floor(next() * 3), before.length - at);
      // Some edits keep the same box with keep-with-next toggled (a heading turned into a
      // paragraph): the state after it stays equal to the previous one.
      const old = before[at];
      const added =
        mode > 0.8 && old && removed === 1
          ? [{ ...old, keepWithNext: !old.keepWithNext }]
          : Array.from({ length: Math.floor(next() * 3) }, () => randomBox(next));
      const after = [...before.slice(0, at), ...added, ...before.slice(at + removed)];
      const tail = before.length - at - removed;
      const delta = after.length - before.length;
      const incremental = flowFrom(after, 100, undefined, {
        previous,
        from: at,
        previousIndex: (i) => (i >= after.length - tail ? i - delta : -1),
      });
      const full = flowFrom(after, 100);
      expect(incremental.fragments, `seed ${seed}`).toEqual(full.fragments);
      expect(incremental.states, `seed ${seed}`).toEqual(full.states);
    }
  });

  it("does not reuse a keep-with-next decision about a block the edit changed", () => {
    // Before: H+P (keep-with-next) cannot join Q on a page, so the move is reverted and P
    // stays on page 0. After H becomes a paragraph, only P moves: P+Q fit on page 1.
    const kwn = (height: number): BlockBox => ({ ...box(height), keepWithNext: true });
    const before = [box(50), kwn(20), kwn(20), box(70)];
    const previous = flowFrom(before, 100);
    const after = [before[0] as BlockBox, box(20), ...before.slice(2)];
    const incremental = flowFrom(after, 100, undefined, {
      previous,
      from: 1,
      previousIndex: (i) => (i === 1 ? -1 : i),
    });
    expect(incremental).toEqual(flowFrom(after, 100));
    expect(incremental.fragments[2]?.[0]?.page).toBe(1);
  });

  it("stops early once realigned: unchanged boxes after the edit are not measured", () => {
    let measured = 0;
    const tall = (): BlockBox => ({
      ...box(60, 0, 0, 10),
      lines: () => {
        measured++;
        return [10, 20, 30, 40, 50, 60];
      },
    });
    // Every block fills more than half a page: each one after the first splits, so a full
    // flow measures the lines of almost all of them.
    const blocks = Array.from({ length: 50 }, tall);
    const previous = flowFrom(blocks, 100);
    measured = 0;
    // Replace block 0 by an identical one: the state before block 1 is the same as before.
    const after = [tall(), ...blocks.slice(1)];
    flowFrom(after, 100, undefined, { previous, from: 0, previousIndex: (i) => (i >= 1 ? i : -1) });
    expect(measured).toBeLessThanOrEqual(1);
  });
});
