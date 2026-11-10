/**
 * Word's units, as schema v3 stores them, and conversions for the API and the view.
 * twip: 1/20 point, 1/1440 inch (page geometry, indentation, spacing, tab stops);
 * half-point: font sizes; eighth of a point: border widths.
 */

export const TWIPS_PER_INCH = 1440;
export const TWIPS_PER_POINT = 20;

/** Millimetres to whole twips (rounding: under 0.02 mm). */
export function mmToTwips(mm: number): number {
  return Math.round((mm * TWIPS_PER_INCH) / 25.4);
}

export function twipsToMm(twips: number): number {
  return (twips * 25.4) / TWIPS_PER_INCH;
}

export function twipsToPt(twips: number): number {
  return twips / TWIPS_PER_POINT;
}

export function ptToTwips(pt: number): number {
  return Math.round(pt * TWIPS_PER_POINT);
}

/** CSS pixels (96 per inch). */
export function twipsToPx(twips: number): number {
  return (twips * 96) / TWIPS_PER_INCH;
}

export function halfPointsToPt(halfPoints: number): number {
  return halfPoints / 2;
}
