import { describe, expect, it } from "vitest";
import { adjustAt, adjustHandles } from "./handles.js";

/** A selected shape's adjustment handles (34.4). */
describe("adjustment handles", () => {
  const arrow = { geometry: "rightArrow", width: 1_905_000, height: 952_500 };

  it("puts a preset's handles where its definition says, flipped with it", () => {
    // 200 by 100 px: the head starts at half the short side from the right (adj2 50 000).
    expect(adjustHandles(arrow)).toEqual([
      [0, 25],
      [150, 0],
    ]);
    expect(adjustHandles({ ...arrow, flipH: true })[1]).toEqual([50, 0]);
    expect(adjustHandles({ geometry: "custom", width: 1, height: 1 })).toEqual([]);
    expect(adjustHandles({ geometry: "cloud", width: 1, height: 1 })).toEqual([]);
  });

  it("gives the adjust value that puts the handle at the point, within its bounds", () => {
    expect(adjustAt(arrow, 1, 100, 0).adj2).toBeCloseTo(100_000, -2);
    // Past its bound (the arrow's head no longer than its width): the bound.
    expect(adjustAt(arrow, 1, -50, 0).adj2).toBe(200_000);
    expect(adjustAt(arrow, 0, 0, 40).adj1).toBeCloseTo(20_000, -2);
    expect(adjustAt(arrow, 9, 0, 0)).toEqual({});
  });
});
