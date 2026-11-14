/**
 * Page comparison by ink (8.6c): two renderings of a page, Word's (its PDF) and Foli's, reduced
 * to the cells of a coarse grid that hold ink, and compared with a small tolerance, so a few
 * pixels of antialiasing or glyph shape do not count but a line out of place does.
 */

/** Darker than this (luminance, 0-255) is ink: text and rules, not highlights or shading. */
export const INK = 160;

/** A grid of cells over a page; `ink[row * cols + col]` is 1 where the cell holds ink. */
export interface InkGrid {
  cols: number;
  rows: number;
  ink: Uint8Array;
}

/** Which pixels of an RGBA image (white where transparent) are ink. */
export function inkPixels(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) {
    const alpha = (rgba[i * 4 + 3] ?? 0) / 255;
    // Over white, as the page is.
    const over = (c: number) => (rgba[i * 4 + c] ?? 0) * alpha + 255 * (1 - alpha);
    const luminance = 0.2126 * over(0) + 0.7152 * over(1) + 0.0722 * over(2);
    ink[i] = luminance < INK ? 1 : 0;
  }
  return ink;
}

/** The cells (`cell` pixels square) of an ink image that hold any ink. */
export function inkGrid(ink: Uint8Array, width: number, height: number, cell: number): InkGrid {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (ink[y * width + x]) grid[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
  return { cols, rows, ink: grid };
}

/** Cells of a grid, in cell coordinates: `[left, top, right, bottom)`. */
export type Region = readonly [number, number, number, number];

export interface Agreement {
  /** Ink cells in Word's page and in Foli's. */
  word: number;
  foli: number;
  /** Of Foli's ink, the share with Word's ink within the tolerance; 1 when Foli has none. */
  precision: number;
  /** Of Word's ink, the share with Foli's within the tolerance; 1 when Word has none. */
  recall: number;
  /** Their harmonic mean: 1 when the pages agree, 0 when no ink is where the other has it. */
  score: number;
}

/**
 * How well two grids of the same size agree inside `region` (the whole grid by default): ink
 * in one counts as matched when the other has ink within `tolerance` cells of it.
 */
export function agreement(
  word: InkGrid,
  foli: InkGrid,
  tolerance = 1,
  region: Region = [0, 0, word.cols, word.rows],
): Agreement {
  if (word.cols !== foli.cols || word.rows !== foli.rows) throw new Error("grids differ in size");
  const [left, top, right, bottom] = region;
  const near = (grid: InkGrid, col: number, row: number) => {
    for (let r = Math.max(0, row - tolerance); r <= Math.min(grid.rows - 1, row + tolerance); r++)
      for (let c = Math.max(0, col - tolerance); c <= Math.min(grid.cols - 1, col + tolerance); c++)
        if (grid.ink[r * grid.cols + c]) return true;
    return false;
  };
  let inWord = 0;
  let inFoli = 0;
  let wordMatched = 0;
  let foliMatched = 0;
  for (let row = Math.max(0, top); row < Math.min(word.rows, bottom); row++)
    for (let col = Math.max(0, left); col < Math.min(word.cols, right); col++) {
      const i = row * word.cols + col;
      if (word.ink[i]) {
        inWord++;
        if (near(foli, col, row)) wordMatched++;
      }
      if (foli.ink[i]) {
        inFoli++;
        if (near(word, col, row)) foliMatched++;
      }
    }
  const precision = inFoli ? foliMatched / inFoli : 1;
  const recall = inWord ? wordMatched / inWord : 1;
  const score = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { word: inWord, foli: inFoli, precision, recall, score };
}

/**
 * An overlay of two ink images of the same size, as RGBA: black where both have ink, red where
 * only Word has, blue where only Foli has, white elsewhere.
 */
export function overlay(word: Uint8Array, foli: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(word.length * 4);
  for (let i = 0; i < word.length; i++) {
    const [r, g, b] =
      word[i] && foli[i]
        ? [0, 0, 0]
        : word[i]
          ? [220, 0, 0]
          : foli[i]
            ? [0, 90, 255]
            : [255, 255, 255];
    rgba.set([r, g, b, 255], i * 4);
  }
  return rgba;
}
