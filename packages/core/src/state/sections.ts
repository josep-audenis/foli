/**
 * Sections (11.6, ADR-0007): what layout needs of `w:cols`, and the commands that insert and
 * remove section breaks and change a section's page setup, as Word records them. A section's
 * setup is on the paragraph that ends it (`section`), the last one's in the envelope.
 *
 * Checked with Word 16 (automation, its saved XML): a break splits the paragraph at the caret; the
 * first half's mark holds the section's setup, header references included, and the rest of the
 * section keeps its setup without them (it inherits them) and starts as the break says. While
 * tracking the new mark is a tracked insertion and nothing else is recorded; a removed break is
 * its mark, tracked as deleted; a changed setup is `w:sectPrChange` holding the setup before.
 * Removing a break leaves the following section's setup, with the header references it inherited.
 */
import { deepEqual } from "../model/attrs.js";
import type { Node } from "../model/index.js";
import type { SectionJSON } from "../v3/document.js";
import { checkSection } from "../v3/schema.js";
import { closeHistory } from "./history.js";
import { keepLastMark } from "./mark.js";
import { TextSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import { newRevision, untracked } from "./track.js";
import { EnvelopeStep, setEnvelopeValue, splitAttrs, wordContext } from "./word.js";

/** Word's page when a section leaves it out: Letter, 1 inch margins. */
const LETTER = { width: 12240, height: 15840, margin: 1440 };
/** Word's default space between columns: half an inch. */
const COLUMN_SPACE = 720;

export interface SectionColumns {
  /** Each column's width. */
  widths: number[];
  /** The space after each column but the last. */
  gaps: number[];
  /** A line between columns. */
  separator: boolean;
}

/**
 * The columns of `section`: its set widths when it says the columns are not equal, otherwise
 * `count` columns sharing the text width.
 */
export function sectionColumns(section: SectionJSON): SectionColumns {
  const { columns = {} } = section;
  const separator = columns.separator === true;
  const space = columns.space ?? COLUMN_SPACE;
  const set = columns.equalWidth === false ? columns.widths : undefined;
  if (set?.length)
    return {
      widths: set.map((column) => column.width),
      gaps: set.slice(0, -1).map((column) => column.space ?? space),
      separator,
    };
  const count = Math.max(columns.count ?? 1, 1);
  const width = Math.max((textWidth(section) - space * (count - 1)) / count, 1);
  return {
    widths: Array.from({ length: count }, () => width),
    gaps: Array.from({ length: count - 1 }, () => space),
    separator,
  };
}

/** The width between a section's margins, in twips. */
function textWidth({ pageSize, margins: m = {} }: SectionJSON): number {
  return (
    (pageSize?.width ?? LETTER.width) -
    (m.left ?? LETTER.margin) -
    (m.right ?? LETTER.margin) -
    (m.gutter ?? 0)
  );
}

/** `section` without the keys whose value is undefined (the schema has no such values). */
function clean(section: Record<string, unknown>): SectionJSON {
  return Object.fromEntries(
    Object.entries(section).filter(([, value]) => value !== undefined),
  ) as SectionJSON;
}

/** The first paragraph holding a section at or after `from`: null when the last section's. */
function holderFrom(doc: Node, from: number): { pos: number; node: Node } | null {
  let found: { pos: number; node: Node } | null = null;
  doc.forEach((node, pos) => {
    if (!found && pos + node.nodeSize > from && node.attrs.section) found = { pos, node };
  });
  return found;
}

/** The last section's setup as `tr` leaves it. */
function lastSection(state: EditorState, tr: Transaction): SectionJSON {
  let section = wordContext(state)?.envelope.section ?? {};
  for (const step of tr.steps) if (step instanceof EnvelopeStep) section = step.after;
  return section;
}

/** Makes `tr` give the section held at `holder` (null: the last one) the setup `section`. */
function writeSection(
  state: EditorState,
  tr: Transaction,
  holder: { pos: number; node: Node } | null,
  section: SectionJSON,
): void {
  if (holder) tr.setNodeMarkup(holder.pos, holder.node.type, { ...holder.node.attrs, section });
  else setEnvelopeValue(state, tr, "section", section);
}

/** The section around the selection's start. */
export interface SectionAt {
  setup: SectionJSON;
  /** The paragraph holding it; null for the last section (the envelope's). */
  pos: number | null;
  /** Its place among the document's sections, from 0, and how many there are. */
  index: number;
  count: number;
}

export function sectionAt(state: EditorState): SectionAt | null {
  const context = wordContext(state);
  if (!context) return null;
  const { $from } = state.selection;
  const start = $from.depth ? $from.before(1) : $from.pos;
  let index = 0;
  let count = 1;
  state.doc.forEach((node, pos) => {
    if (!node.attrs.section) return;
    count++;
    if (pos + node.nodeSize <= start) index++;
  });
  const holder = holderFrom(state.doc, start);
  return {
    setup: holder ? (holder.node.attrs.section as SectionJSON) : context.envelope.section,
    pos: holder?.pos ?? null,
    index,
    count,
  };
}

/** How a new section starts. */
export type SectionBreakKind = "nextPage" | "continuous" | "evenPage" | "oddPage";

/**
 * Inserts a section break at the selection's start, in a paragraph of the body: the text before
 * it ends a section with the current setup, the rest starts as `kind` says. Tracked while
 * tracking, as an inserted paragraph mark.
 */
export function insertSectionBreak(kind: SectionBreakKind = "nextPage"): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const { $from } = state.selection;
    if (!context || !(state.selection instanceof TextSelection)) return false;
    if ($from.depth !== 1 || $from.parent.type.name !== "paragraph") return false;
    if (dispatch) {
      const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
      const paragraph = $from.parent;
      const start = $from.before();
      const { before, after } = splitAttrs(
        context,
        paragraph,
        $from.parentOffset === paragraph.content.size,
      );
      tr.split($from.pos, 1, [{ type: paragraph.type, attrs: after }]);
      const second = $from.pos + 1;
      const holder = holderFrom(tr.doc, second);
      const setup = holder ? (holder.node.attrs.section as SectionJSON) : lastSection(state, tr);
      // The first part keeps the section as it is; a tracked setup change stays with it.
      const revision = newRevision(state);
      tr.setNodeMarkup(start, paragraph.type, {
        ...(before ?? paragraph.attrs),
        section: setup,
        ...(revision ? { revision: { insertion: revision } } : {}),
      });
      writeSection(
        state,
        tr,
        holderFrom(tr.doc, second),
        clean({
          ...setup,
          headers: undefined,
          footers: undefined,
          change: undefined,
          type: kind === "nextPage" ? undefined : kind,
        }),
      );
      tr.setSelection(TextSelection.create(tr.doc, $from.pos + 2));
      dispatch(tr);
    }
    return true;
  };
}

/**
 * After the section `removed` ended (its break went): the section that follows `from` takes over
 * its text, keeping its own setup, starting as `removed` started, with the header and footer
 * references it inherited.
 */
export function absorbSection(
  state: EditorState,
  tr: Transaction,
  removed: SectionJSON,
  from: number,
): void {
  const holder = holderFrom(tr.doc, from);
  const setup = holder ? (holder.node.attrs.section as SectionJSON) : lastSection(state, tr);
  const inherited = (own?: Record<string, string>, earlier?: Record<string, string>) =>
    own || earlier ? { ...earlier, ...own } : undefined;
  writeSection(
    state,
    tr,
    holder,
    clean({
      ...setup,
      type: removed.type,
      headers: inherited(setup.headers, removed.headers),
      footers: inherited(setup.footers, removed.footers),
    }),
  );
}

/**
 * Removes the section break that ends the caret's section (in the last section, the one before
 * it): the paragraph joins the next, as deleting Word's break does. While tracking its mark is
 * recorded as deleted.
 */
export const removeSectionBreak: Command = (state, dispatch) => {
  const at = sectionAt(state);
  if (!at || at.count < 2) return false;
  let pos = at.pos;
  if (pos === null)
    state.doc.forEach((node, offset) => {
      if (node.attrs.section) pos = offset;
    });
  if (pos === null) return false;
  const node = state.doc.nodeAt(pos) as Node;
  if (dispatch) {
    const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
    const revision = newRevision(state);
    const end = pos + node.nodeSize;
    const next = state.doc.nodeAt(end);
    if (revision)
      tr.setNodeMarkup(pos, node.type, {
        ...node.attrs,
        revision: { ...(node.attrs.revision as object | null), deletion: revision },
      });
    else if (next?.isTextblock) {
      tr.join(end);
      keepLastMark(tr, pos, next);
      absorbSection(state, tr, node.attrs.section as SectionJSON, pos);
    } else {
      tr.setNodeMarkup(pos, node.type, { ...node.attrs, section: null });
      absorbSection(state, tr, node.attrs.section as SectionJSON, end);
    }
    dispatch(tr);
  }
  return true;
};

/** What the page setup dialog changes. `pageSize` and `margins` are merged into the section's. */
export type SectionSetup = {
  [K in "pageSize" | "margins" | "columns" | "type"]?: SectionJSON[K] | undefined;
};

/**
 * Changes the page setup of the caret's section. Not when the result has no room for text. While
 * tracking it is recorded with the setup before it (`w:sectPrChange`), once: later changes keep
 * the first record, as Word's does.
 */
export function setSectionSetup(setup: SectionSetup): Command {
  return (state, dispatch) => {
    const at = sectionAt(state);
    if (!at) return false;
    const { setup: current } = at;
    const next = clean({
      ...current,
      ...setup,
      pageSize: setup.pageSize ? { ...current.pageSize, ...setup.pageSize } : current.pageSize,
      margins: setup.margins ? { ...current.margins, ...setup.margins } : current.margins,
    });
    if (deepEqual(next, current) || checkSection(next)) return false;
    const m = next.margins ?? {};
    const height =
      (next.pageSize?.height ?? LETTER.height) -
      Math.abs(m.top ?? LETTER.margin) -
      Math.abs(m.bottom ?? LETTER.margin);
    const { widths, gaps } = sectionColumns(next);
    const used = [...widths, ...gaps].reduce((sum, width) => sum + width, 0);
    if (height <= 0 || textWidth(next) <= 0 || used > textWidth(next) + widths.length) return false;
    if (dispatch) {
      const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
      const revision = newRevision(state);
      if (revision && !current.change)
        next.change = {
          ...revision,
          // What the change can restore: the references stay with the section.
          previous: clean({
            ...current,
            ext: undefined,
            headers: undefined,
            footers: undefined,
          }),
        };
      const holder =
        at.pos === null ? null : { pos: at.pos, node: state.doc.nodeAt(at.pos) as Node };
      writeSection(state, tr, holder, next);
      dispatch(tr);
    }
    return true;
  };
}

/** `section` once its tracked setup change is accepted, or rejected. */
export function resolveSectionChange(section: SectionJSON, accept: boolean): SectionJSON {
  const { change, ...rest } = section;
  if (accept || !change) return rest;
  return clean({
    ...change.previous,
    headers: section.headers,
    footers: section.footers,
    ext: section.ext,
  });
}
