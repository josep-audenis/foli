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
import type { PageBordersJSON, SectionJSON, StoryJSON } from "../v3/document.js";
import { parseContent } from "../v3/document.js";
import { checkSection } from "../v3/schema.js";
import { closeHistory } from "./history.js";
import { freshId } from "./ids.js";
import { keepLastMark } from "./mark.js";
import { TextSelection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import { newRevision, nextRevisionId, untracked } from "./track.js";
import {
  EnvelopeStep,
  type Story,
  StoryStep,
  setEnvelopeValue,
  splitAttrs,
  storyAfter,
  storyBody,
  storyState,
  wordContext,
} from "./word.js";

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

/**
 * The last section's setup as `tr` leaves it.
 * @internal
 */
export function lastSection(state: EditorState, tr: Transaction): SectionJSON {
  let section = wordContext(state)?.envelope.section ?? {};
  for (const step of tr.steps)
    if (step instanceof EnvelopeStep && step.key === "section") section = step.after as SectionJSON;
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
  // In a story: the section of the body's selection.
  const body = storyBody(state);
  if (body) return sectionAt(body.state);
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
    if (!context || storyBody(state) || !(state.selection instanceof TextSelection)) return false;
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
      // The first part keeps the section as it is.
      const revision = newRevision(state);
      tr.setNodeMarkup(start, paragraph.type, {
        ...(before ?? paragraph.attrs),
        section: setup,
        ...(revision ? { revision: { insertion: revision } } : {}),
      });
      // A tracked setup change covers both parts: each records it, under an id of its own. What
      // the later part was before it starts as this break says.
      const type = kind === "nextPage" ? undefined : kind;
      const change = setup.change && {
        ...setup.change,
        id: revision ? freshId(state, revision.id) : nextRevisionId(state),
        previous: clean({ ...setup.change.previous, type }),
      };
      writeSection(
        state,
        tr,
        holderFrom(tr.doc, second),
        clean({
          ...setup,
          headers: undefined,
          footers: undefined,
          change,
          type,
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
 * @internal
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
  if (storyBody(state)) return false;
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

/**
 * What the page setup dialog changes. `pageSize` and `margins` are merged into the section's;
 * `pageBorders` and `lineNumbers` (Phase 32) replace its own, undefined removing them.
 */
export type SectionSetup = {
  [K in "pageSize" | "margins" | "columns" | "type" | "titlePage" | "pageBorders" | "lineNumbers"]?:
    | SectionJSON[K]
    | undefined;
};

/** `current` with `setup`, or null when that changes nothing or leaves no room for text. */
function setupWith(current: SectionJSON, setup: SectionSetup): SectionJSON | null {
  const next = clean({
    ...current,
    ...setup,
    pageSize: setup.pageSize ? { ...current.pageSize, ...setup.pageSize } : current.pageSize,
    margins: setup.margins ? { ...current.margins, ...setup.margins } : current.margins,
  });
  if (deepEqual(next, current) || checkSection(next)) return null;
  const m = next.margins ?? {};
  const height =
    (next.pageSize?.height ?? LETTER.height) -
    Math.abs(m.top ?? LETTER.margin) -
    Math.abs(m.bottom ?? LETTER.margin);
  const { widths, gaps } = sectionColumns(next);
  const used = [...widths, ...gaps].reduce((sum, width) => sum + width, 0);
  if (height <= 0 || textWidth(next) <= 0 || used > textWidth(next) + widths.length) return null;
  return next;
}

/**
 * Makes `tr` give the section `at` the setup `next`, recorded while tracking (once, as Word's)
 * under `id` (by default the next revision's). Whether it recorded.
 */
function writeSetup(
  state: EditorState,
  tr: Transaction,
  at: { setup: SectionJSON; pos: number | null },
  next: SectionJSON,
  id?: number,
): boolean {
  const current = at.setup;
  const revision = newRevision(state);
  const recorded = !!revision && !current.change;
  if (revision && recorded)
    next.change = {
      ...revision,
      id: id ?? revision.id,
      // What the change can restore: the references stay with the section.
      previous: clean({
        ...current,
        ext: undefined,
        headers: undefined,
        footers: undefined,
      }),
    };
  const holder = at.pos === null ? null : { pos: at.pos, node: tr.doc.nodeAt(at.pos) as Node };
  writeSection(state, tr, holder, next);
  return recorded;
}

/**
 * Changes the page setup of section `index` (by default the caret's). Not when the result has no
 * room for text. While tracking it is recorded with the setup before it (`w:sectPrChange`), once:
 * later changes keep the first record, as Word's does.
 */
export function setSectionSetup(setup: SectionSetup, index?: number): Command {
  const command: Command = (state, dispatch) => {
    const body = storyBody(state);
    if (body) return dispatch ? body.run(command) : body.can(command);
    const at = index === undefined ? sectionAt(state) : sectionNumber(state, index);
    if (!at) return false;
    const next = setupWith(at.setup, setup);
    if (!next) return false;
    if (dispatch) {
      const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
      writeSetup(state, tr, at, next);
      dispatch(tr);
    }
    return true;
  };
  return command;
}

/**
 * Sets the page borders (Design ▸ Page Borders): of the caret's section, or of every section
 * (`"document"`, Word's "Apply to: Whole document"); null removes them. One undo step; recorded
 * as a page setup change while tracking. False when nothing would change.
 */
export function setPageBorders(
  borders: PageBordersJSON | null,
  applyTo: "section" | "document" = "section",
): Command {
  const command: Command = (state, dispatch) => {
    const body = storyBody(state);
    if (body) return dispatch ? body.run(command) : body.can(command);
    const caret = sectionAt(state);
    if (!caret) return false;
    const sections = applyTo === "document" ? documentSections(state) : [caret];
    const changes = sections.flatMap((at) => {
      const next = setupWith(at.setup, { pageBorders: borders ?? undefined });
      return next ? [{ at, next }] : [];
    });
    if (!changes.length) return false;
    if (dispatch) {
      const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
      // Each section's record has an id of its own.
      let id = newRevision(state)?.id ?? 0;
      for (const { at, next } of changes)
        if (writeSetup(state, tr, at, next, id)) id = freshId(state, id);
      dispatch(tr);
    }
    return true;
  };
  return command;
}

/**
 * Sets the page color (Design ▸ Page Color, `#`-less RRGGBB), or removes it (null). The
 * document's, as in Word; not tracked (Word records no change of it). One undo step.
 */
export function setPageColor(color: string | null): Command {
  const command: Command = (state, dispatch) => {
    const body = storyBody(state);
    if (body) return dispatch ? body.run(command) : body.can(command);
    const context = wordContext(state);
    if (!context) return false;
    if (color !== null && !/^[0-9A-Fa-f]{6}$/.test(color)) return false;
    const { background, ...rest } = context.envelope.settings ?? {};
    const now = background?.color === "auto" ? undefined : background?.color;
    if (
      color === null
        ? !background
        : now?.toUpperCase() === color.toUpperCase() && !background?.themeColor && !background?.ext
    )
      return false;
    if (dispatch) {
      const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
      // Picked anew: the theme color and Fill Effects it had go (Word's Page Color does that).
      setEnvelopeValue(state, tr, "settings", {
        ...rest,
        ...(color === null ? {} : { background: { color: color.toUpperCase() } }),
      });
      dispatch(tr);
    }
    return true;
  };
  return command;
}

/** The page color (`#`-less RRGGBB), null when the document has none. */
export function pageColorOf(state: EditorState): string | null {
  const color = wordContext(storyBody(state)?.state ?? state)?.envelope.settings?.background?.color;
  return color && color !== "auto" ? color : null;
}

/** Section `index` of the document, as `sectionAt` gives the caret's. */
function sectionNumber(state: EditorState, index: number): SectionAt | null {
  const sections = documentSections(state);
  const found = sections[index];
  return found ? { setup: found.setup, pos: found.pos, index, count: sections.length } : null;
}

/** The document's sections in order, each with the paragraph holding it (the last: none). */
export function documentSections(state: EditorState): { setup: SectionJSON; pos: number | null }[] {
  const body = storyBody(state);
  if (body) return documentSections(body.state);
  const out: { setup: SectionJSON; pos: number | null }[] = [];
  state.doc.forEach((node, pos) => {
    if (node.attrs.section) out.push({ setup: node.attrs.section as SectionJSON, pos });
  });
  const last = wordContext(state)?.envelope.section;
  if (last) out.push({ setup: last, pos: null });
  return out;
}

/** A header or a footer. */
export type StorySide = "header" | "footer";
/** Which of a section's headers or footers (Word's `w:type`). */
export type StoryVariant = "default" | "first" | "even";

const REFERENCES = { header: "headers", footer: "footers" } as const;

/**
 * The story a section shows for `side` and `variant`: its own, or, linked to the previous section
 * (no reference of its own), the nearest earlier section's. Null when none has one.
 */
export function storyOfSection(
  sections: readonly SectionJSON[],
  index: number,
  side: StorySide,
  variant: StoryVariant,
): { id: string; section: number } | null {
  for (let i = Math.min(index, sections.length - 1); i >= 0; i--) {
    const id = sections[i]?.[REFERENCES[side]]?.[variant];
    if (id) return { id, section: i };
  }
  return null;
}

/**
 * The variant a page shows (ADR-0007, as Word's PDFs of the corpus show): the first page of a
 * section with a different first page, the even one on an even displayed number when the document
 * has even and odd headers, else the default.
 */
export function pageVariant(
  section: SectionJSON,
  page: { first: boolean; number: number },
  evenAndOdd: boolean,
): StoryVariant {
  if (section.titlePage && page.first) return "first";
  return evenAndOdd && page.number % 2 === 0 ? "even" : "default";
}

/** Every story id a section refers to, once per reference. */
function storyReferences(sections: readonly SectionJSON[]): string[] {
  return sections.flatMap((setup) => [
    ...Object.values(setup.headers ?? {}),
    ...Object.values(setup.footers ?? {}),
  ]);
}

/**
 * A new story id. Random, never counted: the id of a story removed since may still be a
 * relationship of the package the document came from, to another part.
 */
function freshStoryId(state: EditorState, tr: Transaction): string {
  const used = new Set<string>(wordContext(state)?.stories.keys());
  for (const id of storyReferences(documentSections(state).map((s) => s.setup))) used.add(id);
  for (const step of tr.steps) if (step instanceof StoryStep) used.add(step.id);
  for (;;) {
    const id = `rIdFoli${Math.random().toString(36).slice(2, 12)}`;
    if (!used.has(id)) return id;
  }
}

/** A copy of a story for another section: a bookmark's name is the document's only once. */
function copyOfStory(state: EditorState, story: Story): Story {
  const tr = storyState(state, story.doc).tr;
  const marks: number[] = [];
  story.doc.descendants((node, pos) => {
    if (node.type.name === "bookmarkStart" || node.type.name === "bookmarkEnd") marks.push(pos);
    return true;
  });
  for (const pos of marks.reverse()) tr.delete(pos, pos + 1);
  return { ...story, doc: tr.doc };
}

/** An empty header or footer, in the document's style for it when it has one. */
function emptyStory(state: EditorState, side: StorySide): Story {
  const style = wordContext(state)?.envelope.styles.find(
    (s) => s.type === "paragraph" && s.name?.toLowerCase() === side,
  );
  const content: StoryJSON["content"] = {
    type: "doc",
    content: [{ type: "paragraph", ...(style ? { attrs: { style: style.id } } : {}) }],
  };
  return { kind: side, doc: parseContent(content, { schema: state.schema }) };
}

/** Makes `tr` give section `index` the reference `id` for `side` and `variant` (null: none). */
function setStoryReference(
  state: EditorState,
  tr: Transaction,
  index: number,
  side: StorySide,
  variant: StoryVariant,
  id: string | null,
): void {
  const section = documentSections(state)[index] as { setup: SectionJSON; pos: number | null };
  const key = REFERENCES[side];
  const { [variant]: _old, ...others } = section.setup[key] ?? {};
  const refs = id ? { ...others, [variant]: id } : others;
  const holder =
    section.pos === null ? null : { pos: section.pos, node: state.doc.nodeAt(section.pos) as Node };
  writeSection(
    state,
    tr,
    holder,
    clean({ ...section.setup, [key]: Object.keys(refs).length ? refs : undefined }),
  );
}

/**
 * Makes sure section `index` shows a story for `side` and `variant`: when neither it nor an earlier
 * section has one, an empty one is added to the first section, which the others are linked to, as
 * Word's are. The header of a page opens on it.
 */
export function ensureStory(side: StorySide, variant: StoryVariant, index: number): Command {
  const command: Command = (state, dispatch) => {
    const body = storyBody(state);
    if (body) return dispatch ? body.run(command) : body.can(command);
    const sections = documentSections(state);
    if (!wordContext(state) || index < 0 || index >= sections.length) return false;
    if (
      storyOfSection(
        sections.map((s) => s.setup),
        index,
        side,
        variant,
      )
    )
      return false;
    if (dispatch) {
      const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
      const id = freshStoryId(state, tr);
      tr.step(new StoryStep(id, null, emptyStory(state, side)));
      setStoryReference(state, tr, 0, side, variant, id);
      dispatch(tr);
    }
    return true;
  };
  return command;
}

/**
 * Links section `index`'s header or footer to the previous section (its own story goes, when no
 * other section uses it), or unlinks it: it gets a copy of what it was showing, as in Word.
 */
export function setStoryLinked(
  side: StorySide,
  variant: StoryVariant,
  linked: boolean,
  index?: number,
): Command {
  const command: Command = (state, dispatch) => {
    const body = storyBody(state);
    if (body) return dispatch ? body.run(command) : body.can(command);
    const context = wordContext(state);
    const at = index ?? sectionAt(state)?.index;
    const sections = documentSections(state);
    if (!context || at === undefined || at < 1 || at >= sections.length) return false;
    const setups = sections.map((s) => s.setup);
    const own = setups[at]?.[REFERENCES[side]]?.[variant];
    if (linked ? !own : !!own) return false;
    if (dispatch) {
      const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
      if (own) {
        setStoryReference(state, tr, at, side, variant, null);
        // Another section's reference, or another variant's of this one, keeps it.
        const shared = storyReferences(setups).filter((id) => id === own).length > 1;
        const story = storyAfter(state, tr, own);
        if (story && !shared) tr.step(new StoryStep(own, story, null));
      } else {
        const shown = storyOfSection(setups, at - 1, side, variant);
        const copied = shown ? context.stories.get(shown.id) : undefined;
        const id = freshStoryId(state, tr);
        const story = copied ? copyOfStory(state, copied) : emptyStory(state, side);
        tr.step(new StoryStep(id, null, story));
        setStoryReference(state, tr, at, side, variant, id);
      }
      dispatch(tr);
    }
    return true;
  };
  return command;
}

/** Turns a different first page on or off for section `index` (by default the caret's). */
export const setDifferentFirstPage = (on: boolean, index?: number): Command =>
  setSectionSetup({ titlePage: on ? true : undefined }, index);

/** Turns different odd and even pages on or off, for the whole document as in Word. */
export function setDifferentEvenPages(on: boolean): Command {
  const command: Command = (state, dispatch) => {
    const body = storyBody(state);
    if (body) return dispatch ? body.run(command) : body.can(command);
    const context = wordContext(state);
    if (!context || !!context.envelope.settings?.evenAndOddHeaders === on) return false;
    if (dispatch) {
      const { evenAndOddHeaders: _old, ...rest } = context.envelope.settings ?? {};
      // Said even when off: left out, export would keep what the file says.
      const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
      setEnvelopeValue(state, tr, "settings", { ...rest, evenAndOddHeaders: on });
      dispatch(tr);
    }
    return true;
  };
  return command;
}

/**
 * `section` once its tracked setup change is accepted, or rejected.
 * @internal
 */
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
