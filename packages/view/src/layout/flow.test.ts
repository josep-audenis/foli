import { DEFAULT_SETTINGS } from "@folijs/core";
import { describe, expect, it } from "vitest";
import {
  type BlockBox,
  contentHeight,
  type FlowSection,
  type Fragment,
  flow,
  flowFrom,
  PX_PER_MM,
  pagesOf as pageFacts,
} from "./flow.js";

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

describe("flow: Word spacing", () => {
  const WORD = { orphans: 1, widows: 1, spacing: "word" as const };

  it("takes the larger of the space after one block and the space before the next", () => {
    // 10 + 30 | + max(20, 5) + 30 = 90 | + max(20, 10) + 20 = 130
    const boxes = [box(30, 10, 20), box(30, 5, 20), box(20, 10, 0)];
    expect(pagesOf(flow(boxes, 130, WORD))).toEqual([0, 0, 0]);
    expect(pagesOf(flow(boxes, 129, WORD))).toEqual([0, 0, 1]);
  });

  it("lets the space after the last block on a page hang below it", () => {
    expect(pagesOf(flow([box(50, 0, 40), box(50, 0, 0)], 100, WORD))).toEqual([0, 1]);
    expect(pagesOf(flow([box(90, 0, 40)], 100, WORD))).toEqual([0]);
    // CSS needs the bottom margin to fit: the next block goes to the next page.
    expect(pagesOf(flow([box(90, 0, 40), box(10)], 100, ANY))).toEqual([0, 1]);
    expect(pagesOf(flow([box(50, 0, 0), box(10, 0, 40)], 70, ANY))).toEqual([0, 1]);
    expect(pagesOf(flow([box(50, 0, 0), box(10, 0, 40)], 70, WORD))).toEqual([0, 0]);
    // Split: the last line fits without the space after.
    const split = flow([box(40), box(60, 0, 30, 10)], 100, WORD);
    expect(split[1]).toEqual([whole(0)]);
  });

  it("drops the space before at the top of a page the flow moved to, not the first or a forced one", () => {
    // First page: kept (10 + 40 = 50).
    // Second block: 50 + 30 + 60 > 100, moves to page 1, its space before dropped: 60.
    // Third: 60 + 30 + 10 = 100 fits only because the space before was dropped.
    const boxes = [box(40, 10), box(60, 30), box(10, 30)];
    expect(pagesOf(flow(boxes, 100, WORD))).toEqual([0, 1, 1]);
    // After an explicit break the space before stays: 30 + 60 + 30 + 10 = 130 > 100.
    const broken: BlockBox = { ...box(40, 10), breaksAfter: () => [0] };
    expect(pagesOf(flow([broken, box(60, 30), box(10, 30)], 100, WORD))).toEqual([0, 1, 2]);
  });

  it("keeps the space before on the page a split block's explicit break starts", () => {
    // Two lines, a break after the first: the second line starts page 1, a forced page.
    const broken: BlockBox = { ...box(20, 0, 0, 10), breaksAfter: () => [0] };
    // Page 1: 10 (the line), then 30 + 30 + 40 = 80: 90 fits; the space before was kept.
    const result = flow([broken, box(40, 30), box(40, 30)], 100, WORD);
    expect(result[0]).toEqual([
      { page: 0, fromLine: 0, toLine: 1 },
      { page: 1, fromLine: 1, toLine: 2 },
    ]);
    expect(pagesOf(result).slice(1)).toEqual([1, 2]);
  });

  it("matches a full flow when reused", () => {
    const boxes = [box(40, 10, 10), box(60, 30, 10), box(10, 30, 10), box(50, 20, 20)];
    const previous = flowFrom(boxes, 100, WORD);
    const after = [box(45, 10, 10), ...boxes.slice(1)];
    const incremental = flowFrom(after, 100, WORD, {
      previous,
      from: 0,
      previousIndex: (i) => (i >= 1 ? i : -1),
    });
    expect(incremental).toEqual(flowFrom(after, 100, WORD));
  });
});

describe("flow: sections and columns", () => {
  const WORD = { orphans: 1, widows: 1, spacing: "word" as const };
  const section = (over: Partial<FlowSection> = {}, height = 100): FlowSection => ({
    start: "nextPage",
    columns: 1,
    box: () => ({ height }),
    samePage: (other) => other.box({ index: 0, number: 1, first: true }).height === height,
    ...over,
  });
  const inSection = (s: FlowSection, b: BlockBox): BlockBox => ({ ...b, section: s });
  const places = (result: Fragment[][]) =>
    result.map((fragments) =>
      fragments.map((f) => [f.page, f.band ?? 0, f.column ?? 0, f.fromLine]),
    );

  it("fills columns, then the next page", () => {
    const two = section({ columns: 2 });
    const blocks = [60, 60, 60, 60, 60].map((h) => inSection(two, box(h)));
    expect(places(flow(blocks, 100, WORD)).map((p) => p[0]?.slice(0, 3))).toEqual([
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
      [1, 0, 1],
      [2, 0, 0],
    ]);
  });

  it("splits a block across columns and drops its space before at a column's top", () => {
    const two = section({ columns: 2 });
    const result = flow([inSection(two, box(150, 10, 0, 10))], 100, WORD);
    expect(result[0]).toEqual([
      { page: 0, fromLine: 0, toLine: 9 },
      { page: 0, column: 1, fromLine: 9, toLine: 15 },
    ]);
    // The second block flows to the column's top: no space before.
    const moved = flowFrom([inSection(two, box(95)), inSection(two, box(30, 20))], 100, WORD);
    expect(moved.fragments[1]?.[0]?.column).toBe(1);
    expect(moved.gaps).toEqual([0, 0]);
  });

  it("ends a column at a column break, and the page at the last column", () => {
    const two = section({ columns: 2 });
    const broken: BlockBox = {
      ...inSection(two, box(30, 0, 0, 10)),
      columnBreaksAfter: () => [0],
    };
    const result = flow([broken, inSection(two, box(10)), broken], 100, WORD);
    expect(places(result)).toEqual([
      [
        [0, 0, 0, 0],
        [0, 0, 1, 1],
      ],
      [[0, 0, 1, 0]],
      [
        [0, 0, 1, 0],
        [1, 0, 0, 1],
      ],
    ]);
  });

  it("opens a band below a continuous break, with the space between them", () => {
    const one = section();
    const two = section({ start: "continuous", columns: 2 });
    const result = flowFrom(
      [
        inSection(one, box(30, 0, 10)),
        inSection(two, box(20, 4)),
        inSection(two, box(100, 0, 0, 10)),
      ],
      100,
      WORD,
    );
    expect(result.fragments[1]).toEqual([
      { page: 0, band: 1, fromLine: 0, toLine: Infinity, lead: 10 },
    ]);
    // Band top 40: 60 high. Its space before counts from the end of the last band's text.
    expect(result.gaps[1]).toBe(0);
    expect(result.fragments[2]?.map((f) => [f.page, f.band, f.column])).toEqual([
      [0, 1, undefined],
      [0, 1, 1],
    ]);
  });

  it("gives an empty section mark no room, unless it is alone in its column", () => {
    const one = section();
    const next = section();
    const mark = { ...inSection(one, box(20, 5, 10)), sectionMark: true };
    const result = flow([inSection(one, box(90)), mark, inSection(next, box(10))], 100, WORD);
    expect(result[1]).toEqual([{ page: 0, fromLine: 0, toLine: Infinity, mark: true }]);
    expect(result[2]?.[0]?.page).toBe(1);
    expect(flow([mark], 100, WORD)[0]?.[0]?.mark).toBeUndefined();
  });

  it("balances the columns above a continuous section", () => {
    const two = section({ columns: 2, balanced: true });
    const after = section({ start: "continuous" });
    const blocks = [inSection(two, box(120, 0, 0, 10)), inSection(after, box(10))];
    const result = flowFrom(blocks, 100, WORD);
    expect(result.fragments[0]).toEqual([
      { page: 0, fromLine: 0, toLine: 6 },
      { page: 0, column: 1, fromLine: 6, toLine: 12 },
    ]);
    // The next band starts below the tallest column.
    expect(result.fragments[1]?.[0]).toMatchObject({ page: 0, band: 1 });
    expect(result.states[2]?.bandTop).toBe(60);
  });

  it("adds a blank page before an odd or even page section, by the displayed number", () => {
    const one = section();
    const odd = section({ start: "oddPage" });
    const even = section({ start: "evenPage" });
    const blocks = [inSection(one, box(10)), inSection(odd, box(10)), inSection(even, box(10))];
    // Page 1, then 3 (2 is blank), then 4.
    expect(pagesOf(flow(blocks, 100, WORD))).toEqual([0, 2, 3]);
    const restart = section({ start: "oddPage", pageStart: 4 });
    // A restart takes the right kind of number instead (Word adds no page for it).
    expect(pagesOf(flow([blocks[0] as BlockBox, inSection(restart, box(10))], 100, WORD))).toEqual([
      0, 1,
    ]);
  });

  it("starts a page for a continuous section with another page", () => {
    const wide = section({ start: "continuous" }, 50);
    const blocks = [inSection(section(), box(10)), inSection(wide, box(10))];
    expect(pagesOf(flow(blocks, 100, WORD))).toEqual([0, 1]);
  });

  it("measures a block in its column when the widths differ", () => {
    const two = section({ columns: 2 });
    const narrow = { height: 60, lines: () => [20, 40, 60] };
    const wide = { height: 40, lines: () => [20, 40] };
    const block = (): BlockBox => ({
      ...inSection(two, box(20)),
      inColumn: (column) => (column ? narrow : wide),
    });
    const result = flowFrom([inSection(two, box(90)), block(), block()], 100, WORD);
    // The second is in column 1 (narrow, 60); of the third, 40 fit there and the rest moves on.
    expect(result.fragments[1]?.[0]?.column).toBe(1);
    expect(result.fragments[2]?.map((f) => [f.page, f.toLine])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it("adds the two spaces when the document says so", () => {
    const ADD = { ...WORD, addSpacing: true };
    const boxes = [box(30, 10, 20), box(30, 5, 20), box(20, 10, 0)];
    // 10 + 30 | + (20 + 5) + 30 = 95 | + (20 + 10) + 20 = 145
    expect(pagesOf(flow(boxes, 145, ADD))).toEqual([0, 0, 0]);
    expect(pagesOf(flow(boxes, 144, ADD))).toEqual([0, 0, 1]);
    expect(flowFrom(boxes, 145, ADD).gaps).toEqual([10, 25, 30]);
    // The first block of a band: its space before comes on top of the space above the band.
    const one = section();
    const next = section({ start: "continuous" });
    const banded = [inSection(one, box(10, 0, 20)), inSection(next, box(10, 8))];
    expect(flowFrom(banded, 100, ADD).gaps[1]).toBe(8);
    expect(flowFrom(banded, 100, WORD).gaps[1]).toBe(0);
  });

  it("keeps a balanced band's first column in use: a lone line is not left to the last", () => {
    const two = section({ columns: 2, balanced: true });
    const after = section({ start: "continuous" });
    const result = flow([inSection(two, box(10)), inSection(after, box(10))], 100, WORD);
    expect(result[0]).toEqual([{ page: 0, fromLine: 0, toLine: Infinity }]);
  });

  it("gives no lead to a band whose first block moved to the next page", () => {
    const one = section();
    const next = section({ start: "continuous" });
    const blocks = [inSection(one, box(95, 0, 2)), inSection(next, box(20))];
    const [first] = flow(blocks, 100, WORD)[1] as Fragment[];
    expect(first?.page).toBe(1);
    expect(first?.lead).toBeUndefined();
  });

  it("takes breaks at the lines of the column the block is in", () => {
    const two = section({ columns: 2 });
    const wide = { height: 20, lines: () => [10, 20] };
    const narrow = { height: 40, lines: () => [10, 20, 30, 40] };
    const asked: (number | undefined)[] = [];
    const block: BlockBox = {
      ...inSection(two, box(20)),
      inColumn: (column) => (column ? narrow : wide),
      columnBreaksAfter: (column) => {
        asked.push(column);
        return column ? [2] : [];
      },
    };
    const result = flow([inSection(two, box(95)), block], 100, WORD);
    // It starts in column 1 (no room in 0): three lines, then the break ends the column.
    expect(asked).toContain(1);
    expect(result[1]?.map((f) => [f.page, f.column ?? 0, f.toLine])).toEqual([
      [0, 1, 3],
      [1, 0, 2],
    ]);
  });

  it("flows the same incrementally as in full, balanced sections included", () => {
    const random = (seed: number) => () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let seed = 1; seed <= 400; seed++) {
      const next = random(seed);
      const sections = [
        section({ columns: 2, balanced: true }),
        section({ start: "continuous", columns: 3 }),
        section({ start: "oddPage" }),
      ];
      const make = (s: FlowSection): BlockBox => ({
        ...inSection(s, box(10 * (1 + Math.floor(next() * 12)), 4, 6, 10)),
        keepWithNext: next() < 0.2,
      });
      const before = sections.flatMap((s) => Array.from({ length: 4 }, () => make(s)));
      const previous = flowFrom(before, 100, WORD);
      const at = Math.floor(next() * before.length);
      const after = [...before];
      after[at] = make(before[at]?.section as FlowSection);
      const incremental = flowFrom(after, 100, WORD, {
        previous,
        from: at,
        previousIndex: (i) => (i > at ? i : -1),
      });
      const full = flowFrom(after, 100, WORD);
      expect(incremental.fragments, `seed ${seed}`).toEqual(full.fragments);
      expect(incremental.states, `seed ${seed}`).toEqual(full.states);
      expect(incremental.gaps, `seed ${seed}`).toEqual(full.gaps);
    }
  });
});

describe("flow: pages of their own heights (headers and footers)", () => {
  const WORD = { orphans: 1, widows: 1, spacing: "word" as const };
  const section = (index: number, over: Partial<FlowSection> = {}): FlowSection => ({
    index,
    start: "nextPage",
    columns: 1,
    box: () => ({ height: 100 }),
    samePage: () => true,
    ...over,
  });
  const inSection = (s: FlowSection, b: BlockBox): BlockBox => ({ ...b, section: s });

  it("takes each page's height from its number and whether its section starts on it", () => {
    const seen: unknown[] = [];
    const s = section(0, {
      box: (page) => {
        seen.push(page.number);
        return { height: page.first ? 50 : page.number % 2 ? 100 : 80 };
      },
    });
    const blocks = [40, 40, 50, 40, 70, 40].map((h) => inSection(s, box(h)));
    expect(pagesOf(flow(blocks, 0, WORD))).toEqual([0, 1, 2, 2, 3, 4]);
    expect(seen).toContain(4);
  });

  it("gives a page shared by sections the box of the first one on it", () => {
    const first = section(0, { box: () => ({ height: 60 }) });
    const second = section(1, { start: "continuous", box: () => ({ height: 1000 }) });
    const blocks = [inSection(first, box(40)), inSection(second, box(40))];
    // The second section's own box would hold it.
    expect(flow(blocks, 0, WORD).map((f) => f[0]?.page)).toEqual([0, 1]);
  });

  it("numbers even and odd page sections as Word does, restarted or not", () => {
    // Word's PDFs: the page numbers of a first section of 1 or 2 pages and a second of 2, a blank
    // page as null.
    const cases: [FlowSection["start"], number | undefined, number, (number | null)[]][] = [
      ["evenPage", 1, 1, [1, 2, 3]],
      ["evenPage", 1, 2, [1, 2, 2, 3]],
      ["evenPage", 2, 1, [1, 2, 3]],
      ["evenPage", 2, 2, [1, 2, 2, 3]],
      ["evenPage", 3, 1, [1, 4, 5]],
      ["evenPage", 3, 2, [1, 2, 4, 5]],
      ["evenPage", undefined, 1, [1, 2, 3]],
      ["evenPage", undefined, 2, [1, 2, null, 4, 5]],
      ["oddPage", 1, 1, [1, 1, 2]],
      ["oddPage", 1, 2, [1, 2, 1, 2]],
      ["oddPage", 2, 1, [1, 3, 4]],
      ["oddPage", 2, 2, [1, 2, 3, 4]],
      ["oddPage", 3, 1, [1, 3, 4]],
      ["oddPage", 3, 2, [1, 2, 3, 4]],
      ["oddPage", undefined, 1, [1, null, 3, 4]],
      ["oddPage", undefined, 2, [1, 2, 3, 4]],
    ];
    // With even and odd headers (`w:evenAndOddHeaders`) a restart keeps the blank page.
    const evenAndOdd: typeof cases = [
      ["evenPage", 1, 1, [1, 2, 3]],
      ["evenPage", 1, 2, [1, 2, null, 2, 3]],
      ["evenPage", 2, 1, [1, 2, 3]],
      ["evenPage", 2, 2, [1, 2, null, 2, 3]],
      ["evenPage", 3, 1, [1, 4, 5]],
      ["evenPage", 3, 2, [1, 2, null, 4, 5]],
      ["evenPage", undefined, 1, [1, 2, 3]],
      ["evenPage", undefined, 2, [1, 2, null, 4, 5]],
      ["oddPage", 1, 1, [1, null, 1, 2]],
      ["oddPage", 1, 2, [1, 2, 1, 2]],
      ["oddPage", 2, 1, [1, null, 3, 4]],
      ["oddPage", 2, 2, [1, 2, 3, 4]],
      ["oddPage", 3, 1, [1, null, 3, 4]],
      ["oddPage", 3, 2, [1, 2, 3, 4]],
      ["oddPage", undefined, 1, [1, null, 3, 4]],
      ["oddPage", undefined, 2, [1, 2, 3, 4]],
    ];
    const check = (list: typeof cases, rules: typeof WORD & { evenAndOddHeaders?: boolean }) => {
      for (const [start, pageStart, before, numbers] of list) {
        const one = section(0);
        const two = section(1, { start, pageStart });
        const boxes = [
          inSection(one, box(before * 100, 0, 0, 100)),
          inSection(two, box(200, 0, 0, 100)),
        ];
        const pages = pageFacts(boxes, flowFrom(boxes, 0, rules));
        expect(
          pages.map((p) => (p.sectionPages ? p.number : null)),
          `${start} ${pageStart} after ${before}`,
        ).toEqual(numbers);
      }
    };
    check(cases, WORD);
    check(evenAndOdd, { ...WORD, evenAndOddHeaders: true });
  });

  it("says each page's number, section and first page", () => {
    const one = section(0);
    const two = section(1, { pageStart: 7 });
    const even = section(2, { start: "evenPage" });
    const boxes = [
      inSection(one, box(250, 0, 0, 10)),
      inSection(two, box(150, 0, 0, 10)),
      inSection(even, box(10)),
    ];
    const pages = pageFacts(boxes, flowFrom(boxes, 0, WORD));
    expect(pages.map((p) => [p.number, p.section, p.first, p.sectionPages])).toEqual([
      [1, 0, true, 3],
      [2, 0, false, 3],
      [3, 0, false, 3],
      [7, 1, true, 2],
      [8, 1, false, 2],
      // The blank page before the even one: the next page's section, nothing on it.
      [9, 2, false, 0],
      [10, 2, true, 1],
    ]);
  });
});

describe("flow: repeated headers", () => {
  it("adds the repeated height at the top of each continuation", () => {
    const table: BlockBox = { ...box(150, 0, 0, 10), repeat: 20 };
    // Page 0: 10 lines (100). Page 1: 20 + 5 lines = 70.
    expect(flow([table], 100, ANY)[0]).toEqual([
      { page: 0, fromLine: 0, toLine: 10 },
      { page: 1, fromLine: 10, toLine: 15 },
    ]);
    // Without the header, 5 lines and a 40 px block fit page 1; with it, only 5 lines and the
    // header: the block goes to page 2.
    expect(pagesOf(flow([table, box(30)], 100, ANY))[1]).toBe(1);
    expect(pagesOf(flow([table, box(40)], 100, ANY))[1]).toBe(2);
    expect(pagesOf(flow([{ ...table, repeat: 0 }, box(40)], 100, ANY))[1]).toBe(1);
  });

  it("repeats on every page of a long block", () => {
    const table: BlockBox = { ...box(250, 0, 0, 10), repeat: 20 };
    // 10 lines, then 8 per page (20 + 80).
    expect(flow([table], 100, ANY)[0]?.map((f) => f.toLine - f.fromLine)).toEqual([10, 8, 7]);
  });
});
