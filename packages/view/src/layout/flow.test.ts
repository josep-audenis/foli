import { DEFAULT_SETTINGS } from "@foli/core";
import { describe, expect, it } from "vitest";
import { contentHeight, flowBlocks, PX_PER_MM } from "./flow.js";

const box = (height: number, marginTop = 0, marginBottom = 0) => ({
  height,
  marginTop,
  marginBottom,
});

describe("flowBlocks", () => {
  it("keeps blocks that fit on one page", () => {
    expect(flowBlocks([box(40), box(40), box(20)], 100)).toEqual([0, 0, 0]);
  });

  it("starts a new page with the block that does not fit", () => {
    expect(flowBlocks([box(40), box(40), box(40), box(90), box(10)], 100)).toEqual([0, 0, 1, 2, 2]);
  });

  it("collapses adjacent margins to the larger one and keeps the first top margin", () => {
    // 10 + 30 = 40 | + max(20, 5) + 30 = 90 | + max(20, 10) + 20 = 130
    const boxes = [box(30, 10, 20), box(30, 5, 20), box(20, 10, 0)];
    expect(flowBlocks(boxes, 100)).toEqual([0, 0, 1]);
    expect(flowBlocks(boxes, 130)).toEqual([0, 0, 0]);
  });

  it("gives a block taller than a page its own page", () => {
    expect(flowBlocks([box(10), box(250), box(10)], 100)).toEqual([0, 1, 2]);
    expect(flowBlocks([box(250)], 100)).toEqual([0]);
  });

  it("tolerates sub-pixel rounding", () => {
    expect(flowBlocks([box(50.2), box(50.2)], 100)).toEqual([0, 0]);
    expect(flowBlocks([box(50.4), box(50.4)], 100)).toEqual([0, 1]);
  });

  it("handles an empty document", () => {
    expect(flowBlocks([], 100)).toEqual([]);
  });
});

describe("contentHeight", () => {
  it("is the page height minus the vertical margins, in CSS px", () => {
    expect(contentHeight(DEFAULT_SETTINGS)).toBeCloseTo((297 - 2 * 25.4) * PX_PER_MM);
    expect(PX_PER_MM * 25.4).toBeCloseTo(96);
  });
});
