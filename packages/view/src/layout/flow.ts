import type { DocumentSettings } from "@foli/core";

/** CSS pixels per millimetre (CSS fixes 1in = 96px = 25.4mm). */
export const PX_PER_MM = 96 / 25.4;

/** A rendered block's border-box height and vertical margins, in CSS px. */
export interface BlockBox {
  height: number;
  marginTop: number;
  marginBottom: number;
  /**
   * The bottom of each line box, from the block's top (the last one is `height`). Only called
   * for a block that does not fit where it is, or has page breaks, since measuring lines is
   * expensive.
   */
  lines(): readonly number[];
  /** Keep on the same page as the start of the next block (headings). */
  keepWithNext?: boolean;
  /** The lines that end with an explicit page break (indices into `lines()`), if any. */
  breaksAfter?(): readonly number[];
}

/** The lines `[fromLine, toLine)` of a block, placed on one page (`toLine` Infinity: to the end). */
export interface Fragment {
  page: number;
  fromLine: number;
  toLine: number;
}

export interface FlowRules {
  /** Fewest lines of a split block left at the bottom of a page. */
  orphans: number;
  /** Fewest lines of a split block carried to the top of the next page. */
  widows: number;
}

export const DEFAULT_RULES: FlowRules = { orphans: 2, widows: 2 };

/** Height of a page's content box (page height minus top and bottom margins), in CSS px. */
export function contentHeight({ pageSize, margins }: DocumentSettings): number {
  return (pageSize.height - margins.top - margins.bottom) * PX_PER_MM;
}

// Half a pixel of slack: measured heights are fractional and rounding must not add a page.
const SLACK = 0.5;

interface State {
  page: number;
  used: number;
  previousMargin: number;
  onPage: number;
  /** An explicit page break ended the previous block: the next one starts a new page. */
  breakPending: boolean;
}

/**
 * Page flow: the fragments of each block, in order. Blocks fill a page in order; a block that
 * does not fit is split at a line boundary, the lines that fit staying on the page, the rest
 * continuing at the top of the next one (as many pages as it takes). A page with room for no
 * line of the next block ends; an empty page always takes at least one line.
 *
 * Rules:
 * - Explicit page breaks: the line holding one ends its page.
 * - Widows and orphans: a split leaves at least `orphans` lines at the bottom of a page and
 *   carries at least `widows` lines to the next; a block too short for both moves whole. Not
 *   applied where only an empty page could hold the lines, nor across an explicit break.
 * - Keep with next: a `keepWithNext` block (and a chain of them) moves to the next page when
 *   the block after it would start there, unless it already starts its page or the move would
 *   not bring them together (then the flow stays as it was).
 *
 * Spacing follows CSS inside a padded page: the first block keeps its top margin, adjacent
 * margins collapse to the larger, and the last block's bottom margin stays inside the page
 * (it does not collapse into the padding), so it must fit too. Fragments are rendered without
 * the margins at their split edges: a continued fragment has no bottom margin, a continuation
 * no top margin.
 *
 * shortcut: positive margins only (negative margins collapse differently).
 */
export function flow(
  boxes: readonly BlockBox[],
  pageHeight: number,
  rules: FlowRules = DEFAULT_RULES,
): Fragment[][] {
  const result: Fragment[][] = [];
  let state: State = { page: 0, used: 0, previousMargin: 0, onPage: 0, breakPending: false };
  const snapshots: State[] = [];
  /** Blocks that start a page because the keep-with-next rule moved them. */
  const breakBefore = new Set<number>();
  const newPage = () => {
    state.page++;
    state.used = 0;
    state.onPage = 0;
  };

  const place = (box: BlockBox, index: number): Fragment[] => {
    if ((state.breakPending || breakBefore.has(index)) && state.onPage) newPage();
    state.breakPending = false;
    const above = state.previousMargin;
    state.previousMargin = box.marginBottom;
    const gap = () => (state.onPage ? Math.max(above, box.marginTop) : box.marginTop);
    const forced = box.breaksAfter?.() ?? [];
    if (
      !forced.length &&
      state.used + gap() + box.height + box.marginBottom <= pageHeight + SLACK
    ) {
      state.used += gap() + box.height;
      state.onPage++;
      return [{ page: state.page, fromLine: 0, toLine: Infinity }];
    }
    const lines = box.lines();
    const count = lines.length;
    const breaks = new Set(forced.filter((line) => line >= 0 && line < count));
    const fragments: Fragment[] = [];
    let line = 0;
    while (line < count) {
      // The lines up to the next explicit break (or the end) can be split freely.
      let segmentEnd = line;
      while (segmentEnd < count && !breaks.has(segmentEnd)) segmentEnd++;
      segmentEnd = Math.min(segmentEnd + 1, count);
      const top = line ? (lines[line - 1] as number) : 0;
      // Only the block's first fragment has the gap above it.
      const spacing = line === 0 ? gap() : 0;
      let end = line;
      while (end < segmentEnd) {
        const bottom = (lines[end] as number) - top + (end + 1 === count ? box.marginBottom : 0);
        if (state.used + spacing + bottom > pageHeight + SLACK) break;
        end++;
      }
      if (end < segmentEnd && end > line) {
        // A natural split: keep `widows` lines for the next page and `orphans` on this one.
        const kept = Math.min(end, segmentEnd - rules.widows);
        if (kept - line >= rules.orphans) end = kept;
        else if (state.onPage) end = line;
      }
      if (end === line) {
        if (state.onPage) {
          newPage();
          continue;
        }
        end = line + 1; // a line taller than a page is placed anyway
      }
      fragments.push({ page: state.page, fromLine: line, toLine: end });
      state.used += spacing + (lines[end - 1] as number) - top;
      state.onPage++;
      line = end;
      const broken = breaks.has(end - 1);
      if (line < count) newPage();
      else if (broken) state.breakPending = true;
    }
    // Moved whole to a later page: not split.
    const [only] = fragments;
    if (fragments.length === 1 && only && !forced.length) only.toLine = Infinity;
    return fragments;
  };

  /** The flow as it was before a keep-with-next move, by the block that triggered it. */
  const attempts = new Map<
    number,
    { first: number; result: Fragment[][]; snapshots: State[]; state: State }
  >();
  let index = 0;
  while (index < boxes.length) {
    snapshots[index] = { ...state };
    const fragments = place(boxes[index] as BlockBox, index);
    result[index] = fragments;
    const previous = result[index - 1];
    const startsLater =
      previous !== undefined &&
      (fragments[0]?.page ?? 0) > (previous[previous.length - 1]?.page ?? 0);
    const attempt = attempts.get(index);
    if (attempt) {
      attempts.delete(index);
      // The move did not bring them together (the block does not fit after the heading on a
      // page of its own either): keep the flow as it was.
      if (startsLater) {
        result.splice(attempt.first, result.length - attempt.first, ...attempt.result);
        snapshots.splice(attempt.first, snapshots.length - attempt.first, ...attempt.snapshots);
        state = attempt.state;
        index++;
        continue;
      }
    }
    if (startsLater && boxes[index - 1]?.keepWithNext) {
      // The chain of keep-with-next blocks before this one, each whole on one page.
      let first = index - 1;
      while (
        first > 0 &&
        boxes[first - 1]?.keepWithNext &&
        result[first - 1]?.length === 1 &&
        result[first - 1]?.[0]?.page === result[first]?.[0]?.page
      )
        first--;
      const before = snapshots[first] as State;
      if (!breakBefore.has(first) && before.onPage > 0 && result[first]?.length === 1) {
        attempts.set(index, {
          first,
          result: result.slice(first),
          snapshots: snapshots.slice(first),
          state: { ...state },
        });
        breakBefore.add(first);
        state = { ...before };
        result.length = first;
        index = first;
        continue;
      }
    }
    index++;
  }
  return result;
}
