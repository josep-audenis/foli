/**
 * Page comparison by ink (8.6c): two renderings of a page, Word's (its PDF) and Foli's, reduced
 * to the pixels that hold ink and compared pixel by pixel with a small tolerance, so a pixel of
 * antialiasing or hinting does not count but a line out of place does: the glyphs of another
 * line, or of other words, rarely fall within two pixels of these.
 */

/** Darker than this (luminance, 0-255) is ink: text and rules, not highlights or shading. */
export const INK = 160;

/** Ink matches when the other page has ink this many pixels away or nearer (each axis). */
export const TOLERANCE = 2;

/** An ink image: `ink[y * width + x]` is 1 where the pixel is ink. */
export interface Ink {
  width: number;
  height: number;
  ink: Uint8Array;
}

/** Which pixels of an RGBA image (white where transparent) are ink. */
export function inkPixels(rgba: Uint8ClampedArray, width: number, height: number): Ink {
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) {
    const alpha = (rgba[i * 4 + 3] ?? 0) / 255;
    // Over white, as the page is.
    const over = (c: number) => (rgba[i * 4 + c] ?? 0) * alpha + 255 * (1 - alpha);
    const luminance = 0.2126 * over(0) + 0.7152 * over(1) + 0.0722 * over(2);
    ink[i] = luminance < INK ? 1 : 0;
  }
  return { width, height, ink };
}

/** Pixels of an image: `[left, top, right, bottom)`. */
export type Region = readonly [number, number, number, number];

/**
 * Whether two page sizes (`[width, height]`, pixels) are the same page: equal but for a pixel
 * or two of rounding (A4 is 793.7 px wide). A page in the other orientation, or of another
 * paper size, is not compared.
 */
export function samePage(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2;
}

/** The region inside a page's margins (`[top, right, bottom, left]`, pixels). */
export function bodyRegion(
  margins: readonly [number, number, number, number],
  width: number,
  height: number,
): Region {
  const [top, right, bottom, left] = margins;
  return [
    Math.round(left),
    Math.round(top),
    width - Math.round(right),
    height - Math.round(bottom),
  ];
}

export interface Agreement {
  /** Ink pixels in Word's page and in Foli's. */
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
 * How well two ink images of the same size agree inside `region` (the whole image by default):
 * ink in one counts as matched when the other has ink within `tolerance` pixels of it.
 */
export function agreement(
  word: Ink,
  foli: Ink,
  tolerance = TOLERANCE,
  region: Region = [0, 0, word.width, word.height],
): Agreement {
  if (word.width !== foli.width || word.height !== foli.height)
    throw new Error("images differ in size");
  const { width, height } = word;
  const [left, top, right, bottom] = region;
  const near = (image: Ink, x: number, y: number) => {
    for (let r = Math.max(0, y - tolerance); r <= Math.min(height - 1, y + tolerance); r++)
      for (let c = Math.max(0, x - tolerance); c <= Math.min(width - 1, x + tolerance); c++)
        if (image.ink[r * width + c]) return true;
    return false;
  };
  let inWord = 0;
  let inFoli = 0;
  let wordMatched = 0;
  let foliMatched = 0;
  for (let y = Math.max(0, top); y < Math.min(height, bottom); y++)
    for (let x = Math.max(0, left); x < Math.min(width, right); x++) {
      const i = y * width + x;
      if (word.ink[i]) {
        inWord++;
        if (near(foli, x, y)) wordMatched++;
      }
      if (foli.ink[i]) {
        inFoli++;
        if (near(word, x, y)) foliMatched++;
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
export function overlay(word: Ink, foli: Ink): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(word.ink.length * 4);
  for (let i = 0; i < word.ink.length; i++) {
    const [r, g, b] =
      word.ink[i] && foli.ink[i]
        ? [0, 0, 0]
        : word.ink[i]
          ? [220, 0, 0]
          : foli.ink[i]
            ? [0, 90, 255]
            : [255, 255, 255];
    rgba.set([r, g, b, 255], i * 4);
  }
  return rgba;
}
