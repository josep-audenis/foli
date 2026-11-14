import { describe, expect, it } from "vitest";
import { agreement, type InkGrid, inkGrid, inkPixels, overlay } from "./ink.js";

/** A grid from rows of "#" (ink) and "." (none). */
function grid(...rows: string[]): InkGrid {
  const cols = rows[0]?.length ?? 0;
  return {
    cols,
    rows: rows.length,
    ink: Uint8Array.from(rows.join(""), (c) => (c === "#" ? 1 : 0)),
  };
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
    expect([...inkPixels(rgba, 7, 1)]).toEqual([1, 0, 1, 0, 0, 0, 1]);
  });
});

describe("inkGrid", () => {
  it("marks the cells holding ink; a partial cell at the edge counts", () => {
    const ink = new Uint8Array(9 * 5);
    ink[0 * 9 + 5] = 1; // (5, 0): cell (1, 0)
    ink[4 * 9 + 8] = 1; // (8, 4): cell (2, 1)
    expect(inkGrid(ink, 9, 5, 4)).toEqual({
      cols: 3,
      rows: 2,
      ink: Uint8Array.from([0, 1, 0, 0, 0, 1]),
    });
    expect(inkGrid(new Uint8Array(16), 2, 8, 4)).toMatchObject({ cols: 1, rows: 2 });
  });
});

describe("agreement", () => {
  it("is 1 for the same ink, and for ink a cell away within the tolerance", () => {
    const word = grid("#....", ".....", "..#..");
    expect(agreement(word, word).score).toBe(1);
    const moved = grid(".#...", ".....", "...#.");
    expect(agreement(word, moved).score).toBe(1);
    expect(agreement(word, moved, 0).score).toBe(0);
    // Up and down too.
    expect(agreement(grid("#..", "..."), grid("...", "#..")).score).toBe(1);
  });

  it("is 0 for ink out of place: a line two cells lower", () => {
    const word = grid("###", "...", "...");
    const lower = grid("...", "...", "###");
    expect(agreement(word, lower)).toMatchObject({ precision: 0, recall: 0, score: 0 });
  });

  it("counts ink only one side has: Foli's extra lowers precision, Word's missing recall", () => {
    const word = grid("#.....", "......");
    const extra = grid("#....#", "......");
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
    const empty = grid("...", "...");
    expect(agreement(empty, empty)).toMatchObject({ precision: 1, recall: 1, score: 1 });
  });

  it("compares inside a region, matching with ink just outside it", () => {
    // A header only Word has (row 0), and body ink that matches.
    const word = grid("####", "....", ".#..", "....");
    const foli = grid("....", "....", "..#.", "....");
    expect(agreement(word, foli).recall).toBe(0.2);
    expect(agreement(word, foli, 1, [0, 2, 4, 4]).score).toBe(1);
    // Ink inside the region matched by ink outside it, within the tolerance.
    expect(agreement(grid("#...", "...."), grid("....", "#..."), 1, [0, 1, 4, 2]).score).toBe(1);
    // Ink only Word has on every side of the region (headers, footers, margins) is left out.
    const framed = grid("#####", "#...#", "#.#.#", "#...#", "#####");
    const centre = grid(".....", ".....", "..#..", ".....", ".....");
    expect(agreement(framed, centre).score).toBeLessThan(1);
    expect(agreement(framed, centre, 1, [1, 1, 4, 4]).score).toBe(1);
  });

  it("refuses grids of different sizes", () => {
    expect(() => agreement(grid("#."), grid("#.."))).toThrow();
    expect(() => agreement(grid("#."), grid("#.", ".."))).toThrow();
  });
});

describe("overlay", () => {
  it("shows ink in both black, Word's only red, Foli's only blue", () => {
    const rgba = overlay(Uint8Array.from([1, 1, 0, 0]), Uint8Array.from([1, 0, 1, 0]));
    expect([...rgba]).toEqual([
      ...[0, 0, 0, 255],
      ...[220, 0, 0, 255],
      ...[0, 90, 255, 255],
      ...[255, 255, 255, 255],
    ]);
  });
});
