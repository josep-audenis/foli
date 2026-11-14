import { describe, expect, it } from "vitest";
import { agreement, bodyRegion, type Ink, inkPixels, overlay, samePage } from "./ink.js";

/** An ink image from rows of "#" (ink) and "." (none). */
function image(...rows: string[]): Ink {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    ink: Uint8Array.from(rows.join(""), (c) => (c === "#" ? 1 : 0)),
  };
}

/**
 * A page of text as ink: `lines` lines `pitch` px apart, each 10 px tall and made of 1 px
 * strokes at places that differ from line to line (as glyphs do), starting at `top`.
 */
function text(lines: number, pitch: number, top: number, width = 400, height = 400): Ink {
  const ink = new Uint8Array(width * height);
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  for (let line = 0; line < lines; line++)
    for (let x = 20; x < width - 20; x++) {
      if (random() > 0.15) continue;
      for (let y = top + line * pitch; y < top + line * pitch + 10; y++)
        if (y >= 0 && y < height) ink[y * width + x] = 1;
    }
  return { width, height, ink };
}

describe("inkPixels", () => {
  it("counts dark pixels as ink, over white", () => {
    const rgba = Uint8ClampedArray.from([
      ...[0, 0, 0, 255], // black
      ...[255, 255, 255, 255], // white
      ...[150, 150, 150, 255], // dark grey: antialiased text
      ...[170, 170, 170, 255], // light grey
      ...[0, 0, 0, 0], // transparent: the white page
      ...[255, 255, 0, 255], // yellow highlight: luminance 237
      ...[0, 0, 255, 255], // blue text: luminance 18
    ]);
    expect(inkPixels(rgba, 7, 1)).toEqual({
      width: 7,
      height: 1,
      ink: Uint8Array.from([1, 0, 1, 0, 0, 0, 1]),
    });
  });
});

describe("agreement", () => {
  it("is 1 for the same ink, and for ink moved within the tolerance (2 px)", () => {
    const word = image("#....", ".....", ".....", ".....");
    expect(agreement(word, word).score).toBe(1);
    const moved = image(".....", ".....", "..#..", ".....");
    expect(agreement(word, moved).score).toBe(1);
    expect(agreement(word, moved, 1).score).toBe(0);
    expect(agreement(word, image(".....", ".....", ".....", "..#..")).score).toBe(0);
    expect(agreement(word, image(".....", ".....", "...#.", ".....")).score).toBe(0);
  });

  it("falls when text is a line off, though lines look alike", () => {
    const word = text(15, 18, 40);
    // A pixel or two of rendering difference: the same.
    expect(agreement(word, text(15, 18, 41)).score).toBe(1);
    expect(agreement(word, text(15, 18, 42)).score).toBe(1);
    // Further down, less agrees: half a line, a whole line (other glyphs in the same place).
    expect(agreement(word, text(15, 18, 43)).score).toBeCloseTo(0.9);
    expect(agreement(word, text(15, 18, 49)).score).toBeLessThan(0.5);
    expect(agreement(word, text(15, 18, 58)).score).toBeLessThan(0.55);
  });

  it("counts ink only one side has: Foli's extra lowers precision, Word's missing recall", () => {
    const word = image("#.......", "........");
    const extra = image("#......#", "........");
    expect(agreement(word, extra)).toEqual({
      word: 1,
      foli: 2,
      precision: 0.5,
      recall: 1,
      score: 2 / 3,
    });
    expect(agreement(extra, word)).toMatchObject({ precision: 1, recall: 0.5 });
  });

  it("agrees on two empty pages", () => {
    const empty = image("...", "...");
    expect(agreement(empty, empty)).toMatchObject({ precision: 1, recall: 1, score: 1 });
  });

  it("compares inside a region, matching with ink just outside it", () => {
    // Ink only Word has on every side of the region (headers, footers, margins) is left out.
    const framed = image(
      "#######",
      "#.....#",
      "#.....#",
      "#..#..#",
      "#.....#",
      "#.....#",
      "#######",
    );
    const centre = image(
      ".......",
      ".......",
      ".......",
      "...#...",
      ".......",
      ".......",
      ".......",
    );
    expect(agreement(framed, centre).score).toBeLessThan(1);
    expect(agreement(framed, centre, 2, [1, 1, 6, 6]).score).toBe(1);
    // Ink inside the region matched by ink outside it, within the tolerance.
    expect(agreement(image("#...", "...."), image("....", "#..."), 2, [0, 1, 4, 2]).score).toBe(1);
  });

  it("refuses images of different sizes", () => {
    expect(() => agreement(image("#."), image("#.."))).toThrow();
    expect(() => agreement(image("#."), image("#.", ".."))).toThrow();
  });
});

describe("samePage", () => {
  it("takes sizes a pixel or two apart as the same page, not another orientation or paper", () => {
    expect(samePage([794, 1123], [794, 1123])).toBe(true);
    expect(samePage([794, 1123], [792, 1125])).toBe(true);
    expect(samePage([794, 1123], [791, 1123])).toBe(false);
    expect(samePage([794, 1123], [794, 1120])).toBe(false);
    // A4 landscape, and US Letter.
    expect(samePage([794, 1123], [1123, 794])).toBe(false);
    expect(samePage([794, 1123], [816, 1056])).toBe(false);
  });
});

describe("bodyRegion", () => {
  it("is the page inside its margins (top, right, bottom, left), to the nearest pixel", () => {
    expect(bodyRegion([96.6, 72.6, 96.6, 72.6], 794, 1123)).toEqual([73, 97, 721, 1026]);
    // Top and left in that order: not swapped.
    expect(bodyRegion([10, 0, 0, 20], 100, 100)).toEqual([20, 10, 100, 100]);
  });
});

describe("overlay", () => {
  it("shows ink in both black, Word's only red, Foli's only blue", () => {
    const rgba = overlay(image("##.."), image("#.#."));
    expect([...rgba]).toEqual([
      ...[0, 0, 0, 255],
      ...[220, 0, 0, 255],
      ...[0, 90, 255, 255],
      ...[255, 255, 255, 255],
    ]);
  });
});
