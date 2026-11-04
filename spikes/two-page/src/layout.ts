/** A slice [start, end) of one paragraph placed on one page. */
export interface Fragment {
  para: number;
  start: number;
  end: number;
  /** True when the paragraph continues on the next page. */
  continues: boolean;
}

export interface LayoutInput {
  /** Character offset where each line of each paragraph starts; first entry is always 0. */
  lineStarts: readonly (readonly number[])[];
  lengths: readonly number[];
  lineHeight: number;
  paraGap: number;
  pageHeight: number;
}

/**
 * Page flow: fill pages line by line; a paragraph that does not fit is split at a line boundary.
 * Pure arithmetic over measurements. shortcut: no widow/orphan or keep-with-next rules (Phase 5).
 */
export function paginate({
  lineStarts,
  lengths,
  lineHeight,
  paraGap,
  pageHeight,
}: LayoutInput): Fragment[][] {
  const pages: Fragment[][] = [[]];
  let used = 0;
  const newPage = () => {
    pages.push([]);
    used = 0;
  };
  lineStarts.forEach((starts, para) => {
    const lineCount = Math.max(starts.length, 1);
    let line = 0;
    while (line < lineCount) {
      let fit = Math.floor((pageHeight - used + 0.5) / lineHeight);
      const page = pages[pages.length - 1] as Fragment[];
      if (fit <= 0 && page.length > 0) {
        newPage();
        continue;
      }
      fit = Math.max(fit, 1); // a line taller than an empty page is placed anyway
      const take = Math.min(fit, lineCount - line);
      const endLine = line + take;
      const end = endLine < lineCount ? (starts[endLine] as number) : (lengths[para] as number);
      page.push({ para, start: starts[line] ?? 0, end, continues: endLine < lineCount });
      used += take * lineHeight;
      line = endLine;
      if (line < lineCount) newPage();
    }
    used += paraGap;
  });
  return pages;
}
