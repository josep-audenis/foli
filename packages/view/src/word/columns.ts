/**
 * A band of columns on a page (11.6, ADR-0007): one per section on the page, for both renderers.
 */
import { type SectionJSON, sectionColumns } from "@folijs/core";
import { PX_PER_TWIP } from "./blocks.js";

export const BAND_CLASS = "foli-band";
export const COLUMN_CLASS = "foli-column";

/** A section's columns in CSS px. */
export interface ColumnsPx {
  widths: number[];
  gaps: number[];
  separator: boolean;
}

export function columnsPx(section: SectionJSON): ColumnsPx {
  const { widths, gaps, separator } = sectionColumns(section);
  return {
    widths: widths.map((width) => width * PX_PER_TWIP),
    gaps: gaps.map((gap) => gap * PX_PER_TWIP),
    separator,
  };
}

/** What identifies a band's look: the same key, the same elements can stay. */
export const columnsKey = ({ widths, gaps, separator }: ColumnsPx) =>
  `${widths.join(" ")}|${gaps.join(" ")}|${separator}`;

/** Gives `band` and its `columns` their widths, spaces and the lines between them. */
export function styleBand(band: HTMLElement, columns: readonly HTMLElement[], c: ColumnsPx): void {
  band.className = BAND_CLASS;
  band.style.display = "flex";
  // The lines are backgrounds, as tall as the tallest column: printed like text.
  if (c.separator && c.gaps.length) {
    let x = 0;
    const at = c.gaps.map((gap, i) => {
      x += (c.widths[i] as number) + gap;
      return x - gap / 2;
    });
    band.style.backgroundImage = at.map(() => "linear-gradient(#000,#000)").join(",");
    band.style.backgroundRepeat = "no-repeat";
    band.style.backgroundSize = at.map(() => "1px 100%").join(",");
    band.style.backgroundPosition = at.map((p) => `${p - 0.5}px 0`).join(",");
    band.style.printColorAdjust = "exact";
  }
  columns.forEach((column, i) => {
    column.className = COLUMN_CLASS;
    column.style.flex = "none";
    column.style.display = "flow-root";
    column.style.width = `${c.widths[i]}px`;
    column.style.marginRight = `${c.gaps[i] ?? 0}px`;
  });
}

/** A new band of `c`'s columns. */
export function bandElement(
  doc: Document,
  c: ColumnsPx,
): { band: HTMLElement; columns: HTMLElement[] } {
  const band = doc.createElement("div");
  const columns = c.widths.map(() => doc.createElement("div"));
  styleBand(band, columns, c);
  band.append(...columns);
  return { band, columns };
}
