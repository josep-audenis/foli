import { describe, expect, it } from "vitest";
import { shade, shadesOf } from "./palette.js";

describe("Word's color grid", () => {
  it("lightens and darkens by luminance, as Word's theme shades", () => {
    // Office 2013's Accent 1 (#4472c4) and the shades Word lists under it.
    expect(shade("#4472c4", 80)).toBe("#dae3f3");
    expect(shade("#4472c4", 40)).toBe("#8faadc");
    expect(shade("#4472c4", -25)).toBe("#2f5597");
    expect(shade("#000000", 50)).toBe("#808080");
    expect(shade("#ffffff", -5)).toBe("#f2f2f2");
  });

  it("picks the shades by how light the color is", () => {
    expect(shadesOf("#000000")).toEqual([50, 35, 25, 15, 5]);
    expect(shadesOf("#ffffff")).toEqual([-5, -15, -25, -35, -50]);
    expect(shadesOf("#0e2841")).toEqual([90, 75, 50, 25, 10]);
    expect(shadesOf("#e8e8e8")).toEqual([-10, -25, -50, -75, -90]);
    expect(shadesOf("#4472c4")).toEqual([80, 60, 40, -25, -50]);
  });
});
