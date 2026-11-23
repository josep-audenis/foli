/**
 * Word's content controls in the editor (ADR-0007, 11.9). Inline ones are `controlStart` and
 * `controlEnd` markers, block, row and cell ones the `controls` attribute; their properties are the
 * envelope's `controls`, changed through `EnvelopeStep`s so undo takes them back.
 *
 * The rules are Word's, checked through its object model (`scripts/corpus/control-roundtrip.mjs`,
 * ADR-0007): a filter compares what a transaction leaves with what was there, so it holds for
 * typing, paste, deletion, tracked changes and code alike; undo passes.
 */

import {
  FoliDocumentError,
  Fragment,
  type Mark,
  type MarkType,
  type Node,
  type NodeJSON,
  Slice,
} from "../model/index.js";
import { isSafeLink } from "../schema.js";
import { Mapping } from "../transform/stepmap.js";
import { TransformError } from "../transform/transform.js";
import type { ControlJSON } from "../v3/document.js";
import { parseContent } from "../v3/document.js";
import { writeCustom } from "../v3/extensions.js";
import { attempt } from "./attempt.js";
import { insertHardBreak, insertText } from "./commands.js";
import { formatDatePicture } from "./fieldupdate.js";
import { closeHistory, joinHistory } from "./history.js";
import { idsOf } from "./ids.js";
import { marksAt, Selection, TextSelection } from "./selection.js";
import { type Command, type EditorState, isRemote, Plugin, type Transaction } from "./state.js";
import { trackedDeletes, trackTransaction } from "./track.js";
import {
  setEnvelopeValue,
  type WordContext,
  type WordEnvelope,
  withEnvelope,
  wordContext,
} from "./word.js";
import { ensureStyle, styleNamed } from "./wordformat.js";

type Controls = Readonly<Record<string, ControlJSON>>;

/** A content control of a tree. Positions are the tree's. */
export interface ControlRange {
  readonly id: string;
  readonly level: "inline" | "block" | "row" | "cell";
  /** Before its `controlStart`, or its first block, row or cell. */
  readonly from: number;
  /** After its `controlEnd`, or its last block, row or cell. */
  readonly to: number;
  /** The first and last places a caret has in it. */
  readonly contentFrom: number;
  readonly contentTo: number;
}

/**
 * On a transaction: `value` fills a control, `accept` and `reject` resolve tracked changes, `fields`
 * updates fields: what Word lets through where typing is refused.
 * @internal
 */
export const controlEdit = "controlEdit";

const LOCKED_CONTENT = new Set(["contentLocked", "sdtContentLocked"]);
const LOCKED_CONTROL = new Set(["sdtLocked", "sdtContentLocked"]);
/** Their content is one run of text. */
const TEXT_KINDS = new Set(["text", "comboBox", "date"]);
/** Their content changes only by choosing (a list item, the box's state). */
const CHOICE_KINDS = new Set(["dropDown", "checkbox", "picture"]);
/** They have no placeholder to come back to. */
const NO_PLACEHOLDER = new Set(["checkbox", "picture", "repeating", "repeatingItem", "other"]);
const REVIEW = new Set(["insertion", "deletion", "formatChange"]);
/** Word lets a comment be anchored anywhere: they are not what a control holds. */
const COMMENT_ANCHORS = new Set(["commentStart", "commentEnd", "commentReference"]);
const isMarkerNode = (node: Node | null | undefined) =>
  node?.type.name === "controlStart" || node?.type.name === "controlEnd";
const isDeleted = (node: Node) => node.marks.some((m) => m.type.name === "deletion");

/** Word's text for its built-in placeholders, which need no glossary entry in the file. */
const BUILT_IN: Partial<Record<ControlJSON["kind"], { docPart: string; text: string }>> = {
  text: { docPart: "DefaultPlaceholder_-1854013440", text: "Click or tap here to enter text." },
  richText: { docPart: "DefaultPlaceholder_-1854013440", text: "Click or tap here to enter text." },
  dropDown: { docPart: "DefaultPlaceholder_-1854013438", text: "Choose an item." },
  comboBox: { docPart: "DefaultPlaceholder_-1854013438", text: "Choose an item." },
  date: { docPart: "DefaultPlaceholder_-1854013437", text: "Click or tap to enter a date." },
};
/** What Word shows in an emptied control whose placeholder it cannot find. */
const BLANK_PLACEHOLDER = "     ";
const CHECKED = { value: "2612", font: "MS Gothic" };
const UNCHECKED = { value: "2610", font: "MS Gothic" };

/** Whether a control's content may not be edited: locked, or filled from bound data. */
export const controlIsReadOnly = (control: ControlJSON): boolean =>
  LOCKED_CONTENT.has(control.lock ?? "") || !!control.binding;

interface Scan {
  ranges: ControlRange[];
  /** Inline controls with a marker missing its partner in the same paragraph. */
  unpaired: Set<string>;
}
const scans = new WeakMap<Node, Scan>();

function firstCaret(tree: Node, pos: number): number {
  let at = pos;
  for (let node = tree.nodeAt(at); node; node = node.firstChild) {
    if (node.isTextblock) return at + 1;
    if (node.isLeaf) return pos;
    at++;
  }
  return pos;
}

function lastCaret(tree: Node, pos: number): number {
  let at = pos;
  for (let node = tree.resolve(at).nodeBefore; node; node = node.lastChild) {
    if (node.isTextblock) return at - 1;
    if (node.isLeaf) return pos;
    at--;
  }
  return pos;
}

function scan(tree: Node): Scan {
  const known = scans.get(tree);
  if (known) return known;
  const ranges: ControlRange[] = [];
  const unpaired = new Set<string>();
  const inline = (block: Node, start: number) => {
    const open: { id: string; at: number }[] = [];
    block.forEach((child, offset) => {
      const id = child.attrs.id as string;
      if (child.type.name === "controlStart") open.push({ id, at: start + offset });
      else if (child.type.name === "controlEnd") {
        const index = open.map((o) => o.id).lastIndexOf(id);
        if (index < 0) {
          unpaired.add(id);
          return;
        }
        const { at } = open.splice(index, 1)[0] as { at: number };
        const end = start + offset;
        ranges.push({
          id,
          level: "inline",
          from: at,
          to: end + 1,
          contentFrom: at + 1,
          contentTo: end,
        });
      }
    });
    for (const { id } of open) unpaired.add(id);
  };
  const walk = (parent: Node, start: number) => {
    const open = new Map<string, { index: number; from: number; to: number; level: string }>();
    const runs: { id: string; run: { from: number; to: number; level: string } }[] = [];
    parent.forEach((child, offset, index) => {
      const pos = start + offset;
      const end = pos + child.nodeSize;
      for (const id of (child.attrs.controls as string[] | null | undefined) ?? []) {
        const run = open.get(id);
        if (run && run.index === index - 1) {
          run.index = index;
          run.to = end;
          continue;
        }
        const name = child.type.name;
        const level = name === "tableRow" ? "row" : name === "tableCell" ? "cell" : "block";
        const fresh = { index, from: pos, to: end, level };
        open.set(id, fresh);
        runs.push({ id, run: fresh });
      }
      if (child.isTextblock) inline(child, pos + 1);
      else if (!child.isLeaf) walk(child, pos + 1);
    });
    for (const { id, run } of runs)
      ranges.push({
        id,
        level: run.level as ControlRange["level"],
        from: run.from,
        to: run.to,
        contentFrom: firstCaret(tree, run.from),
        contentTo: lastCaret(tree, run.to),
      });
  };
  walk(tree, 0);
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  const found = { ranges, unpaired };
  scans.set(tree, found);
  return found;
}

/** The content controls of `tree` in document order, outer before inner. */
export const controlsIn = (tree: Node): readonly ControlRange[] => scan(tree).ranges;

/** The innermost control with `pos` inside it (its content's edges included). */
export function controlAt(tree: Node, pos: number): ControlRange | null {
  let found: ControlRange | null = null;
  for (const range of controlsIn(tree)) {
    if (range.from >= pos) break;
    if (pos < range.to) found = range;
  }
  return found;
}

/** A control's properties. */
export const controlProperties = (state: EditorState, id: string): ControlJSON | undefined => {
  const controls = wordContext(state)?.envelope.controls;
  return controls && Object.hasOwn(controls, id) ? controls[id] : undefined;
};

/** Whether only control markers stand between two positions: one place on the screen. */
export function controlSpot(tree: Node, a: number, b: number): boolean {
  if (a === b) return true;
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  if (tree.resolve(from).parent !== tree.resolve(to).parent) return false;
  let only = true;
  tree.nodesBetween(from, to, (node) => {
    if (node.isInline && !isMarkerNode(node)) only = false;
    return only;
  });
  return only;
}

/**
 * Whether a change at `from..to` is in content that may not be edited: it touches such a control and
 * is not all inside an editable one within it. One whose own deletion is tracked does not count.
 * @internal
 */
export function readOnlyAt(
  tree: Node,
  controls: Controls | undefined,
  from: number,
  to: number,
): boolean {
  if (!controls) return false;
  const at = (id: string) => (Object.hasOwn(controls, id) ? controls[id] : undefined);
  const ranges = controlsIn(tree);
  return ranges.some((range) => {
    const control = at(range.id);
    if (!control || !controlIsReadOnly(control) || control.deleted) return false;
    if (range.from >= Math.max(to, from + 1) || from >= range.to) return false;
    return !ranges.some((inner) => {
      const own = at(inner.id);
      return (
        inner !== range &&
        inner.from >= range.from &&
        inner.to <= range.to &&
        inner.from < from &&
        to < inner.to &&
        !!own &&
        !controlIsReadOnly(own)
      );
    });
  });
}

const contentOf = (tree: Node, range: ControlRange): Fragment =>
  range.level === "inline"
    ? tree.slice(range.from + 1, range.to - 1).content
    : tree.slice(range.from, range.to).content;

/** Each control of `before` with the index in `after` of the same one (by id, then in order). */
function pairUp(
  before: readonly ControlRange[],
  after: readonly ControlRange[],
): Map<ControlRange, number> {
  const places = new Map<string, number[]>();
  after.forEach((range, i) => {
    const list = places.get(range.id);
    if (list) list.push(i);
    else places.set(range.id, [i]);
  });
  const used = new Map<string, number>();
  const pairs = new Map<ControlRange, number>();
  for (const range of before) {
    const n = used.get(range.id) ?? 0;
    used.set(range.id, n + 1);
    const at = places.get(range.id)?.[n];
    if (at !== undefined) pairs.set(range, at);
  }
  return pairs;
}

/** Where two trees differ, in each one's positions: top-level blocks they share lie outside. */
function changedSpan(a: Node, b: Node) {
  const shared = Math.min(a.childCount, b.childCount);
  let start = 0;
  let fromA = 0;
  while (start < shared && a.child(start) === b.child(start)) {
    fromA += a.child(start).nodeSize;
    start++;
  }
  const fromB = fromA;
  let toA = a.content.size;
  let toB = b.content.size;
  for (let i = 1; i <= shared - start; i++) {
    const node = a.child(a.childCount - i);
    if (node !== b.child(b.childCount - i)) break;
    toA -= node.nodeSize;
    toB -= node.nodeSize;
  }
  return { fromA, toA, fromB, toB };
}

/** The controls directly inside the one at `index` of `ranges`. */
function innerControls(ranges: readonly ControlRange[], index: number): ControlRange[] {
  const outer = ranges[index] as ControlRange;
  const inner: ControlRange[] = [];
  let end = -1;
  for (let i = index + 1; i < ranges.length; i++) {
    const range = ranges[i] as ControlRange;
    if (range.from >= outer.to) break;
    if (range.to > outer.to || range.from < end) continue;
    inner.push(range);
    end = range.to;
  }
  return inner;
}

/**
 * What a control holds of its own, as text to compare: not what the controls inside it hold, nor
 * comment anchors. `strict`: its formatting too; otherwise only its tracked changes.
 */
function signature(
  tree: Node,
  range: ControlRange,
  inner: readonly ControlRange[],
  strict: boolean,
): string {
  const [from, to] =
    range.level === "inline" ? [range.from + 1, range.to - 1] : [range.from, range.to];
  const start = (r: ControlRange) => (r.level === "inline" ? r.contentFrom : r.from);
  const end = (r: ControlRange) => (r.level === "inline" ? r.contentTo : r.to);
  const parts: string[] = [];
  let run: string | null = null;
  let at = 0;
  let marked = -1;
  tree.nodesBetween(from, to, (node, pos) => {
    while (inner[at] && pos >= end(inner[at] as ControlRange)) at++;
    const hole = inner[at];
    if (hole && pos >= start(hole)) {
      if (hole.level !== "inline" && marked !== at) {
        marked = at;
        run = null;
        parts.push(`[${hole.id}]`);
      }
      return false;
    }
    if (COMMENT_ANCHORS.has(node.type.name)) return false;
    const marks = JSON.stringify(
      node.marks
        .filter((m) => strict || m.type.name === "insertion" || m.type.name === "deletion")
        .map((m) => m.toJSON()),
    );
    if (node.isText) {
      if (run === marks) parts[parts.length - 1] += node.text ?? "";
      else parts.push(`${marks}:${node.text}`);
      run = marks;
      return false;
    }
    run = null;
    const attrs = strict || node.isInline ? JSON.stringify(node.attrs) : "";
    parts.push(`<${node.type.name}${attrs}${marks}>`);
    return true;
  });
  return parts.join("\u0001");
}

/** Whether one of `deleted` (ranges of the same tree) takes in all of `range` and goes past it. */
const deletedWhole = (range: ControlRange, deleted: readonly (readonly [number, number])[]) =>
  deleted.some(
    ([a, b]) =>
      a <= range.contentFrom &&
      b >= range.contentTo &&
      (a < range.contentFrom || b > range.contentTo),
  );

function inlineNodes(tree: Node, range: ControlRange): Node[] {
  const nodes: Node[] = [];
  contentOf(tree, range).forEach((node) => {
    if (node.isInline) nodes.push(node);
    else
      node.descendants((child) => {
        if (child.isInline) nodes.push(child);
        return true;
      });
  });
  return nodes;
}

/** Whether a text control's content is still what such a control holds. */
function holdsText(
  tree: Node,
  range: ControlRange,
  control: ControlJSON,
  was: readonly Node[],
): boolean {
  if (range.level !== "inline") {
    const first = tree.nodeAt(range.from);
    const single =
      range.level === "cell"
        ? first?.childCount === 1 && first.firstChild?.isTextblock
        : first?.isTextblock && first.nodeSize === range.to - range.from;
    if (!single) return false;
  }
  const had = new Set(was.map((n) => n.type.name));
  return inlineNodes(tree, range).every(
    (node) =>
      node.isText ||
      had.has(node.type.name) ||
      COMMENT_ANCHORS.has(node.type.name) ||
      (node.type.name === "hardBreak" && control.multiLine === true),
  );
}

/** Whether `tr` keeps what the controls of `state` require. */
function allowed(tr: Transaction, state: EditorState): boolean {
  if (!tr.docChanged || tr.doc === state.doc || tr.getMeta("historyOp") || isRemote(tr))
    return true;
  const controls = wordContext(state)?.envelope.controls;
  if (!controls) return true;
  const before = scan(state.doc);
  if (!before.ranges.length) return true;
  const after = scan(tr.doc);
  const edit = tr.getMeta(controlEdit);
  const deleted = (tr.getMeta(trackedDeletes) ?? []) as [number, number][];
  const pairs = pairUp(before.ranges, after.ranges);
  const span = changedSpan(state.doc, tr.doc);
  for (const [index, range] of before.ranges.entries()) {
    const control = Object.hasOwn(controls, range.id) ? controls[range.id] : undefined;
    if (!control) continue;
    // A paragraph mark cannot go inside an inline control, nor half of one be deleted.
    if (after.unpaired.has(range.id) && !before.unpaired.has(range.id)) return false;
    const at = pairs.get(range);
    if (at === undefined) {
      if (LOCKED_CONTROL.has(control.lock ?? "")) return false;
      continue;
    }
    if (range.to <= span.fromA || range.from >= span.toA) continue;
    const now = after.ranges[at] as ControlRange;
    if (contentOf(state.doc, range).eq(contentOf(tr.doc, now))) continue;
    // The control itself deleted while tracking: as when it is deleted, what it holds is not edited.
    if (deletedWhole(range, deleted)) {
      if (LOCKED_CONTROL.has(control.lock ?? "")) return false;
      continue;
    }
    if (edit === "fields" || edit === "accept" || edit === "reject") continue;
    const readOnly = controlIsReadOnly(control);
    if (readOnly || (CHOICE_KINDS.has(control.kind) && !edit)) {
      const was = signature(state.doc, range, innerControls(before.ranges, index), readOnly);
      if (was !== signature(tr.doc, now, innerControls(after.ranges, at), readOnly)) return false;
      continue;
    }
    if (
      TEXT_KINDS.has(control.kind) &&
      !holdsText(tr.doc, now, control, inlineNodes(state.doc, range))
    )
      return false;
  }
  return true;
}

// ---------- the placeholder ----------

function placeholderId(context: { envelope: WordEnvelope }): string | null {
  return styleNamed(context, "Placeholder Text", "character");
}

const placeholderText = (control: ControlJSON): string =>
  control.placeholder?.text ??
  (control.placeholder?.docPart?.startsWith("DefaultPlaceholder_")
    ? (BUILT_IN[control.kind]?.text ?? BLANK_PLACEHOLDER)
    : BLANK_PLACEHOLDER);

/** The placeholder's run, and the envelope with its style added when it was missing. */
function placeholderRun(
  state: EditorState,
  control: ControlJSON,
  envelope: WordEnvelope,
): { run: Node; envelope: WordEnvelope } {
  const text = placeholderText(control);
  if (text === BLANK_PLACEHOLDER) return { run: state.schema.text(text), envelope };
  const style = ensureStyle({ envelope }, "Placeholder Text", "character");
  const mark = style && state.schema.marks.characterStyle?.create({ id: style.id });
  return {
    run: state.schema.text(text, mark ? [mark] : []),
    envelope: style?.envelope ?? envelope,
  };
}

/** Whether `range` of the tree before `tr` has nothing in it now. */
const isEmpty = (range: ControlRange, tr: Transaction): boolean =>
  tr.mapping.map(range.contentFrom, 1) >= tr.mapping.map(range.contentTo, -1);

/** The formatting of text put in a control showing its placeholder (`w:sdtPr/w:rPr`). */
const formatOf = (state: EditorState, control: ControlJSON): readonly Mark[] =>
  (control.format ?? []).map((mark) => state.schema.markFromJSON(mark));

/**
 * The text of `from..to`, put in place of a placeholder: without the placeholder's style (`style`),
 * with the control's `format` where it says nothing of its own on the point.
 */
function leavePlaceholderLook(
  tr: Transaction,
  from: number,
  to: number,
  style: string | null,
  format: readonly Mark[],
): void {
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const end = pos + node.nodeSize;
    const placeholder = (mark: Mark) =>
      !!style &&
      ((mark.type.name === "characterStyle" && mark.attrs.id === style) ||
        (mark.type.name === "runExt" && String(mark.attrs.xml).includes(`"${style}"`)));
    for (const mark of node.marks) if (placeholder(mark)) tr.removeMark(pos, end, mark);
    // The text's own marks, the placeholder's style not among them, win over the control's.
    const own = node.marks.filter((m) => !placeholder(m));
    for (const mark of format)
      if (!own.some((m) => m.type === mark.type)) tr.addMark(pos, end, mark);
    return false;
  });
}

/** Whether what a check box shows is its checked state; null when it shows neither. */
function boxShowsChecked(tree: Node, range: ControlRange, control: ControlJSON): boolean | null {
  const checked = control.checkedState ?? CHECKED;
  const unchecked = control.uncheckedState ?? UNCHECKED;
  const shown = textIn(tree, range);
  if (shown === glyph(checked)) return true;
  if (shown === glyph(unchecked)) return false;
  // A symbol font's character is kept as Word's `w:sym`: its code is the state's, moved to U+F0xx.
  for (const node of inlineNodes(tree, range)) {
    const code = /:char="([0-9a-f]+)"/i.exec(String(node.attrs.xml ?? ""))?.[1];
    if (!code || isDeleted(node)) continue;
    const low = Number.parseInt(code, 16) & 0xff;
    if (low === (Number.parseInt(checked.value, 16) & 0xff)) return true;
    if (low === (Number.parseInt(unchecked.value, 16) & 0xff)) return false;
  }
  return null;
}

/** The months' names in `locale`, long and short; `null` where the platform has none. */
function monthNames(locale: string): string[][] | null {
  try {
    return ["long", "short"].map((month) => {
      const format = new Intl.DateTimeFormat(locale, {
        month: month as "long" | "short",
        timeZone: "UTC",
      });
      return Array.from({ length: 12 }, (_, m) =>
        format
          .format(Date.UTC(2024, m, 1))
          .toLowerCase()
          .replace(/\.$/, ""),
      );
    });
  } catch {
    return null;
  }
}

/** A date format's parts: text to match, a number (`d`, `MM`, `yyyy`, `h`…), a word. */
type DatePart =
  | { literal: string }
  | { digits: string; width: number }
  | { word: string; dot: boolean };

const DATE_TOKEN = /'[^']*'|am\/pm|AM\/PM|a\/p|A\/P|d+|M+|y+|[Hhms]+|[AaPp]{2}/y;

/** `format` read once, left to right: what `dateFromText` matches, part by part. */
function dateParts(format: string): DatePart[] {
  const parts: DatePart[] = [];
  for (let i = 0; i < format.length; ) {
    DATE_TOKEN.lastIndex = i;
    const token = DATE_TOKEN.exec(format)?.[0];
    if (!token) {
      parts.push({ literal: format[i] as string });
      i++;
      continue;
    }
    i += token.length;
    const c = token[0] as string;
    if (c === "'") parts.push({ literal: token.slice(1, -1) });
    else if ((c === "d" || c === "M") && token.length > 2)
      parts.push({ word: c === "M" ? token : "", dot: true });
    else if (c === "d" || c === "M" || c === "y" || /[Hhms]/.test(c))
      parts.push({ digits: /[dMy]/.test(c) ? token : "", width: Math.max(token.length, 2) });
    else parts.push({ word: "", dot: false });
  }
  return parts;
}

/**
 * The date `text` says in the control's format and language, as `w:fullDate`; null when it is not
 * one. Word reads a control's text so: a date typed, or brought back by rejecting a change.
 * Matched part by part in one pass, never through a regular expression built from the format:
 * one could backtrack for seconds on a hostile format (`hdhdhd…`; `find.ts` avoids them too).
 */
function dateFromText(control: ControlJSON, text: string): string | null {
  const locale = control.ext && /:lid\b[^>]*:val="([^"]+)"/.exec(control.ext)?.[1];
  const names = monthNames(locale || "en-US") ?? [];
  const parts = dateParts(control.dateFormat ?? "d MMMM yyyy");
  const input = text.trim();
  let [day, month, year] = [0, 0, 0];
  let at = 0;
  for (const [i, part] of parts.entries()) {
    if ("literal" in part) {
      const end = at + part.literal.length;
      if (input.slice(at, end).toLowerCase() !== part.literal.toLowerCase()) return null;
      at = end;
      continue;
    }
    const start = at;
    if ("digits" in part) {
      // Two numbers with nothing between (`ddMMyyyy`): each its format's width.
      const next = parts[i + 1];
      const end = next && "digits" in next ? start + part.width : input.length;
      while (at < end && /[0-9]/.test(input[at] as string)) at++;
      if (at === start) return null;
      const value = Number(input.slice(start, at));
      const field = part.digits;
      if (field[0] === "d") day = value;
      else if (field[0] === "y") year = value + (field.length < 3 ? 2000 : 0);
      else if (field[0] === "M") month = value;
      continue;
    }
    // An am/pm marker as people type it too: `p.m.`.
    const letter = part.word || part.dot ? /\p{L}/u : /[\p{L}.]/u;
    while (at < input.length && letter.test(input[at] as string)) at++;
    if (at === start) return null;
    const word = input.slice(start, at).toLowerCase();
    const next = parts[i + 1];
    // `MMM.` in the text, unless the format's own next text is the dot.
    if (part.dot && input[at] === "." && !(next && "literal" in next && next.literal[0] === "."))
      at++;
    if (part.word)
      for (const list of names) if (list.includes(word)) month = list.indexOf(word) + 1;
  }
  return at === input.length ? dayFromParts(year, month, day) : null;
}

/** `yyyy-mm-ddT00:00:00Z`, or null for a day the calendar does not have. */
function dayFromParts(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T00:00:00Z`;
}

/** Gives every text run of a text control the formatting a change gave one of them. */
function evenMarks(tr: Transaction, from: number, to: number, was: readonly Mark[] | null): void {
  const own = (node: Node) => node.marks.filter((m) => !REVIEW.has(m.type.name));
  const runs: { node: Node; pos: number }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) runs.push({ node, pos });
    return true;
  });
  const sameMarks = (a: readonly Mark[], b: readonly Mark[]) =>
    a.length === b.length && a.every((m) => b.some((o) => o.eq(m)));
  if (!runs.length) return;
  const first = own((runs[0] as { node: Node }).node);
  if (runs.every((r) => sameMarks(own(r.node), first))) return;
  const wanted = runs.map((r) => own(r.node)).find((m) => !was || !sameMarks(m, was)) ?? first;
  for (const { node, pos } of runs) {
    const end = pos + node.nodeSize;
    for (const mark of own(node))
      if (!wanted.some((m) => m.eq(mark))) tr.removeMark(pos, end, mark);
    for (const mark of wanted) if (!mark.isInSet(node.marks)) tr.addMark(pos, end, mark);
  }
}

/**
 * What follows a change, added to `tr`: placeholders left or come back, what a control says of its
 * content (a date, a check box) after the content moved, even formatting. Returns the controls'
 * properties as `tr` leaves them.
 */
function reconcile(
  tr: Transaction,
  roots: readonly Transaction[],
  old: EditorState,
  state: EditorState,
): Controls {
  const envelopeNow = (wordContext(state) as WordContext).envelope;
  const current = envelopeNow.controls as Controls;
  const oldControls = wordContext(old)?.envelope.controls;
  const before = controlsIn(old.doc);
  const after = controlsIn(tr.doc);
  if (!oldControls || !before.length || !after.length) return current;
  const earlierOf = new Map<ControlRange, ControlRange>();
  for (const [range, at] of pairUp(before, after)) earlierOf.set(after[at] as ControlRange, range);
  const span = changedSpan(old.doc, state.doc);
  const mapping = new Mapping(roots.flatMap((t) => t.mapping.maps));
  const edit = roots.map((t) => t.getMeta(controlEdit)).find(Boolean);
  const reviewed = edit === "accept" || edit === "reject";
  const deleted = roots.flatMap((t) => (t.getMeta(trackedDeletes) ?? []) as [number, number][]);
  let envelope = envelopeNow;
  const controls: Record<string, ControlJSON> = { ...current };
  let changed = false;
  const set = (id: string, control: ControlJSON) => {
    controls[id] = control;
    changed = true;
  };
  const showPlaceholder = (range: ControlRange, control: ControlJSON) => {
    const made = placeholderRun(state, control, envelope);
    envelope = made.envelope;
    tr.insert(tr.mapping.map(range.contentFrom, -1), made.run);
    if (!control.placeholder?.showing)
      set(range.id, { ...control, placeholder: { ...control.placeholder, showing: true } });
  };
  /** The control goes, what it holds staying. */
  const unwrap = (range: ControlRange) => {
    if (range.level === "inline") {
      tr.delete(tr.mapping.map(range.to, -1) - 1, tr.mapping.map(range.to, -1));
      const start = tr.mapping.map(range.from, 1);
      tr.delete(start, start + 1);
      return;
    }
    const doc = tr.doc;
    doc.nodesBetween(tr.mapping.map(range.from, 1), tr.mapping.map(range.to, -1), (node, pos) => {
      const ids = node.attrs.controls as string[] | null | undefined;
      if (ids?.includes(range.id)) {
        const rest = ids.filter((id) => id !== range.id);
        tr.setNodeMarkup(pos, node.type, { ...node.attrs, controls: rest.length ? rest : null });
      }
      return true;
    });
  };
  for (const range of [...after].reverse()) {
    if (range.to <= span.fromB || range.from >= span.toB) continue;
    let control = Object.hasOwn(controls, range.id) ? controls[range.id] : undefined;
    const earlier = earlierOf.get(range);
    if (!control || !earlier) continue;
    if (contentOf(old.doc, earlier).eq(contentOf(state.doc, range))) continue;
    // Deleted whole while tracking: accepting takes the control too, rejecting gives it back.
    if (deletedWhole(earlier, deleted)) {
      if (!control.deleted) set(range.id, { ...control, deleted: true });
      continue;
    }
    if (control.deleted && reviewed) {
      const { deleted: _deleted, ...rest } = control;
      if (edit === "accept" && !isEmpty(range, tr)) continue;
      set(range.id, rest);
      if (edit === "accept") {
        unwrap(range);
        continue;
      }
      control = rest;
    }
    const wasShowing = oldControls[range.id]?.placeholder?.showing === true;
    if (wasShowing) {
      // What remains of the placeholder goes (tracking keeps a deleted copy: Word records none).
      const start = tr.mapping.map(mapping.map(earlier.contentFrom, 1), 1);
      const end = tr.mapping.map(mapping.map(earlier.contentTo, -1), -1);
      if (start < end) tr.delete(start, end);
    }
    if (isEmpty(range, tr) && !NO_PLACEHOLDER.has(control.kind)) {
      showPlaceholder(range, control);
      continue;
    }
    if (wasShowing) {
      // The text put there takes the control's formatting, not the placeholder's.
      leavePlaceholderLook(
        tr,
        tr.mapping.map(range.contentFrom, -1),
        tr.mapping.map(range.contentTo, 1),
        placeholderId({ envelope }),
        formatOf(state, control),
      );
      if (control.placeholder?.showing) {
        control = { ...control, placeholder: { ...control.placeholder, showing: false } };
        set(range.id, control);
      }
    }
    if (control.kind === "checkbox" && reviewed) {
      const checked = boxShowsChecked(state.doc, range, control);
      if (checked !== null && checked !== control.checked) set(range.id, { ...control, checked });
    }
    if (edit === "value" || edit === "fields") continue;
    if (control.kind === "date") {
      const text = textIn(state.doc, range);
      if (wasShowing || text !== textIn(old.doc, earlier)) {
        const { date, ...rest } = control;
        const read = dateFromText(control, text);
        if (read !== (date ?? null)) set(range.id, read ? { ...rest, date: read } : rest);
      }
    }
    if (TEXT_KINDS.has(control.kind) && !wasShowing && !reviewed) {
      const first = inlineNodes(old.doc, earlier).find((n) => n.isText);
      evenMarks(
        tr,
        tr.mapping.map(range.contentFrom, -1),
        tr.mapping.map(range.contentTo, 1),
        first ? first.marks.filter((m) => !REVIEW.has(m.type.name)) : null,
      );
    }
  }
  if (envelope !== envelopeNow) withEnvelope(tr, envelope);
  if (!changed) return current;
  setEnvelopeValue(state, tr, "controls", controls);
  return controls;
}

/** A caret or range as the controls want it, or null when it may stay. */
function settle(
  tree: Node,
  selection: Selection,
  previous: Selection,
  sameDoc: boolean,
  controls: Controls,
): Selection | null {
  if (!(selection instanceof TextSelection)) return null;
  const ranges = controlsIn(tree);
  if (!ranges.length) return null;
  let { anchor, head } = selection;
  const within = (r: ControlRange, pos: number) => r.from < pos && pos < r.to;
  // A range with one end in an inline control and the other outside takes the control whole,
  // unless the outer end is at its edge: the same place on the screen as just inside it.
  if (anchor !== head)
    for (let round = 0, again = true; again && round < 8; round++) {
      again = false;
      for (const r of ranges) {
        if (r.level !== "inline" || within(r, anchor) === within(r, head)) continue;
        again = true;
        const anchorIn = within(r, anchor);
        const out = anchorIn ? head : anchor;
        const edge = out <= r.from ? r.contentFrom : r.contentTo;
        if (controlSpot(tree, out, edge)) {
          if (anchorIn) head = edge;
          else anchor = edge;
        } else if (anchorIn) anchor = out <= r.from ? r.to : r.from;
        else head = out <= r.from ? r.to : r.from;
      }
    }
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const range = controlAt(tree, from);
  const control = range && Object.hasOwn(controls, range.id) ? controls[range.id] : undefined;
  if (
    range &&
    control?.placeholder?.showing &&
    to < range.to &&
    range.contentFrom < range.contentTo
  ) {
    const { contentFrom, contentTo } = range;
    const whole = from === contentFrom && to === contentTo;
    const wasWhole = sameDoc && previous.from === contentFrom && previous.to === contentTo;
    if (from === to && wasWhole && (from === contentFrom || from === contentTo)) {
      // Leaving: the arrow keys and the like collapse it to one end.
      if (range.level === "inline") {
        anchor = from === contentTo ? range.to : range.from;
        head = anchor;
      } else
        return Selection.near(
          tree.resolve(from === contentTo ? range.to : range.from),
          from === contentTo ? 1 : -1,
        );
    } else if (!whole) {
      anchor = contentFrom;
      head = contentTo;
    }
  }
  return anchor === selection.anchor && head === selection.head
    ? null
    : TextSelection.create(tree, anchor, head);
}

// ---------- keys ----------

const selectContent = (
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  range: ControlRange,
) => {
  dispatch?.(
    state.tr.setSelection(TextSelection.create(state.doc, range.contentFrom, range.contentTo)),
  );
  return true;
};

const showingAt = (state: EditorState): ControlRange | null => {
  const { from, to } = state.selection;
  const range = controlAt(state.doc, from);
  return range &&
    controlProperties(state, range.id)?.placeholder?.showing &&
    from === range.contentFrom &&
    to === range.contentTo
    ? range
    : null;
};

/**
 * Backspace (`forward` false) and Delete at a control's edge, as in Word: from inside nothing
 * happens; arriving from outside selects its content; a placeholder is not deleted.
 */
const edgeKey =
  (forward: boolean): Command =>
  (state, dispatch) => {
    if (!wordContext(state)?.envelope.controls) return false;
    if (showingAt(state)) return true;
    const { selection, doc } = state;
    if (!selection.empty || !(selection instanceof TextSelection)) return false;
    const { $from } = selection;
    const next = forward ? $from.nodeAfter : $from.nodeBefore;
    if (isMarkerNode(next)) {
      const entering = next?.type.name === (forward ? "controlStart" : "controlEnd");
      if (!entering) return true;
      const range = controlAt(doc, $from.pos + (forward ? 1 : -1));
      return range ? selectContent(state, dispatch, range) : false;
    }
    if (forward ? $from.parentOffset < $from.parent.content.size : $from.parentOffset > 0)
      return false;
    const here = controlsIn(doc).filter((r) => r.level !== "inline");
    if (here.some((r) => (forward ? r.contentTo : r.contentFrom) === $from.pos)) return true;
    // At the edge of a block next to a control: its content is what the key reaches.
    const beside = forward ? $from.after() : $from.before();
    const range = here.find((r) => (forward ? r.from : r.to) === beside);
    return range ? selectContent(state, dispatch, range) : false;
  };

const enterKey: Command = (state, dispatch) => {
  const range = controlAt(state.doc, state.selection.from);
  const control = range && controlProperties(state, range.id);
  if (!range || !control) return false;
  if (showingAt(state)) return true;
  if (TEXT_KINDS.has(control.kind))
    return control.multiLine ? insertHardBreak(state, dispatch) : true;
  return range.level === "inline";
};

const spaceKey: Command = (state, dispatch) => {
  const range = controlAt(state.doc, state.selection.from);
  const control = range && controlProperties(state, range.id);
  if (!range || control?.kind !== "checkbox") return false;
  setControlValue(range.id, !control.checked)(state, dispatch);
  return true;
};

/**
 * The rules of content controls (ADR-0007), in every editor of a document.
 * @internal
 */
export function controlsPlugin(): Plugin {
  return new Plugin({
    filterTransaction: allowed,
    appendTransaction(transactions, before, after) {
      if (transactions.every(isRemote)) return null;
      const controls = wordContext(after)?.envelope.controls;
      if (!controls) return null;
      const tr = after.tr;
      const held =
        before.doc !== after.doc && !transactions.some((t) => t.getMeta("historyOp"))
          ? reconcile(tr, transactions, before, after)
          : controls;
      const selection = settle(
        tr.doc,
        tr.selection,
        before.selection,
        before.doc === after.doc,
        held,
      );
      if (selection) tr.setSelection(selection);
      return tr.steps.length || selection ? tr : null;
    },
    keymap: { Backspace: edgeKey(false), Delete: edgeKey(true), Enter: enterKey, " ": spaceKey },
  });
}

// ---------- values ----------

/** What a control holds, read back as data. */
export interface ControlValue {
  id: string;
  kind: ControlJSON["kind"];
  tag?: string;
  title?: string;
  /** The story it is in (`Editor.controlValues`); none: the body. */
  story?: string;
  showingPlaceholder: boolean;
  /** Its text, tracked deletions left out; "" while it shows its placeholder. */
  text: string;
  /**
   * Text: the text. A list: the chosen item's value (a combo box: or the text typed). A date: the
   * `yyyy-mm-dd` picked, or the text typed. A check box: whether it is checked. Null while it shows
   * its placeholder and for what holds no value of its own.
   */
  value: string | boolean | null;
  /** A rich text control's content, as nodes. */
  content?: NodeJSON[];
}

/** What `setControlValue` takes: by kind, as `ControlValue.value`; rich text may be `{ content }`. */
export type ControlValueInput = string | boolean | Date | { content: NodeJSON[] } | null;

function textIn(tree: Node, range: ControlRange): string {
  let text = "";
  let blocks = 0;
  const visit = (node: Node) => {
    if (node.isTextblock && blocks++) text += "\n";
    if (node.isInline) {
      if (isDeleted(node)) return;
      if (node.isText) text += node.text;
      else if (node.type.name === "hardBreak") text += "\n";
      else if (node.type.name === "tab") text += "\t";
      return;
    }
    node.forEach(visit);
  };
  contentOf(tree, range).forEach(visit);
  return text;
}

const shownItem = (control: ControlJSON, text: string) =>
  control.items?.find((item) => (item.display ?? item.value) === text);

/** The values of the controls of this tree, in document order (each control once). */
export function controlValues(state: EditorState): ControlValue[] {
  const seen = new Set<string>();
  const out: ControlValue[] = [];
  for (const range of controlsIn(state.doc)) {
    const control = controlProperties(state, range.id);
    if (!control || seen.has(range.id)) continue;
    seen.add(range.id);
    const showing = control.placeholder?.showing === true;
    const text = showing ? "" : textIn(state.doc, range);
    let value: ControlValue["value"] = showing ? null : text;
    if (control.kind === "checkbox") value = control.checked === true;
    else if (showing) value = null;
    else if (control.kind === "dropDown" || control.kind === "comboBox")
      value = shownItem(control, text)?.value ?? text;
    else if (control.kind === "date") value = control.date?.slice(0, 10) ?? text;
    else if (!["text", "richText"].includes(control.kind)) value = null;
    out.push({
      id: range.id,
      kind: control.kind,
      ...(control.tag !== undefined ? { tag: control.tag } : {}),
      ...(control.alias !== undefined ? { title: control.alias } : {}),
      showingPlaceholder: showing,
      text,
      value,
      ...(control.kind === "richText" && !showing
        ? {
            content: (range.level === "cell"
              ? state.doc.slice(range.from + 1, range.to - 1).content
              : contentOf(state.doc, range)
            )
              .toJSON()
              .map(writeCustom),
          }
        : {}),
    });
  }
  return out;
}

function targets(state: EditorState, target: string): ControlRange[] {
  const ranges = controlsIn(state.doc);
  const byId = ranges.filter((r) => r.id === target);
  return byId.length ? byId : ranges.filter((r) => controlProperties(state, r.id)?.tag === target);
}

/** The `yyyy-mm-dd` of a date given as a `Date` (its local day) or text starting with one. */
function dayOf(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return dayFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const parts = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return parts ? dayFromParts(Number(parts[1]), Number(parts[2]), Number(parts[3])) : null;
}

function formatDate(control: ControlJSON, date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  const day = new Date(2000, m - 1, d);
  // The constructor reads a year under 100 as 19xx.
  day.setFullYear(y, m - 1, d);
  return formatDatePicture(day, control.dateFormat ?? "d MMMM yyyy");
}

/** A check box state's character; a code that is none shows as Word's box would. */
function glyph(state: { value: string }): string {
  const code = /^[0-9a-f]{1,6}$/i.test(state.value) ? Number.parseInt(state.value, 16) : -1;
  return code >= 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
    ? String.fromCodePoint(code)
    : "\u2610";
}

/** The inline nodes of `text`: line breaks as breaks where the control takes them. */
function textNodes(state: EditorState, text: string, marks: readonly Mark[]): Node[] {
  const { schema } = state;
  return text
    .split(/\r\n?|\n/)
    .flatMap((line, i) => [
      ...(i ? [schema.nodes.hardBreak?.create(null, null, marks) as Node] : []),
      ...(line ? [schema.text(line, marks)] : []),
    ]);
}

/** The first run's formatting: what a new value keeps of the old one. */
function valueMarks(
  state: EditorState,
  range: ControlRange,
  control: ControlJSON,
): readonly Mark[] {
  if (control.placeholder?.showing) return formatOf(state, control);
  const run = inlineNodes(state.doc, range).find((n) => n.isText);
  return run ? run.marks.filter((m) => !REVIEW.has(m.type.name)) : [];
}

interface NewValue {
  nodes: Node[];
  /** Whole blocks, for a block control given rich content. */
  blocks?: boolean;
  control: ControlJSON;
}

/** The content and properties `value` gives a control; null when it cannot hold it. */
function valueFor(
  state: EditorState,
  range: ControlRange,
  control: ControlJSON,
  value: ControlValueInput,
): NewValue | null {
  if (!takesText(state.doc, range) && !(control.kind === "richText" && isBlocks(value)))
    return null;
  const marks = valueMarks(state, range, control);
  const shown = control;
  if (value === null || value === "") {
    if (control.kind === "checkbox") return null;
    return { nodes: [], control };
  }
  const text = (string: string): NewValue => ({
    nodes: textNodes(state, string, marks),
    control: shown,
  });
  switch (control.kind) {
    case "text":
      if (typeof value !== "string") return null;
      return text(control.multiLine ? value : value.replace(/\r\n?|\n/g, " "));
    case "richText": {
      if (typeof value === "string") return text(value);
      if (typeof value !== "object" || value instanceof Date) return null;
      if (!Array.isArray(value.content) || !safeContent(state, range, value.content)) return null;
      if (!value.content.length) return { nodes: [], control };
      if (range.level === "row") {
        const rows = value.content.map((json) => state.schema.nodeFromJSON(json));
        return rows.every((n) => n.type.name === "tableRow")
          ? { nodes: rows, blocks: true, control: shown }
          : null;
      }
      const nodes = value.content.every((json) => state.schema.nodes[json.type]?.isInline)
        ? value.content.map((json) => state.schema.nodeFromJSON(json))
        : blocksFrom(state, value.content);
      if (nodes.every((n) => n.isInline)) return { nodes, control: shown };
      if (range.level === "inline") {
        const only = nodes.length === 1 ? nodes[0] : undefined;
        if (!only?.isTextblock) return null;
        const inner: Node[] = [];
        only.forEach((n) => {
          inner.push(n);
        });
        return { nodes: inner, control: shown };
      }
      // Word's rule for what ends a body or a cell.
      if (nodes.at(-1)?.type.name === "table") return null;
      return { nodes, blocks: true, control: shown };
    }
    case "dropDown":
    case "comboBox": {
      if (typeof value !== "string") return null;
      const item =
        control.items?.find((i) => i.value === value) ??
        control.items?.find((i) => i.display === value);
      if (!item && control.kind === "dropDown") return null;
      return text(item ? (item.display ?? item.value) : value);
    }
    case "date": {
      const day = dayOf(value);
      if (day) {
        return { ...text(formatDate(control, day)), control: { ...shown, date: day } };
      }
      if (typeof value !== "string") return null;
      const { date: _date, ...rest } = shown;
      return { ...text(value), control: rest };
    }
    case "checkbox": {
      if (typeof value !== "boolean") return null;
      const state2 = value
        ? (control.checkedState ?? CHECKED)
        : (control.uncheckedState ?? UNCHECKED);
      const type = state.schema.marks.font;
      const font = type && state2.font ? fontMark(type, state2.font) : null;
      const kept = marks.filter((m) => m.type !== type);
      return {
        nodes: [state.schema.text(glyph(state2), font ? font.addToSet(kept) : marks)],
        control: { ...control, checked: value },
      };
    }
    default:
      return null;
  }
}

/** The ids a block, row or cell of `range` lists, up to the control's own. */
function controlChain(tree: Node, range: ControlRange): string[] {
  const ids = (tree.nodeAt(range.from)?.attrs.controls ?? []) as string[];
  return ids.slice(0, ids.indexOf(range.id) + 1);
}

/** The caret positions of a control's text are in sibling paragraphs: a value can go there. */
function takesText(tree: Node, range: ControlRange): boolean {
  if (range.level === "inline") return true;
  if (range.level === "row") return false;
  const $from = tree.resolve(range.contentFrom);
  const $to = tree.resolve(range.contentTo);
  return (
    $from.parent.isTextblock &&
    $to.parent.isTextblock &&
    $from.depth === $to.depth &&
    $from.node($from.depth - 1) === $to.node($to.depth - 1)
  );
}

const isBlocks = (value: ControlValueInput) =>
  typeof value === "object" && value !== null && "content" in value;

function blocksFrom(state: EditorState, content: readonly NodeJSON[]): Node[] {
  const blocks: Node[] = [];
  parseContent({ type: "doc", content }, { fragment: true, schema: state.schema }).forEach(
    (node) => {
      blocks.push(node);
    },
  );
  return blocks;
}

/**
 * Whether rich content from outside can go into `range`: nothing naming what the document does not
 * hold (a control that is not there or stands elsewhere, a comment, a note), no unsafe link, and in
 * a cell nothing a cell cannot hold. Its nodes are checked by the schema when they are made.
 */
function safeContent(
  state: EditorState,
  range: ControlRange,
  content: readonly NodeJSON[],
): boolean {
  const controls = wordContext(state)?.envelope.controls ?? {};
  const elsewhere = new Set(
    controlsIn(state.doc)
      .filter((r) => r === range || r.from < range.from || r.to > range.to)
      .map((r) => r.id),
  );
  const usable = (id: unknown) =>
    typeof id === "string" && Object.hasOwn(controls, id) && !elsewhere.has(id);
  // What `controlValues` reads of a block control lists the controls it stands in.
  const chain = range.level === "inline" ? [] : controlChain(state.doc, range);
  const $at = state.doc.resolve(range.contentFrom);
  let inCell = false;
  for (let d = $at.depth; d > 0; d--) inCell ||= $at.node(d).type.name === "tableCell";
  const open = new Map<string, number>();
  const check = (json: NodeJSON): boolean => {
    if (typeof json !== "object" || json === null || typeof json.type !== "string") return false;
    const attrs = json.attrs as Record<string, unknown> | undefined;
    if (COMMENT_ANCHORS.has(json.type) || json.type === "noteReference" || json.type === "noteMark")
      return false;
    if (inCell && (json.type === "pageBreak" || json.type === "columnBreak")) return false;
    if (attrs?.section) return false;
    if (json.type === "controlStart" || json.type === "controlEnd") {
      if (!usable(attrs?.id)) return false;
      const id = attrs?.id as string;
      open.set(id, (open.get(id) ?? 0) + (json.type === "controlStart" ? 1 : -1));
    }
    const ids = attrs?.controls;
    if (ids != null && !(Array.isArray(ids) && ids.every((c) => chain.includes(c) || usable(c))))
      return false;
    if (json.marks?.some((m) => m.type === "link" && !isSafeLink(m.attrs))) return false;
    return json.content === undefined || (Array.isArray(json.content) && json.content.every(check));
  };
  return content.every(check) && [...open.values()].every((n) => n === 0);
}

function fontMark(type: MarkType, font: string): Mark {
  return type.create({
    ascii: font,
    hAnsi: font,
    eastAsia: font,
    ...(font === "MS Gothic" ? { hint: "eastAsia" } : {}),
  });
}

/**
 * Fills the controls with id or tag `target` in this tree: text, a list item (its value or shown
 * text), a date (`Date` or `yyyy-mm-dd`), checked or not, rich content; null or "" empties one,
 * bringing its placeholder back. Tracked when tracking is on. What cannot take it (a locked or bound
 * control, an item not in a drop-down list) stays; false when nothing could. `join`: one undo step
 * with the change before it.
 */
export function setControlValue(target: string, value: ControlValueInput, join = false): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context?.envelope.controls) return false;
    const found: { range: ControlRange; next: NewValue }[] = [];
    try {
      for (const range of targets(state, target)) {
        const control = controlProperties(state, range.id);
        if (!control || controlIsReadOnly(control)) continue;
        const next = valueFor(state, range, control, value);
        if (next) found.push({ range, next });
      }
    } catch (error) {
      if (error instanceof FoliDocumentError) return false;
      throw error;
    }
    if (!found.length) return false;
    const tr = state.tr;
    tr.setMeta(controlEdit, "value").setMeta(join ? joinHistory : closeHistory, true);
    const controls: Record<string, ControlJSON> = { ...context.envelope.controls };
    try {
      for (const { range, next } of [...found].reverse()) {
        controls[range.id] = next.control;
        if (next.blocks) {
          const prefix = controlChain(state.doc, range);
          const inCell = range.level === "cell";
          const nodes = next.nodes.map((n) =>
            inCell
              ? n
              : n.type.create(
                  {
                    ...n.attrs,
                    controls: [
                      ...prefix,
                      ...((n.attrs.controls as string[] | null) ?? []).filter(
                        (id) => !prefix.includes(id),
                      ),
                    ],
                  },
                  n.content,
                  n.marks,
                ),
          );
          const [from, to] = inCell ? [range.from + 1, range.to - 1] : [range.from, range.to];
          tr.replace(from, to, new Slice(Fragment.fromArray(nodes), 0, 0));
        } else {
          if (range.contentTo > range.contentFrom) tr.delete(range.contentFrom, range.contentTo);
          if (next.nodes.length) tr.insert(range.contentFrom, next.nodes);
        }
      }
    } catch (error) {
      if (error instanceof TransformError) return false;
      throw error;
    }
    setEnvelopeValue(state, tr, "controls", controls);
    // Whether it holds: what the document's rules refuse is not reported as done.
    const tracked = trackTransaction(state, tr);
    if (!tracked || !state.applyTransaction(tracked).transactions.length) return false;
    dispatch?.(tr);
    return true;
  };
}

// ---------- making and changing controls ----------

export interface ControlInsertOptions {
  title?: string;
  tag?: string;
  lock?: ControlJSON["lock"];
  items?: ControlJSON["items"];
  dateFormat?: string;
  /** What it shows until it is filled (default: Word's). */
  placeholder?: string;
  checked?: boolean;
  multiLine?: boolean;
}

/**
 * A control's properties for a copy of it: Word gives the copy a `w:id` of its own.
 * @internal
 */
export function copiedControl(control: ControlJSON): ControlJSON {
  return control.ext
    ? { ...control, ext: control.ext.replace(/<[\w.-]+:id\b[^>]*\/>/, "") }
    : control;
}

/**
 * An id no control of `controls` has.
 * @internal
 */
export function freshControlId(
  controls: Controls | undefined,
  fresh: (after: number) => number = (n) => n + 1,
): string {
  let n = fresh(Object.keys(controls ?? {}).length);
  while (Object.hasOwn(controls ?? {}, `control-${n}`)) n = fresh(n);
  return `control-${n}`;
}

function newControl(kind: ControlJSON["kind"], options: ControlInsertOptions): ControlJSON {
  const built = BUILT_IN[kind];
  return {
    kind,
    ...(options.tag ? { tag: options.tag } : {}),
    ...(options.title ? { alias: options.title } : {}),
    ...(options.lock && options.lock !== "unlocked" ? { lock: options.lock } : {}),
    ...(kind === "dropDown" || kind === "comboBox" ? { items: options.items ?? [] } : {}),
    ...(kind === "date" ? { dateFormat: options.dateFormat ?? "d MMMM yyyy" } : {}),
    ...(kind === "text" && options.multiLine ? { multiLine: true } : {}),
    ...(kind === "checkbox"
      ? { checked: options.checked === true, checkedState: CHECKED, uncheckedState: UNCHECKED }
      : {}),
    ...(built
      ? {
          placeholder: {
            showing: true,
            docPart: built.docPart,
            ...(options.placeholder ? { text: options.placeholder } : {}),
          },
        }
      : {}),
  };
}

/** The blocks from `$from`'s to `$to`'s, as positions in their common parent. */
function blocksOf(state: EditorState): { from: number; to: number } | null {
  const { $from, $to } = state.selection;
  if (!$from.parent.isTextblock || !$to.parent.isTextblock || $from.depth !== $to.depth)
    return null;
  if ($from.node($from.depth - 1) !== $to.node($to.depth - 1)) return null;
  return { from: $from.before(), to: $to.after() };
}

function addToBlocks(tr: Transaction, from: number, to: number, ids: readonly string[]): void {
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (pos < from) return true;
    const controls = [...((node.attrs.controls as string[] | null) ?? []), ...ids];
    tr.setNodeMarkup(pos, node.type, { ...node.attrs, controls });
    return false;
  });
}

/**
 * Inserts a control of `kind` at the selection, as Word: at a caret an inline one showing its
 * placeholder; rich or plain text around selected text of one paragraph; rich text around whole
 * paragraphs selected; a repeating section (with its first item) around the caret's paragraphs; a
 * picture control around a selected picture.
 */
export function insertControl(
  kind: ControlJSON["kind"],
  options: ControlInsertOptions = {},
): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    if (!context || kind === "other" || kind === "repeatingItem") return false;
    const { selection, schema } = state;
    const { controlStart, controlEnd } = schema.nodes;
    if (!controlStart || !controlEnd) return false;
    const { envelope } = context;
    const id = freshControlId(envelope.controls, idsOf(state));
    const control = newControl(kind, options);
    const add = (extra: Record<string, ControlJSON>) => ({
      ...(envelope.controls ?? {}),
      ...extra,
    });
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(closeHistory, true);
      const start = controlStart.create({ id });
      const end = controlEnd.create({ id });
      const { from, to, $from, $to } = selection;
      const blocks = blocksOf(state);
      if (kind === "repeating") {
        if (!blocks) throw new TransformError("A repeating section goes around paragraphs");
        const item = `${id}-item`;
        addToBlocks(tr, blocks.from, blocks.to, [id, item]);
        setEnvelopeValue(
          state,
          tr,
          "controls",
          add({ [id]: control, [item]: { kind: "repeatingItem" } }),
        );
        return;
      }
      const filled = (): ControlJSON => ({
        ...control,
        ...(control.placeholder ? { placeholder: { ...control.placeholder, showing: false } } : {}),
      });
      if (kind === "richText" && blocks && $from.parent !== $to.parent) {
        addToBlocks(tr, blocks.from, blocks.to, [id]);
        setEnvelopeValue(state, tr, "controls", add({ [id]: filled() }));
        return;
      }
      if (kind === "picture") {
        const node = state.doc.nodeAt(from);
        if (node?.type.name !== "picture" || to !== from + node.nodeSize)
          throw new TransformError("A picture control goes around a picture");
        tr.insert(to, end).insert(from, start);
        setEnvelopeValue(state, tr, "controls", add({ [id]: control }));
        return;
      }
      const wraps = !selection.empty && $from.parent === $to.parent && $from.parent.isTextblock;
      if (wraps && (kind === "richText" || kind === "text")) {
        tr.insert(to, end).insert(from, start);
        setEnvelopeValue(state, tr, "controls", add({ [id]: filled() }));
        tr.setSelection(TextSelection.create(tr.doc, from + 1, to + 1));
        return;
      }
      if (!selection.empty) tr.deleteSelection();
      const at = tr.selection.from;
      if (!tr.doc.resolve(at).parent.isTextblock) throw new TransformError("No paragraph here");
      let inside: Node;
      let nextEnvelope = envelope;
      if (kind === "checkbox") {
        const state2 = control.checked ? CHECKED : UNCHECKED;
        inside = schema.text(glyph(state2), [fontMark(schema.marks.font as MarkType, state2.font)]);
      } else {
        const made = placeholderRun(state, control, envelope);
        inside = made.run;
        nextEnvelope = made.envelope;
      }
      tr.insert(at, [start, inside, end]);
      if (nextEnvelope !== envelope) withEnvelope(tr, nextEnvelope);
      setEnvelopeValue(state, tr, "controls", add({ [id]: control }));
      tr.setSelection(TextSelection.create(tr.doc, at + 1, at + 1 + inside.nodeSize));
    });
  };
}

export interface ControlPropertiesPatch {
  /** Title; "" removes it. */
  title?: string;
  /** Tag; "" removes it. */
  tag?: string;
  lock?: NonNullable<ControlJSON["lock"]>;
  items?: NonNullable<ControlJSON["items"]>;
  dateFormat?: string;
  multiLine?: boolean;
}

/** Changes the properties of the control with id or tag `target` (the first such). */
export function setControlProperties(target: string, patch: ControlPropertiesPatch): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const range = targets(state, target)[0];
    const control = range && controlProperties(state, range.id);
    if (!context || !range || !control) return false;
    const { alias: _alias, tag: _tag, lock: _lock, ...rest } = control;
    const title = patch.title ?? control.alias;
    const tag = patch.tag ?? control.tag;
    const lock = patch.lock ?? control.lock;
    const next: ControlJSON = {
      ...rest,
      ...(tag ? { tag } : {}),
      ...(title ? { alias: title } : {}),
      ...(lock && lock !== "unlocked" ? { lock } : {}),
      ...(patch.items && (control.kind === "dropDown" || control.kind === "comboBox")
        ? { items: patch.items }
        : {}),
      ...(patch.dateFormat && control.kind === "date" ? { dateFormat: patch.dateFormat } : {}),
      ...(patch.multiLine !== undefined && control.kind === "text"
        ? { multiLine: patch.multiLine }
        : {}),
    };
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(closeHistory, true).setMeta(controlEdit, "value");
      setEnvelopeValue(state, tr, "controls", {
        ...context.envelope.controls,
        [range.id]: next,
      });
      // A date picked shows in its new format, where the content may change.
      if (
        next.date &&
        next.dateFormat !== control.dateFormat &&
        !controlIsReadOnly(next) &&
        !next.placeholder?.showing
      ) {
        const marks = valueMarks(state, range, control);
        tr.delete(range.contentFrom, range.contentTo);
        tr.insert(range.contentFrom, textNodes(state, formatDate(next, next.date), marks));
      }
    });
  };
}

const ONCE = new Set([...COMMENT_ANCHORS, "bookmarkStart", "bookmarkEnd"]);

/**
 * A repeating section gets another item after the caret's (or its last), a copy of it as in Word,
 * the controls in it copied too under new ids. Not where the section forbids it
 * (`w15:doNotAllowInsertDeleteSection`).
 */
export function addRepeatingItem(target?: string): Command {
  return (state, dispatch) => {
    const context = wordContext(state);
    const controls = context?.envelope.controls;
    if (!controls) return false;
    const ranges = controlsIn(state.doc);
    const { from } = state.selection;
    const kindOf = (r: ControlRange) => controls[r.id]?.kind;
    const section = target
      ? targets(state, target).find((r) => kindOf(r) === "repeating")
      : ranges.filter((r) => kindOf(r) === "repeating" && r.from < from && from < r.to).at(-1);
    if (!section || controls[section.id]?.noInsertDelete) return false;
    const items = ranges.filter(
      (r) => kindOf(r) === "repeatingItem" && r.from >= section.from && r.to <= section.to,
    );
    const item = items.filter((r) => r.from < from && from < r.to).at(-1) ?? items.at(-1);
    if (!item) return false;
    const copies = new Map<string, string>();
    const added: Record<string, ControlJSON> = {};
    const fresh = (id: string): string => {
      // The section itself and what is around it stay.
      if (ranges.some((r) => r.id === id && r.from <= item.from && r.to >= item.to && r !== item))
        return id;
      let copy = copies.get(id);
      if (!copy) {
        copy = freshControlId({ ...controls, ...added }, idsOf(state));
        copies.set(id, copy);
        added[copy] = copiedControl(controls[id] as ControlJSON);
      }
      return copy;
    };
    const renamed = (json: NodeJSON): NodeJSON => {
      const attrs = json.attrs as Record<string, unknown> | undefined;
      const marker = json.type === "controlStart" || json.type === "controlEnd";
      const ids = attrs?.controls as string[] | null | undefined;
      return {
        ...json,
        ...(marker ? { attrs: { ...attrs, id: fresh(String(attrs?.id)) } } : {}),
        ...(ids ? { attrs: { ...attrs, controls: ids.map(fresh) } } : {}),
        // A bookmark's name and a comment's anchors are the document's once.
        ...(json.content
          ? { content: json.content.filter((n) => !ONCE.has(n.type)).map(renamed) }
          : {}),
      };
    };
    const nodes: Node[] = [];
    state.doc.slice(item.from, item.to).content.forEach((node) => {
      nodes.push(state.schema.nodeFromJSON(renamed(node.toJSON())));
    });
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(closeHistory, true);
      tr.insert(item.to, Fragment.fromArray(nodes));
      setEnvelopeValue(state, tr, "controls", { ...controls, ...added });
      tr.setSelection(Selection.near(tr.doc.resolve(item.to), 1));
    });
  };
}

/**
 * Pasted or dropped text into a text control: one run, its line breaks kept only where the control
 * takes them. False when the selection is not in one.
 */
export function insertControlText(text: string): Command {
  return (state, dispatch) => {
    const range = controlAt(state.doc, state.selection.from);
    const control = range && controlProperties(state, range.id);
    if (!range || !control || !TEXT_KINDS.has(control.kind)) return false;
    const line = /\r\n?|\n/;
    if (!control.multiLine) return insertText(text.split(line).join(" "))(state, dispatch);
    return attempt(state, dispatch, (tr) => {
      const marks = state.storedMarks ?? marksAt(state.selection.$from);
      const nodes = textNodes(state, text.split(line).join("\n"), marks);
      tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0));
    });
  };
}
