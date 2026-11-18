/**
 * Footnotes and endnotes (11.10, ADR-0007). A note is a story (`footnote:<id>`, `endnote:<id>`)
 * with one `noteReference` in the body. Numbers come from document order and the note properties
 * of the settings and sections, and are never stored: `noteNumbers` works them out, and the views
 * draw them at the reference and at the note's `noteMark`.
 *
 * As Word 16 saves them (automation, its XML): an inserted note is a run in the reference style
 * and a paragraph in the note text style holding the mark in that style, a space, the text. A
 * tracked one is `w:ins` around the reference and around everything in the note, its paragraph
 * mark not recorded; rejected, the note goes. A reference deleted while tracking is `w:del` around
 * it, and the note stays with all it holds deleted, its paragraph mark too; accepted, the note goes.
 * Word refuses a start other than 1 when numbers restart.
 */

import type { Mark, Node } from "../model/index.js";
import type { NotePropertiesJSON, SectionJSON, StoryJSON } from "../v3/document.js";
import { parseContent } from "../v3/document.js";
import { formatNumber } from "../v3/resolve.js";
import { closeHistory } from "./history.js";
import { resolveStoryChanges } from "./review.js";
import { documentSections } from "./sections.js";
import { TextSelection } from "./selection.js";
import { type Command, type EditorState, Plugin, type Transaction } from "./state.js";
import { nextRevisionId, untracked } from "./track.js";
import {
  type Story,
  StoryStep,
  setEnvelopeValue,
  storyAfter,
  storyBody,
  storyState,
  type WordEnvelope,
  withEnvelope,
  wordContext,
} from "./word.js";
import { ensureStyle } from "./wordformat.js";

export type NoteKind = "footnote" | "endnote";

const KEYS = { footnote: "footnotes", endnote: "endnotes" } as const;
/** What Word does with a property left out. */
const DEFAULTS = {
  footnote: { position: "pageBottom", format: "decimal", start: 1, restart: "continuous" },
  endnote: { position: "docEnd", format: "lowerRoman", start: 1, restart: "continuous" },
} as const;

/** The kind of note a story id names, or null. */
export function noteKindOf(id: string): NoteKind | null {
  return id.startsWith("footnote:") ? "footnote" : id.startsWith("endnote:") ? "endnote" : null;
}

/** Whether `story` is a note with a text: not one of the separators. */
export const isNote = (story: Pick<StoryJSON, "kind" | "noteType"> | undefined): boolean =>
  (story?.kind === "footnote" || story?.kind === "endnote") &&
  (story.noteType ?? "normal") === "normal";

/** The properties in force in a section: its own over the document's, over Word's defaults. */
export function noteProperties(
  envelope: Pick<WordEnvelope, "settings">,
  kind: NoteKind,
  section?: SectionJSON,
): Required<NotePropertiesJSON> {
  const key = KEYS[kind];
  return { ...DEFAULTS[kind], ...envelope.settings?.[key], ...section?.[key] };
}

/** A reference in a top-level block. */
interface BlockReference {
  story: string;
  /** From the block's start. */
  offset: number;
  customMark: boolean;
  insertion: Mark | undefined;
  deletion: Mark | undefined;
}

const NONE: readonly BlockReference[] = [];
const inBlocks = new WeakMap<Node, readonly BlockReference[]>();

/** The references in a top-level block, cached by node: most blocks are looked at on each edit. */
export function referencesIn(block: Node): readonly BlockReference[] {
  let found = inBlocks.get(block);
  if (!found) {
    const list: BlockReference[] = [];
    block.descendants((node, pos) => {
      if (node.type.name === "noteReference")
        list.push({
          story: String(node.attrs.story),
          offset: pos + 1,
          customMark: node.attrs.customMark === true,
          insertion: node.marks.find((m) => m.type.name === "insertion"),
          deletion: node.marks.find((m) => m.type.name === "deletion"),
        });
      return true;
    });
    found = list.length ? list : NONE;
    inBlocks.set(block, found);
  }
  return found;
}

/** A reference of the document with what it shows. */
export interface NoteNumber {
  story: string;
  kind: NoteKind;
  /** Its position in the body. */
  pos: number;
  /** Its section's place in the document. */
  section: number;
  /** What it shows: "" for a custom mark (the text after it is the mark). */
  text: string;
  /** Deleted as a tracked change. */
  deleted: boolean;
  customMark: boolean;
}

export interface NoteNumberOptions {
  /** The page a position is on: numbers restarting on each page need it. */
  pageOf?: (pos: number, story: string) => number | undefined;
  /** Deleted references count for nothing (the views that show the changes as accepted). */
  hideDeleted?: boolean;
}

/**
 * Every note reference of `doc` in document order with its number: a counter per kind, from each
 * section's properties. A custom mark takes no number, as in Word; the others go on past it.
 */
export function noteNumbers(
  doc: Node,
  envelope: Pick<WordEnvelope, "settings" | "section">,
  options: NoteNumberOptions = {},
): NoteNumber[] {
  const out: NoteNumber[] = [];
  const counters: Record<
    NoteKind,
    { n: number; section: number; page: number | undefined; start: number }
  > = {
    footnote: { n: 0, section: -1, page: undefined, start: 1 },
    endnote: { n: 0, section: -1, page: undefined, start: 1 },
  };
  // A section's setup is on the paragraph ending it.
  const ends: SectionJSON[] = [];
  doc.forEach((block) => {
    const own = block.attrs.section as SectionJSON | null | undefined;
    if (own) ends.push(own);
  });
  let section = 0;
  doc.forEach((block, offset) => {
    const setup = ends[section] ?? envelope.section;
    for (const ref of referencesIn(block)) {
      const kind = noteKindOf(ref.story);
      if (!kind) continue;
      const pos = offset + ref.offset;
      const deleted = !!ref.deletion;
      const entry = { story: ref.story, kind, pos, section, deleted, customMark: ref.customMark };
      if (ref.customMark || (deleted && options.hideDeleted)) {
        out.push({ ...entry, text: "" });
        continue;
      }
      const properties = noteProperties(envelope, kind, setup);
      const counter = counters[kind];
      const page = properties.restart === "eachPage" ? options.pageOf?.(pos, ref.story) : undefined;
      const fresh = counter.section < 0;
      const newSection = counter.section !== section;
      if (
        fresh ||
        (properties.restart === "eachSect" && newSection) ||
        (properties.restart === "eachPage" && page !== undefined && page !== counter.page)
      )
        counter.n = properties.start;
      // Continuing, a section that says another start begins there.
      else if (newSection && properties.start !== counter.start) counter.n = properties.start;
      else counter.n++;
      counter.section = section;
      counter.start = properties.start;
      counter.page = page;
      out.push({ ...entry, text: formatNumber(counter.n, properties.format) });
    }
    if (block.attrs.section) section++;
  });
  return out;
}

/** What each note's reference shows, by story. */
export const noteTexts = (numbers: readonly NoteNumber[]): Map<string, string> =>
  new Map(numbers.map((n) => [n.story, n.text]));

/** The reference at the selection: selected, just before the caret, or just after it. */
export function noteAtSelection(state: EditorState): NoteNumber | null {
  const context = wordContext(state);
  if (!context || storyBody(state)) return null;
  const { from, to } = state.selection;
  const numbers = noteNumbers(state.doc, context.envelope);
  return (
    numbers.find((n) => n.pos >= from && n.pos < to) ??
    numbers.find((n) => n.pos + 1 === from) ??
    numbers.find((n) => n.pos === from) ??
    null
  );
}

/** A number no note of `kind` has, in `state` and in what `tr` has added. */
function freshNoteId(state: EditorState, kind: NoteKind, taken: ReadonlySet<string>): string {
  let max = 0;
  const see = (id: string) => {
    if (noteKindOf(id) === kind) max = Math.max(max, Number(id.slice(kind.length + 1)) || 0);
  };
  for (const id of wordContext(state)?.stories.keys() ?? []) see(id);
  for (const id of taken) see(id);
  return `${kind}:${max + 1}`;
}

/** Makes the story ids of new notes, none used before. */
export function noteIds(state: EditorState): (kind: NoteKind) => string {
  const taken = new Set<string>();
  return (kind) => {
    const id = freshNoteId(state, kind, taken);
    taken.add(id);
    return id;
  };
}

const styleNames = (kind: NoteKind) => ({ text: `${kind} text`, reference: `${kind} reference` });

/** The note styles of `kind`, added as Word's built-ins when missing. */
function noteStyles(envelope: WordEnvelope, kind: NoteKind) {
  const names = styleNames(kind);
  const text = ensureStyle({ envelope }, names.text);
  const reference = text && ensureStyle({ envelope: text.envelope }, names.reference, "character");
  if (!text || !reference) return null;
  // The linked character style Word keeps with the paragraph style.
  const linked = ensureStyle(
    { envelope: reference.envelope },
    `${kind === "footnote" ? "Footnote" : "Endnote"} Text Char`,
    "character",
  );
  return { text: text.id, reference: reference.id, envelope: (linked ?? reference).envelope };
}

export interface InsertNoteOptions {
  /** A mark of one's own in place of a number. */
  customMark?: string;
}

/**
 * Inserts a footnote or endnote at the end of the selection: its reference in the body and a new
 * story with Word's default content, in one undo step. Not in a story: Word has no notes in those.
 */
export function insertNote(kind: NoteKind = "footnote", options: InsertNoteOptions = {}): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context || storyBody(state)) return false;
    const { $to } = state.selection;
    if (!$to.parent.inlineContent) return false;
    if (!dispatch) return true;
    const styles = noteStyles(context.envelope, kind);
    if (!styles) return false;
    const { schema } = state;
    const style = schema.mark("characterStyle", { id: styles.reference });
    const id = freshNoteId(state, kind, new Set());
    const custom = options.customMark;
    const reference = schema.node(
      "noteReference",
      { story: id, ...(custom ? { customMark: true } : {}) },
      undefined,
      [style],
    );
    const tr = state.tr.setMeta(closeHistory, true);
    const nodes = custom ? [reference, schema.text(custom, [style])] : [reference];
    tr.insert($to.pos, nodes);
    tr.setSelection(TextSelection.create(tr.doc, $to.pos + (custom ? custom.length + 1 : 1)));
    const mark = { type: "characterStyle", attrs: { id: styles.reference } };
    const story: Story = {
      kind,
      doc: parseContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { style: styles.text },
            content: [
              custom
                ? { type: "text", text: custom, marks: [mark] }
                : { type: "noteMark", marks: [mark] },
              { type: "text", text: " " },
            ],
          },
        ],
      }),
    };
    tr.step(new StoryStep(id, null, story));
    if (styles.envelope !== context.envelope) withEnvelope(tr, styles.envelope);
    dispatch(tr);
    return true;
  };
}

/** Where a selection in a note's editor belongs after opening it: after its mark and space. */
export function noteTextStart(doc: Node): number {
  const first = doc.firstChild;
  if (!first?.isTextblock) return 1;
  let at = 1;
  const mark = first.maybeChild(0);
  if (mark?.type.name !== "noteMark") return at;
  at += mark.nodeSize;
  const next = first.maybeChild(1);
  if (next?.isText && next.text?.startsWith(" ")) at += 1;
  return at;
}

/** `properties` without what says the same as leaving it out. */
function withoutDefaults(kind: NoteKind, properties: NotePropertiesJSON): NotePropertiesJSON {
  const defaults: NotePropertiesJSON = DEFAULTS[kind];
  const out: NotePropertiesJSON = {};
  for (const key of ["position", "format", "start", "restart"] as const) {
    const value = properties[key];
    if (value !== undefined && value !== defaults[key]) Object.assign(out, { [key]: value });
  }
  return out;
}

/**
 * Sets how notes of `kind` are placed and numbered, for the whole document: in the settings and in
 * every section, as Word writes them (an endnote's position only in the settings). Numbers that
 * restart start at 1: Word refuses anything else.
 */
export function setNoteProperties(kind: NoteKind, changes: NotePropertiesJSON): Command {
  const command: Command = (state, dispatch) => {
    const body = storyBody(state);
    if (body) return dispatch ? body.run(command) : body.can(command);
    const context = wordContext(state);
    if (!context) return false;
    if (!dispatch) return true;
    const key = KEYS[kind];
    const merge = (current: NotePropertiesJSON | undefined, section: boolean) => {
      const next: NotePropertiesJSON = { ...current, ...changes };
      if ((next.restart ?? "continuous") !== "continuous") delete next.start;
      if (section && kind === "endnote") delete next.position;
      return withoutDefaults(kind, next);
    };
    /** `holder` saying `value`, the key left out when it says nothing. */
    const put = <T extends { footnotes?: unknown; endnotes?: unknown }>(
      holder: T,
      value: NotePropertiesJSON,
    ): T => {
      const { [key]: _old, ...rest } = holder;
      return (Object.keys(value).length ? { ...rest, [key]: value } : rest) as T;
    };
    const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
    const settings = context.envelope.settings ?? {};
    setEnvelopeValue(state, tr, "settings", put(settings, merge(settings[key], false)));
    for (const { setup, pos } of documentSections(state)) {
      const next = put(setup, merge(setup[key], true));
      if (pos === null) setEnvelopeValue(state, tr, "section", next);
      else {
        const node = tr.doc.nodeAt(pos) as Node;
        tr.setNodeMarkup(pos, node.type, { ...node.attrs, section: next });
      }
    }
    dispatch(tr);
    return true;
  };
  return command;
}

/** The story with its styles and marks those of the other kind of note. */
function convertedStory(
  state: EditorState,
  story: Story,
  kind: NoteKind,
  from: string,
  to: string,
): Story {
  const tr = storyState(state, story.doc).tr;
  const swap = (id: unknown) => (id === from ? to : null);
  story.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const next = swap(node.attrs.style);
      if (next) tr.setNodeMarkup(pos, node.type, { ...node.attrs, style: next });
    }
    return true;
  });
  return { ...story, kind, doc: tr.doc };
}

/**
 * Turns the notes of the other kind into `to`, or only the note `story`: footnotes into endnotes
 * or back, each with a new id, in the other kind's styles, as Word's convert does.
 */
export function convertNotes(to: NoteKind, story?: string): Command {
  const command: Command = (state, dispatch) => {
    const owner = storyBody(state);
    if (owner) return dispatch ? owner.run(command) : owner.can(command);
    const context = wordContext(state);
    if (!context) return false;
    const from: NoteKind = to === "footnote" ? "endnote" : "footnote";
    const picked = noteNumbers(state.doc, context.envelope).filter(
      (n) => n.kind === from && (story === undefined || n.story === story),
    );
    if (!picked.length) return false;
    if (!dispatch) return true;
    const source = noteStyles(context.envelope, from);
    const target = noteStyles(source?.envelope ?? context.envelope, to);
    if (!source || !target) return false;
    const tr = state.tr.setMeta(untracked, true).setMeta(closeHistory, true);
    const fresh = noteIds(state);
    const { schema } = state;
    const markFor = (marks: readonly Mark[]) =>
      marks.map((m) =>
        m.type.name === "characterStyle" && m.attrs.id === source.reference
          ? schema.mark("characterStyle", { id: target.reference })
          : m,
      );
    for (const { story: id, pos } of picked) {
      const node = state.doc.nodeAt(pos) as Node;
      const next = fresh(to);
      tr.delete(pos, pos + 1);
      tr.insert(pos, node.type.create({ ...node.attrs, story: next }, null, markFor(node.marks)));
      const old = storyAfter(state, tr, id);
      if (!old) continue;
      let converted = convertedStory(state, old, to, source.text, target.text);
      const marks = storyState(state, converted.doc).tr;
      converted.doc.descendants((inner, at) => {
        if (inner.type.name === "noteMark" || inner.isText) {
          const swapped = markFor(inner.marks);
          if (swapped.some((m, i) => m !== inner.marks[i])) {
            marks.delete(at, at + inner.nodeSize);
            marks.insert(at, inner.mark(swapped));
          }
        }
        return true;
      });
      converted = { ...converted, doc: marks.doc };
      tr.step(new StoryStep(id, old, null));
      tr.step(new StoryStep(next, null, converted));
    }
    if (target.envelope !== context.envelope) withEnvelope(tr, target.envelope);
    dispatch(tr);
    return true;
  };
  return command;
}

/** `story` with everything in it recorded as a tracked change `mark`, as Word's reference is. */
function allTracked(state: EditorState, story: Story, mark: Mark, marksParagraph: boolean): Story {
  const tr = storyState(state, story.doc).tr;
  const name = mark.type.name;
  const revision = { id: mark.attrs.id, author: mark.attrs.author, date: mark.attrs.date };
  story.doc.descendants((node, pos) => {
    if (node.isInline) {
      if (!MARKERS.has(node.type.name) && !node.marks.some((m) => m.type.name === name))
        tr.addMark(pos, pos + node.nodeSize, mark);
      return false;
    }
    if (node.isTextblock && marksParagraph) {
      const current = (node.attrs.revision as Record<string, unknown> | null) ?? {};
      tr.setNodeMarkup(pos, node.type, {
        ...node.attrs,
        revision: { ...current, [name]: revision },
      });
    }
    return true;
  });
  return { ...story, doc: tr.doc };
}

/** Inline nodes a tracked change does not mark. */
const MARKERS = new Set([
  "bookmarkStart",
  "bookmarkEnd",
  "commentStart",
  "commentEnd",
  "controlStart",
  "controlEnd",
]);

/** The body's references by story. */
function referenceMap(doc: Node): Map<string, BlockReference> {
  const out = new Map<string, BlockReference>();
  doc.forEach((block) => {
    for (const ref of referencesIn(block)) out.set(ref.story, ref);
  });
  return out;
}

/**
 * Keeps notes with their references, in the transaction's undo step: a reference that goes takes
 * its note; one recorded as inserted or deleted has what the note holds recorded too; and a
 * recorded reference accepted or rejected, and staying, settles the note's record with it.
 */
export function notesPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, before, after) {
      if (before.doc === after.doc || transactions.some((t) => t.getMeta("historyOp"))) return null;
      const context = wordContext(after);
      if (!context || ![...context.stories.values()].some(isNote)) return null;
      const was = referenceMap(before.doc);
      const now = referenceMap(after.doc);
      const tr: Transaction = after.tr.setMeta(untracked, true);
      let revision = -1;
      const changed = (mark: Mark) => {
        if (revision < 0) revision = nextRevisionId(after);
        return mark.type.create({ ...mark.attrs, id: revision++ });
      };
      for (const [id, old] of was) {
        const story = storyAfter(after, tr, id);
        if (!story || !isNote(story)) continue;
        const ref = now.get(id);
        if (!ref) {
          tr.step(new StoryStep(id, story, null));
          continue;
        }
        if (ref.deletion && !old.deletion)
          tr.step(new StoryStep(id, story, allTracked(after, story, changed(ref.deletion), true)));
        if (old.deletion && !ref.deletion) resolveStoryChanges(after, tr, id, false, "deletion");
        if (old.insertion && !ref.insertion) resolveStoryChanges(after, tr, id, true, "insertion");
      }
      for (const [id, ref] of now) {
        const story = storyAfter(after, tr, id);
        if (was.has(id) || !ref.insertion || !story || !isNote(story)) continue;
        tr.step(new StoryStep(id, story, allTracked(after, story, changed(ref.insertion), false)));
      }
      return tr.steps.length ? tr : null;
    },
  });
}
