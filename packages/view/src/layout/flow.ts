import type { DocumentSettings } from "@folijs/core";

/**
 * CSS pixels per millimetre (CSS fixes 1in = 96px = 25.4mm).
 * @internal
 */
export const PX_PER_MM = 96 / 25.4;

/**
 * A rendered block's border-box height and vertical margins, in CSS px.
 * @internal
 */
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
  breaksAfter?(column?: number): readonly number[];
  /** Height shown again at the top of each fragment after the first (a table's header rows). */
  repeat?: number;
  /** Splits at any of its line ends, without widow and orphan control (a table's rows). */
  anyLine?: boolean;
  /**
   * The lines that end with an explicit column break, if any: indices into the lines of column
   * `column` (`inColumn`), as for `breaksAfter`.
   */
  columnBreaksAfter?(column?: number): readonly number[];
  /**
   * Content height of the pages this block goes on, when not the flow's. A block with another
   * page height than the one before it must start a page (an explicit break before it).
   * `section`, when given, says it instead.
   */
  pageHeight?: number;
  /** The section it is in: its blocks are consecutive and share this object. */
  section?: FlowSection;
  /**
   * An empty paragraph that only holds a section's break: Word gives it no room after text
   * (not its line, not its spacing). Alone at the top of a column it is an ordinary line.
   */
  sectionMark?: boolean;
  /** Its height and lines in column `column` of its section, when the columns' widths differ. */
  inColumn?: ((column: number) => Pick<BlockBox, "height" | "lines">) | undefined;
  /** The footnotes referred to, with the line (of `column`'s lines) holding each reference. */
  notes?: ((column: number) => readonly { line: number; note: FlowNote }[]) | undefined;
  /** What follows this block in the text: the endnotes ending its section or the document. */
  endnotes?: readonly FlowNote[] | undefined;
}

/**
 * A note, or a separator, as the flow sees it: lines, split between pages like a block's.
 * @internal
 */
export interface FlowNote {
  /** Its story. */
  id: string;
  /** The bottom of each of its lines from its top, in column `column`'s width. */
  lines(column: number): readonly number[];
}

/**
 * Lines `[fromLine, toLine)` of a note on a page, at the foot or (`end`) after the text.
 * @internal
 */
export interface NotePiece {
  id: string;
  page: number;
  band?: number;
  column?: number;
  fromLine: number;
  toLine: number;
  /** An endnote, in the text's flow: the space above it when it starts there. */
  end?: boolean;
  lead?: number;
  /** On a page after the last block's, for what was still to come. */
  tail?: boolean;
}

/**
 * What a page's layout depends on: first page, odd or even, by displayed number.
 * @internal
 */
export interface FlowPage {
  /** The page's place in the document, from 0. */
  index: number;
  /** Its displayed number (`w:pgNumType` restarts count). */
  number: number;
  /** Whether its section starts on it. */
  first: boolean;
}

/**
 * A page as flowed: what decides its header and footer (its first section's).
 * @internal
 */
export interface PageFacts extends FlowPage {
  /** The first section on it, by its `index` (a page nothing is on: the next page's). */
  section: number;
  /** How many pages that section has text on; 0 for a page nothing is on. */
  sectionPages: number;
}

/**
 * A section as the flow sees it.
 * @internal
 */
export interface FlowSection {
  /** Its place among the document's sections, from 0. */
  index?: number;
  /** How it starts (Word's `w:type`). */
  start: "nextPage" | "continuous" | "evenPage" | "oddPage" | "nextColumn";
  columns: number;
  /** A continuous section follows: its columns end level on its last page. */
  balanced?: boolean;
  /** The displayed number of its first page, when it restarts them. */
  pageStart?: number | undefined;
  /**
   * The content box of a page that starts with this section. A section continuing on another's
   * page has that page's box, less what is above its band.
   */
  box(page: FlowPage): { height: number };
  /** Whether a page of this section is a page of `other` (a continuous one can share it). */
  samePage(other: FlowSection): boolean;
}

/**
 * The lines `[fromLine, toLine)` of a block, placed on one page (`toLine` Infinity: to the end).
 * Line numbers are those of the column it is in, when columns' widths differ.
 * @internal
 */
export interface Fragment {
  page: number;
  fromLine: number;
  toLine: number;
  /** Its band on the page (one per section on it), when not the first. */
  band?: number;
  /** Its column in the band, when not the first. */
  column?: number;
  /** The first fragment of a band after the first: the space between the two bands. */
  lead?: number;
  /** A `sectionMark` block given no room. */
  mark?: boolean;
  /** The notes this fragment brought onto their pages: those it refers to, what was carried. */
  notes?: NotePiece[];
}

/** @internal */
export interface FlowRules {
  /** Fewest lines of a split block left at the bottom of a page. */
  orphans: number;
  /** Fewest lines of a split block carried to the top of the next page. */
  widows: number;
  /**
   * How margins (paragraph spacing) combine. `css` (the default): as CSS in a padded page.
   * `word`: as Word spaces paragraphs: the larger of the space after one and the space before
   * the next (Word's PDFs of the corpus). A page or column that a block flowed onto (not one an
   * explicit break started, nor the first) drops the space before its first block. The space
   * after the last block on a page need not fit.
   */
  spacing?: "css" | "word";
  /**
   * With `word` spacing: the two spaces add up instead (a document with Word's
   * `w:doNotUseHTMLParagraphAutoSpacing`, in every compatibility mode).
   */
  addSpacing?: boolean;
  /** The document has even and odd headers: a section restarting its numbers still keeps sides. */
  evenAndOddHeaders?: boolean;
  /** What goes above footnotes: on a page they start on, and on one they continue on. */
  notes?: { separator: FlowNote; continuation: FlowNote } | undefined;
}

/** @internal */
export const DEFAULT_RULES: FlowRules = { orphans: 2, widows: 2 };

/**
 * Height of a page's content box (page height minus top and bottom margins), in CSS px.
 * @internal
 */
export function contentHeight({ pageSize, margins }: DocumentSettings): number {
  return (pageSize.height - margins.top - margins.bottom) * PX_PER_MM;
}

// Half a pixel of slack: measured heights are fractional and rounding must not add a page.
const SLACK = 0.5;

/**
 * Where the flow stands before a block: shared by a full and an incremental flow.
 * @internal
 */
export interface FlowState {
  page: number;
  /** The page's displayed number. */
  number: number;
  /** The page the current section started on. */
  sectionPage: number;
  band: number;
  /** Where the band starts on its page, the space above it included. */
  bandTop: number;
  /** The space above the band: its first block's space before counts from there. */
  lead: number;
  column: number;
  /** The height used in the column, from the band's top. */
  used: number;
  /** The tallest of the band's earlier columns. */
  bandBottom: number;
  previousMargin: number;
  /** Blocks in the column. */
  onPage: number;
  /** An explicit page break ended the previous block: the next one starts a new page. */
  breakPending: boolean;
  /** An explicit column break ended it: the next one starts a new column. */
  columnPending: boolean;
  /** The column is the first or an explicit break started it (Word keeps its first space before). */
  forcedPage: boolean;
  /** On a page shared by sections: the first of them, which gives the page its box. */
  owner: { section: FlowSection; first: boolean } | null;
  /** The height footnotes take at the foot of the band, their separator included. */
  notes: number;
  /** The height of each of those notes. */
  noteParts: readonly number[];
  /** What the notes of the page's earlier bands take. */
  pageNotes: number;
  /** Footnotes still to be placed, from the line each has got to. */
  carry: readonly { note: FlowNote; from: number }[];
  /** Room kept at the foot of a band (by page and band) for notes its later columns refer to. */
  reserves: Readonly<Record<string, number>>;
}

/**
 * Page flow: the fragments of each block, in order. Blocks fill a page's columns in order; a
 * block that does not fit is split at a line boundary, the lines that fit staying in the column,
 * the rest continuing at the top of the next column or page (as many as it takes). A column with
 * room for no line of the next block ends; an empty one always takes at least one line.
 *
 * Rules:
 * - Explicit breaks: the line holding a page break ends its page, a column break its column.
 * - Widows and orphans: a split leaves at least `orphans` lines at the bottom of a page and
 *   carries at least `widows` lines to the next; a block too short for both moves whole. Not
 *   applied where only an empty page could hold the lines, nor across an explicit break.
 * - Keep with next: a `keepWithNext` block (and a chain of them) moves to the next column or page
 *   when the block after it would start there, unless it already starts its column or the move
 *   would not bring them together (then the flow stays as it was).
 * - Sections (`BlockBox.section`): a new one starts as its `start` says, an even or odd page
 *   section after a blank page when the page's number asks for one. A continuous one with the
 *   same page opens a band below the last; each band has its section's columns. A band of a
 *   `balanced` section ends with its columns level: its last page's columns take the shortest
 *   height that holds them.
 *
 * - Footnotes (ADR-0007, on Word's PDFs): a line with a reference goes on a page only if it, the
 *   separator and the note's first line fit. The note then takes the room down to the text, up to
 *   all of it, so a long one fills the page; the rest is carried to the foot of the next page,
 *   under the continuation separator, before any text is placed there, as much as fits. Lines a widow, orphan or keep rule takes back take their notes with them. In a
 *   section with columns the notes are set in those columns across the foot of the band, whichever
 *   column refers to them, and every column's text ends above them.
 * - Endnotes (`BlockBox.endnotes`) follow their block in the text, over as many pages as they need.
 *
 * Spacing follows CSS inside a padded page: the first block keeps its top margin, adjacent
 * margins collapse to the larger, and the last block's bottom margin stays inside the page
 * (it does not collapse into the padding), so it must fit too. Fragments are rendered without
 * the margins at their split edges: a continued fragment has no bottom margin, a continuation
 * no top margin.
 *
 * shortcut: positive margins only (negative margins collapse differently).
 * @internal
 */
export function flow(
  boxes: readonly BlockBox[],
  pageHeight: number,
  rules: FlowRules = DEFAULT_RULES,
): Fragment[][] {
  return flowFrom(boxes, pageHeight, rules).fragments;
}

/**
 * A flow with the state before each block (and after the last), for the next incremental one.
 * @internal
 */
export interface FlowResult {
  fragments: Fragment[][];
  states: FlowState[];
  /** The space above each block's first fragment (what the renderers write as its margin). */
  gaps: number[];
}

/**
 * What an incremental flow may reuse from the previous one.
 * @internal
 */
export interface Reuse {
  previous: FlowResult;
  /** Blocks before this index are the previous flow's first blocks, with the same boxes. */
  from: number;
  /**
   * The previous index of block `i` when it and every block after it are unchanged from the
   * previous flow (the common tail of an edit), else -1.
   */
  previousIndex(i: number): number;
}

/** A fragment's place in reading order: its page, band and column. */
const slot = (f: Fragment | undefined) =>
  f ? f.page * 1_000_000 + (f.band ?? 0) * 1000 + (f.column ?? 0) : 0;

/**
 * `flow`, reusing a previous one: it starts at `reuse.from` (backed up over a chain of
 * keep-with-next blocks, whose placement depends on what follows, and to the start of a balanced
 * section, whose columns depend on all of it) with the previous state there, and once the state
 * before an unchanged block equals the previous state before it, the rest is the previous flow's.
 * The result is the same as a full flow.
 * @internal
 */
export function flowFrom(
  boxes: readonly BlockBox[],
  flowHeight: number,
  rules: FlowRules = DEFAULT_RULES,
  reuse?: Reuse,
): FlowResult {
  let start = reuse ? Math.min(reuse.from, boxes.length, reuse.previous.fragments.length) : 0;
  const balancedAt = (i: number) => boxes[i]?.section?.balanced === true;
  const sameSection = (i: number) => boxes[i]?.section === boxes[i - 1]?.section;
  for (;;) {
    if (start > 0 && boxes[start - 1]?.keepWithNext) start--;
    else if (start > 0 && start < boxes.length && balancedAt(start) && sameSection(start)) start--;
    else break;
  }
  const result: Fragment[][] = reuse ? reuse.previous.fragments.slice(0, start) : [];
  const snapshots: FlowState[] = reuse ? reuse.previous.states.slice(0, start) : [];
  const gaps: number[] = reuse ? reuse.previous.gaps.slice(0, start) : [];
  let state: FlowState = (
    reuse?.previous.states[start]
      ? { ...reuse.previous.states[start] }
      : {
          page: 0,
          number: boxes[0]?.section?.pageStart ?? 1,
          sectionPage: 0,
          band: 0,
          bandTop: 0,
          lead: 0,
          column: 0,
          used: 0,
          bandBottom: 0,
          previousMargin: 0,
          onPage: 0,
          breakPending: false,
          columnPending: false,
          forcedPage: true,
          owner: null,
          notes: 0,
          noteParts: [],
          pageNotes: 0,
          carry: [],
          reserves: {},
        }
  ) as FlowState;
  /** Blocks that start a column because the keep-with-next rule moved them. */
  const breakBefore = new Set<number>();
  const word = rules.spacing === "word";
  /** While a section is balanced: the page whose columns are limited, and to what height. */
  let balancing: { page: number; height: number } | null = null;
  /** Note pieces placed and not yet held by a fragment. */
  let pending: NotePiece[] = [];
  /** Asked for by a later column: the band is flowed again with this kept at its foot. */
  let retry: { key: string; height: number } | null = null;
  const bandKey = () => `${state.page}|${state.band}`;
  const reserved = () => state.reserves[bandKey()] ?? 0;

  const newPage = (forced = false) => {
    state.page++;
    state.number++;
    state.band = 0;
    state.bandTop = 0;
    state.lead = 0;
    state.column = 0;
    state.used = 0;
    state.bandBottom = 0;
    state.onPage = 0;
    state.forcedPage = forced;
    state.owner = null;
    state.notes = 0;
    state.noteParts = [];
    state.pageNotes = 0;
    // What was kept on earlier pages is done with.
    if (Object.keys(state.reserves).length)
      state.reserves = Object.fromEntries(
        Object.entries(state.reserves).filter(([key]) => Number.parseInt(key, 10) >= state.page),
      );
  };
  /** The next column of the band, or the next page after its last. */
  const nextColumn = (box: BlockBox, forced = false) => {
    if (state.column + 1 >= (box.section?.columns ?? 1)) {
      newPage(forced);
      return;
    }
    state.bandBottom = Math.max(state.bandBottom, state.used);
    state.column++;
    state.used = 0;
    state.lead = 0;
    state.onPage = 0;
    state.forcedPage = forced;
  };
  /** The height a block may reach in the column, from the band's top. */
  const room = (box: BlockBox) => pageRoom(box) - Math.max(state.notes, reserved());
  /** The height a block may reach in the column, whatever notes take. */
  const pageRoom = (box: BlockBox) => {
    const section = state.owner?.section ?? box.section;
    const page =
      (section
        ? section.box({
            index: state.page,
            number: state.number,
            first: state.owner?.first ?? state.page === state.sectionPage,
          }).height
        : (box.pageHeight ?? flowHeight)) -
      state.bandTop -
      state.pageNotes;
    return balancing?.page === state.page ? Math.min(page, balancing.height) : page;
  };
  const piece = (note: FlowNote, fromLine: number, toLine: number): NotePiece => ({
    id: note.id,
    page: state.page,
    ...(state.band ? { band: state.band } : {}),
    ...(state.column ? { column: state.column } : {}),
    fromLine,
    toLine,
  });
  /** A piece of the notes at a band's foot: they are the band's, not one column's. */
  const footPiece = (note: FlowNote, fromLine: number, toLine: number): NotePiece => ({
    id: note.id,
    page: state.page,
    ...(state.band ? { band: state.band } : {}),
    fromLine,
    toLine,
  });
  /** How much of an endnote, from line `from`, fits in `free`. */
  const linesIn = (note: FlowNote, from: number, free: number) => {
    const lines = note.lines(state.column);
    const top = from ? (lines[from - 1] as number) : 0;
    let to = from;
    while (to < lines.length && (lines[to] as number) - top <= free + SLACK) to++;
    return { to, height: to > from ? (lines[to - 1] as number) - top : 0, all: lines.length };
  };
  /** How much of a footnote fits in `free` beside the notes `parts` of the band's foot. */
  const fitNote = (
    note: FlowNote,
    from: number,
    free: number,
    parts: readonly number[],
    columns: number,
  ) => {
    const lines = note.lines(0);
    const top = from ? (lines[from - 1] as number) : 0;
    const beside = columns > 1 ? 0 : notesHeight(parts, 1);
    const height = (to: number) => (lines[to] as number) - top;
    let to = from;
    while (
      to < lines.length &&
      (columns > 1 ? notesHeight([...parts, height(to)], columns) : beside + height(to)) <=
        free + SLACK
    )
      to++;
    return { to, height: to > from ? height(to - 1) : 0, all: lines.length };
  };
  const noteHeight = (note: FlowNote) => note.lines(0).at(-1) ?? 0;
  const separatorPiece = (note: FlowNote) => footPiece(note, 0, note.lines(0).length);
  /**
   * On a page or band with no notes yet: what is carried over goes to its foot first, as much as
   * fits, before any text (Word's PDFs: a long note takes whole pages). `force`: a page with
   * nothing else on it takes at least a line.
   */
  const placeCarried = (box: BlockBox, force = false) => {
    if (!state.carry.length || state.notes || state.onPage || !rules.notes) return;
    const { continuation } = rules.notes;
    const columns = box.section?.columns ?? 1;
    const above = noteHeight(continuation);
    const free = pageRoom(box) - state.used - above;
    const placed: NotePiece[] = [];
    const left: FlowState["carry"][number][] = [];
    let parts: readonly number[] = [];
    for (const item of state.carry) {
      if (left.length) {
        left.push(item);
        continue;
      }
      let fit = fitNote(item.note, item.from, free, parts, columns);
      if (fit.to === item.from && force && !placed.length)
        fit = fitNote(item.note, item.from, lineHeightOf(item), parts, 1);
      if (fit.to > item.from) {
        placed.push(footPiece(item.note, item.from, fit.to));
        parts = [...parts, fit.height];
      }
      if (fit.to < fit.all) left.push({ note: item.note, from: fit.to });
    }
    if (!placed.length) return;
    pending.push(separatorPiece(continuation), ...placed);
    state.notes = above + notesHeight(parts, columns);
    state.noteParts = parts;
    state.carry = left;
  };
  /** The height of the next line of a carried note. */
  const lineHeightOf = ({ note, from }: FlowState["carry"][number]) => {
    const lines = note.lines(0);
    return (lines[from] as number) - (from ? (lines[from - 1] as number) : 0);
  };
  /** Whether what does not fit here can go elsewhere: not from an empty last column at the top. */
  const canMove = (box: BlockBox) =>
    state.onPage > 0 ||
    state.notes > 0 ||
    state.bandTop > 0 ||
    state.column + 1 < (box.section?.columns ?? 1);

  /** Moves to where `section` starts; the space above a new band when it opens one. */
  const enterSection = (section: FlowSection, previous: FlowSection | undefined) => {
    const pageBroken = state.breakPending;
    state.breakPending = false;
    state.columnPending = false;
    // Word's PDFs: notes on the page and a continuous break into other columns start a page.
    const notesAbove =
      (state.notes > 0 || state.pageNotes > 0) && section.columns !== previous?.columns;
    const samePage = !previous || (section.samePage(previous) && !notesAbove);
    if (!pageBroken && samePage && section.start === "continuous") {
      state.owner ??= {
        section: previous ?? section,
        first: state.page === state.sectionPage,
      };
      const lead = state.previousMargin;
      state.bandTop += Math.max(state.bandBottom, state.used) + lead;
      state.lead = lead;
      state.band++;
      state.column = 0;
      state.used = 0;
      state.bandBottom = 0;
      state.onPage = 0;
      state.forcedPage = true;
      state.sectionPage = state.page;
      state.pageNotes += state.notes;
      state.notes = 0;
      state.noteParts = [];
      return lead;
    }
    if (
      !pageBroken &&
      samePage &&
      section.start === "nextColumn" &&
      section.columns === previous?.columns &&
      state.column + 1 < section.columns
    ) {
      nextColumn({ section } as BlockBox, true);
      return undefined;
    }
    if (state.onPage || state.used || state.column || state.band) newPage(true);
    else state.forcedPage = true;
    const wrongKind = (number: number) =>
      (section.start === "oddPage" && number % 2 === 0) ||
      (section.start === "evenPage" && number % 2 === 1);
    // Word's even and odd page sections (its PDFs, every kind, start and page before): a blank
    // page when the number the pages have reached is the wrong kind, unless the section restarts
    // its numbers in a document without even and odd headers. A restart then takes its start, or
    // the next number when that is the wrong kind.
    if (wrongKind(state.number) && (section.pageStart === undefined || rules.evenAndOddHeaders))
      newPage(true);
    if (section.pageStart !== undefined)
      state.number = section.pageStart + (wrongKind(section.pageStart) ? 1 : 0);
    state.sectionPage = state.page;
    return undefined;
  };

  const place = (box: BlockBox, index: number): Fragment[] => {
    const fragments = placeBlock(box, index);
    if (box.endnotes?.length) placeEndnotes(box, fragments);
    return fragments;
  };

  /** A block's endnotes, after it in the text; lines that do not fit go on to the next column. */
  const placeEndnotes = (box: BlockBox, fragments: Fragment[]) => {
    let lead: number | undefined = state.onPage ? state.previousMargin : 0;
    for (const note of box.endnotes ?? []) {
      let from = 0;
      for (;;) {
        const lines = note.lines(state.column);
        if (from >= lines.length) break;
        const top = from ? (lines[from - 1] as number) : 0;
        placeCarried(box);
        const gap = state.onPage ? (lead ?? 0) : 0;
        let fit = linesIn(note, from, room(box) - state.used - gap);
        if (fit.to === from) {
          if (canMove(box)) {
            nextColumn(box);
            continue;
          }
          fit = { ...fit, to: from + 1, height: (lines[from] as number) - top };
        }
        const part = piece(note, from, fit.to);
        part.end = true;
        if (gap) part.lead = gap;
        pending.push(part);
        lead = undefined;
        state.used += gap + fit.height;
        state.onPage++;
        from = fit.to;
        if (from < lines.length) nextColumn(box);
      }
    }
    state.previousMargin = 0;
    const last = fragments[fragments.length - 1];
    if (last && pending.length) last.notes = [...(last.notes ?? []), ...pending];
    if (last) pending = [];
  };

  const placeBlock = (box: BlockBox, index: number): Fragment[] => {
    const previous = boxes[index - 1];
    let lead: number | undefined;
    if (index > 0 && box.section && previous?.section !== box.section)
      lead = enterSection(box.section, previous?.section);
    else if (state.breakPending && state.onPage) newPage(true);
    else if (state.columnPending) nextColumn(box, true);
    else if (breakBefore.has(index) && state.onPage) nextColumn(box);
    state.breakPending = false;
    state.columnPending = false;
    const leadPage = state.page;
    const at = (fromLine: number, toLine: number): Fragment => {
      const fragment: Fragment = { page: state.page, fromLine, toLine };
      if (state.band) fragment.band = state.band;
      if (state.column) fragment.column = state.column;
      // Moved on to the next page, the block opens no band below anything.
      if (lead !== undefined && state.page === leadPage) fragment.lead = lead;
      lead = undefined;
      if (pending.length) {
        fragment.notes = pending;
        pending = [];
      }
      return fragment;
    };
    if (box.sectionMark && state.onPage) {
      gaps[index] = 0;
      return [{ ...at(0, Infinity), mark: true }];
    }
    const above = state.previousMargin;
    state.previousMargin = box.marginBottom;
    const adding = word && rules.addSpacing === true;
    const gap = () => {
      if (!state.onPage) {
        if (word && !state.forcedPage) return 0;
        return adding ? box.marginTop : Math.max(0, box.marginTop - state.lead);
      }
      return adding ? above + box.marginTop : Math.max(above, box.marginTop);
    };
    // The bottom margin that must fit on the page (Word lets the space after hang).
    const below = word ? 0 : box.marginBottom;
    const pageBreaks = box.breaksAfter?.(state.column) ?? [];
    const columnBreaks = box.columnBreaksAfter?.(state.column) ?? [];
    const forced = pageBreaks.length + columnBreaks.length > 0;
    let measured: Pick<BlockBox, "height" | "lines"> = box.inColumn?.(state.column) ?? box;
    /** The notes referred to on each line, in the column it is in now. */
    const referred = () => {
      const byLine = new Map<number, FlowNote[]>();
      for (const { line, note } of box.notes?.(state.column) ?? [])
        byLine.set(line, [...(byLine.get(line) ?? []), note]);
      return byLine;
    };
    let notesOf = referred();
    if (state.carry.length && !state.onPage) placeCarried(box);
    if (
      !forced &&
      !notesOf.size &&
      state.used + gap() + measured.height + below <= room(box) + SLACK
    ) {
      const space = gap();
      gaps[index] = space;
      state.used += space + measured.height;
      state.onPage++;
      return [at(0, Infinity)];
    }
    let lines = measured.lines();
    let count = lines.length;
    const inRange = (list: readonly number[]) =>
      new Set(list.filter((at) => at >= 0 && at < count));
    let pageAfter = inRange(pageBreaks);
    let columnAfter = inRange(columnBreaks);
    const fragments: Fragment[] = [];
    let line = 0;
    /** The explicit breaks passed so far. */
    let passed = 0;
    /** After a move: `measured` is the new column's, and `line` where the text has got to. */
    const remeasure = (broken = false) => {
      if (!box.inColumn) return;
      const next = box.inColumn(state.column);
      if (next === measured) return;
      const nextLines = next.lines();
      // shortcut: the same share of the text is taken to start the same line in another
      // width (a line either way); a word-exact tail needs the text in the flow's terms.
      const share = line ? (lines[line - 1] as number) / (measured.height || 1) : 0;
      measured = next;
      lines = nextLines;
      count = lines.length;
      // Breaks are lines of this width.
      pageAfter = inRange(box.breaksAfter?.(state.column) ?? []);
      columnAfter = inRange(box.columnBreaksAfter?.(state.column) ?? []);
      if (line > 0) {
        // After an explicit break the text goes on right after the same break.
        const after = [...pageAfter, ...columnAfter].sort((a, b) => a - b)[passed - 1];
        let mapped = lines.findIndex((bottom) => bottom / (next.height || 1) > share + 1e-6);
        if (mapped < 0) mapped = count - 1;
        line = broken && after !== undefined ? after + 1 : Math.max(mapped, 1);
      }
      // Nothing left in this width (all of it fits one wider line): the last fragment ends it.
      if (line >= count) {
        const last = fragments.at(-1);
        if (last) last.toLine = Infinity;
      }
    };
    while (line < count) {
      // The lines up to the next explicit break (or the end) can be split freely.
      let segmentEnd = line;
      while (segmentEnd < count && !pageAfter.has(segmentEnd) && !columnAfter.has(segmentEnd))
        segmentEnd++;
      segmentEnd = Math.min(segmentEnd + 1, count);
      const top = line ? (lines[line - 1] as number) : 0;
      // Only the block's first fragment has the gap above it; the others repeat its header.
      const spacing = line === 0 ? gap() : (box.repeat ?? 0);
      notesOf = referred();
      placeCarried(box);
      const limit = pageRoom(box);
      /**
       * The footnotes of lines `line` to `to - 1` at the band's foot, each taking the room down
       * to the text after its line; null when one's first line does not fit (`force`: it goes in).
       * With columns the notes share the foot of them all: above them goes the tallest column.
       */
      // A block kept whole is one line to the flow already.
      const keepAll = count === 1;
      const planNotes = (to: number, force = false) => {
        const plan = {
          notes: state.notes,
          parts: state.noteParts,
          carry: state.carry,
          pieces: [] as NotePiece[],
        };
        if (!notesOf.size || !rules.notes) return plan;
        const columns = box.section?.columns ?? 1;
        for (let at = line; at < to; at++)
          for (const note of notesOf.get(at) ?? []) {
            // Behind a note already cut, it waits its turn.
            if (plan.carry.length) {
              plan.carry = [...plan.carry, { note, from: 0 }];
              continue;
            }
            const { separator } = rules.notes;
            const first = !plan.notes;
            const above = first
              ? noteHeight(separator)
              : plan.notes - notesHeight(plan.parts, columns);
            // Word's PDFs: the lines that the widow and orphan rules keep with this one stay above
            // the note, and the paragraph's space after stays between its last line and the notes.
            let kept = at + 1;
            if (!box.anyLine && !keepAll) {
              kept = Math.max(kept, line + rules.orphans);
              if (count - kept < rules.widows) kept = count;
              kept = Math.min(kept, segmentEnd);
            }
            const after = kept === count ? box.marginBottom : 0;
            const own = state.used + spacing + (lines[kept - 1] as number) - top + after;
            const text = Math.max(own, columns > 1 && state.column ? state.bandBottom : 0);
            let fit = fitNote(note, 0, limit - text - above, plan.parts, columns);
            if (
              columns > 1 &&
              state.column &&
              !force &&
              (!fit.to || (fit.to < fit.all && text > own))
            ) {
              // A later column's note, cut short by what the earlier columns hold: in Word they
              // end above it. They are flowed again with its room kept, whole if the page can.
              const lines = note.lines(0);
              const whole = above + notesHeight([...plan.parts, lines.at(-1) as number], columns);
              const one = above + notesHeight([...plan.parts, lines[0] as number], columns);
              const height = whole < limit / 2 ? whole : one;
              if (height > reserved() + SLACK && height < limit) retry = { key: bandKey(), height };
            }
            if (!fit.to) {
              if (!force) return null;
              fit = fitNote(note, 0, lineHeightOf({ note, from: 0 }), [], 1);
            }
            if (first) plan.pieces.push(separatorPiece(separator));
            plan.pieces.push(footPiece(note, 0, fit.to));
            plan.parts = [...plan.parts, fit.height];
            plan.notes = above + notesHeight(plan.parts, columns);
            if (fit.to < fit.all) plan.carry = [{ note, from: fit.to }];
          }
        return plan;
      };
      let end = line;
      while (end < segmentEnd) {
        const bottom = (lines[end] as number) - top + (end + 1 === count ? below : 0);
        const plan = planNotes(end + 1);
        if (
          !plan ||
          state.used + spacing + bottom + Math.max(plan.notes, reserved()) > limit + SLACK
        )
          break;
        end++;
      }
      if (end < segmentEnd && end > line && !box.anyLine) {
        // A natural split: keep `widows` lines for the next page and `orphans` on this one.
        const kept = Math.min(end, segmentEnd - rules.widows);
        if (kept - line >= rules.orphans) end = kept;
        else if (canMove(box)) end = line;
      }
      if (end === line) {
        if (canMove(box)) {
          nextColumn(box);
          remeasure();
          continue;
        }
        end = line + 1; // a line taller than a page is placed anyway
      }
      // What the lines kept refer to: lines taken back take their notes with them.
      const kept = planNotes(end, true);
      if (kept) {
        state.notes = kept.notes;
        state.noteParts = kept.parts;
        state.carry = kept.carry;
        pending.push(...kept.pieces);
      }
      if (line === 0) gaps[index] = spacing;
      fragments.push(at(line, end));
      state.used += spacing + (lines[end - 1] as number) - top;
      state.onPage++;
      line = end;
      const pageBroken = pageAfter.has(end - 1);
      const columnBroken = columnAfter.has(end - 1);
      if (line < count) {
        if (pageBroken || columnBroken) passed++;
        if (pageBroken) newPage();
        else nextColumn(box, columnBroken);
        remeasure(pageBroken || columnBroken);
      } else if (pageBroken) state.breakPending = true;
      else if (columnBroken) state.columnPending = true;
    }
    // Moved whole to a later page: not split.
    const [only] = fragments;
    if (fragments.length === 1 && only && !forced) only.toLine = Infinity;
    return fragments;
  };

  /** The flow as it was before a keep-with-next move, by the block that triggered it. */
  const attempts = new Map<
    number,
    {
      first: number;
      result: Fragment[][];
      snapshots: FlowState[];
      gaps: number[];
      state: FlowState;
    }
  >();

  /** Flows blocks `from` to `to`; a result when the rest could be taken from `reuse`. */
  const run = (from: number, to: number): FlowResult | null => {
    let index = from;
    while (index < to) {
      // Realigned with the previous flow: the rest is unchanged (no keep-with-next decision
      // about this block, made with the block before it, is pending). The block before it must
      // be unchanged too: had it been keep-with-next before the edit, the previous flow from
      // here holds a decision about a chain that no longer exists. Inside a balanced section the
      // columns depend on the whole section: only its start realigns.
      const was =
        reuse &&
        !balancing &&
        index > start &&
        !attempts.size &&
        reuse.previousIndex(index - 1) >= 0
          ? reuse.previousIndex(index)
          : -1;
      const before = was >= 0 ? reuse?.previous.states[was] : undefined;
      if (
        before &&
        !boxes[index - 1]?.keepWithNext &&
        !(balancedAt(index) && sameSection(index)) &&
        sameState(before, state)
      ) {
        const previous = (reuse as Reuse).previous;
        result.length = index;
        snapshots.length = index;
        gaps.length = index;
        result.push(...previous.fragments.slice(was));
        snapshots.push(...previous.states.slice(was, -1));
        gaps.push(...previous.gaps.slice(was));
        return {
          fragments: result,
          states: [...snapshots, { ...(previous.states.at(-1) as FlowState) }],
          gaps,
        };
      }
      snapshots[index] = { ...state };
      const fragments = place(boxes[index] as BlockBox, index);
      if (retry) {
        const { key, height } = retry;
        retry = null;
        const [page, band] = key.split("|").map(Number) as [number, number];
        // Back to the first block on that band: it may have started on an earlier page.
        let first = index;
        while (
          first > from &&
          result[first - 1]?.some((f) => f.page === page && (f.band ?? 0) === band)
        )
          first--;
        const before = snapshots[first] as FlowState;
        state = { ...before, reserves: { ...before.reserves, [key]: height } };
        result.length = first;
        snapshots.length = first;
        gaps.length = first;
        attempts.clear();
        for (const moved of breakBefore) if (moved >= first) breakBefore.delete(moved);
        pending = [];
        index = first;
        continue;
      }
      result[index] = fragments;
      const previous = result[index - 1];
      const startsLater =
        previous !== undefined && slot(fragments[0]) > slot(previous[previous.length - 1]);
      const attempt = attempts.get(index);
      if (attempt) {
        attempts.delete(index);
        // The move did not bring them together (the block does not fit after the heading on a
        // page of its own either): keep the flow as it was.
        if (startsLater) {
          result.splice(attempt.first, result.length - attempt.first, ...attempt.result);
          snapshots.splice(attempt.first, snapshots.length - attempt.first, ...attempt.snapshots);
          gaps.splice(attempt.first, gaps.length - attempt.first, ...attempt.gaps);
          state = attempt.state;
          index++;
          continue;
        }
      }
      if (startsLater && boxes[index - 1]?.keepWithNext && sameSection(index)) {
        // The chain of keep-with-next blocks before this one, each whole in one column (keeping
        // reaches no further back than the section: it starts where its `start` says).
        let first = index - 1;
        while (
          first > 0 &&
          sameSection(first) &&
          boxes[first - 1]?.keepWithNext &&
          result[first - 1]?.length === 1 &&
          slot(result[first - 1]?.[0]) === slot(result[first]?.[0])
        )
          first--;
        const beforeFirst = snapshots[first] as FlowState;
        if (!breakBefore.has(first) && beforeFirst.onPage > 0 && result[first]?.length === 1) {
          attempts.set(index, {
            first,
            result: result.slice(first),
            snapshots: snapshots.slice(first),
            gaps: gaps.slice(first),
            state: { ...state },
          });
          breakBefore.add(first);
          state = { ...beforeFirst };
          result.length = first;
          index = first;
          continue;
        }
      }
      index++;
      const section = boxes[index - 1]?.section;
      if (
        !balancing &&
        section?.balanced &&
        section.columns > 1 &&
        boxes[index]?.section !== section
      )
        balance(index);
    }
    return null;
  };

  /**
   * Levels the columns of the balanced section ending before block `end`: flows it again with
   * its last page's columns limited, looking for the shortest height that keeps it on that page.
   */
  const balance = (end: number) => {
    const section = boxes[end - 1]?.section as FlowSection;
    let first = end - 1;
    while (first > 0 && boxes[first - 1]?.section === section) first--;
    const from = snapshots[first] as FlowState;
    const { page } = state;
    let high = Math.max(state.bandBottom, state.used);
    let low = high / section.columns - 1;
    /** The section flowed with its last page's columns `height` tall: does it stay there? */
    const attempt = (height: number) => {
      balancing = { page, height };
      state = { ...from };
      result.length = first;
      snapshots.length = first;
      attempts.clear();
      for (const moved of breakBefore) if (moved >= first) breakBefore.delete(moved);
      run(first, end);
      // The last column takes what it is given: a column over the limit is a failure too.
      return state.page === page && Math.max(state.used, state.bandBottom) <= height + SLACK;
    };
    while (high - low > 0.5) {
      const middle = (low + high) / 2;
      if (attempt(middle)) high = middle;
      else low = middle;
    }
    if (!attempt(high)) attempt(Number.POSITIVE_INFINITY);
    balancing = null;
  };

  /** What is still carried after the last block goes on pages of its own. */
  const finishNotes = () => {
    const held = result[result.length - 1];
    const last = held?.[held.length - 1];
    const box = boxes[boxes.length - 1];
    if (!held || !last || !box || (!state.carry.length && !last.notes?.some((p) => p.tail))) return;
    const end = state;
    state = { ...state };
    while (state.carry.length) {
      newPage();
      placeCarried(box, true);
    }
    const notes = [
      ...(last.notes ?? []).filter((p) => !p.tail),
      ...pending.map((p) => ({ ...p, tail: true })),
    ];
    pending = [];
    state = end;
    result[result.length - 1] = [...held.slice(0, -1), { ...last, notes }];
  };

  const reused = run(start, boxes.length);
  if (reused) return reused;
  finishNotes();
  return {
    fragments: result,
    states: [...snapshots.slice(0, boxes.length), { ...state }],
    gaps: gaps.slice(0, boxes.length),
  };
}

/**
 * Each page of a flow: its number, its first section and whether that section starts on it. A page
 * nothing is on (the blank page before an even or odd page section) has the next page's section.
 * @internal
 */
export function pagesOf(boxes: readonly BlockBox[], result: FlowResult): PageFacts[] {
  const pages: (PageFacts | undefined)[] = [];
  const owners: FlowSection[] = [];
  const seen = new Set<FlowSection>();
  const onPages = new Map<FlowSection, Set<number>>();
  result.fragments.forEach((fragments, i) => {
    const section = boxes[i]?.section as FlowSection;
    const after = result.states[i + 1] as FlowState;
    const own = onPages.get(section) ?? new Set<number>();
    onPages.set(section, own);
    const places = [...fragments, ...fragments.flatMap((fragment) => fragment.notes ?? [])];
    for (const { page } of places) {
      own.add(page);
      if (!pages[page]) {
        owners[page] = section;
        pages[page] = {
          index: page,
          // Pages count on from a block's first to its last: the number where it ended tells.
          number: after.number - (after.page - page),
          first: !seen.has(section),
          section: section.index ?? 0,
          sectionPages: 0,
        };
      }
      seen.add(section);
    }
  });
  pages.forEach((page, p) => {
    if (page) page.sectionPages = onPages.get(owners[p] as FlowSection)?.size ?? 0;
  });
  for (let p = pages.length - 1; p >= 0; p--) {
    const next = pages[p + 1] as PageFacts;
    pages[p] ??= { ...next, index: p, number: next.number - 1, first: false, sectionPages: 0 };
  }
  return pages as PageFacts[];
}

/**
 * Notes of heights `parts` set in `columns` columns, as Word sets those of a section with columns
 * (its PDFs): whole, in order, each column as full as the height the set needs. That height and
 * the column of each. One column: their sum.
 * @internal
 */
export function arrangeNotes(
  parts: readonly number[],
  columns: number,
): { height: number; columnOf: number[] } {
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (columns <= 1 || parts.length <= 1) return { height: total, columnOf: parts.map(() => 0) };
  const pack = (height: number) => {
    const columnOf: number[] = [];
    let column = 0;
    let used = 0;
    let tallest = 0;
    for (const part of parts) {
      if (used && used + part > height + 0.01) {
        column++;
        used = 0;
      }
      used += part;
      tallest = Math.max(tallest, used);
      columnOf.push(column);
    }
    return column < columns ? { height: tallest, columnOf } : null;
  };
  let low = Math.max(...parts, total / columns);
  let best = pack(low);
  if (best) return best;
  let high = total;
  best = pack(high) as NonNullable<ReturnType<typeof pack>>;
  while (high - low > 0.25) {
    const middle = (low + high) / 2;
    const tried = pack(middle);
    if (tried) {
      best = tried;
      high = middle;
    } else low = middle;
  }
  return best;
}

const notesHeight = (parts: readonly number[], columns: number) =>
  arrangeNotes(parts, columns).height;

/**
 * The space after the last block of a column of a page, as flowed (what ends its text).
 * @internal
 */
export function spaceAfterText(
  boxes: readonly BlockBox[],
  result: Pick<FlowResult, "fragments">,
  page: number,
  band: number,
  column: number,
): number {
  for (let i = result.fragments.length - 1; i >= 0; i--)
    for (const f of result.fragments[i] ?? [])
      if (f.page === page && (f.band ?? 0) === band && (f.column ?? 0) === column)
        return boxes[i]?.marginBottom ?? 0;
  return 0;
}

/**
 * Every note piece of a flow, in order.
 * @internal
 */
export const notePieces = (result: Pick<FlowResult, "fragments">): NotePiece[] =>
  result.fragments.flatMap((fragments) => fragments.flatMap((f) => f.notes ?? []));

function sameState(a: FlowState, b: FlowState): boolean {
  return (
    a.notes === b.notes &&
    JSON.stringify(a.reserves) === JSON.stringify(b.reserves) &&
    a.noteParts.length === b.noteParts.length &&
    a.noteParts.every((part, i) => part === b.noteParts[i]) &&
    a.pageNotes === b.pageNotes &&
    a.carry.length === b.carry.length &&
    a.carry.every(
      (item, i) => item.note.id === b.carry[i]?.note.id && item.from === b.carry[i]?.from,
    ) &&
    a.page === b.page &&
    a.number === b.number &&
    a.sectionPage === b.sectionPage &&
    a.band === b.band &&
    a.bandTop === b.bandTop &&
    a.lead === b.lead &&
    a.column === b.column &&
    a.used === b.used &&
    a.bandBottom === b.bandBottom &&
    a.previousMargin === b.previousMargin &&
    a.onPage === b.onPage &&
    a.breakPending === b.breakPending &&
    a.columnPending === b.columnPending &&
    a.forcedPage === b.forcedPage &&
    a.owner === b.owner
  );
}
