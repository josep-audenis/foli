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
import { Mapping } from "../transform/stepmap.js";
import { TransformError } from "../transform/transform.js";
import type { ControlJSON } from "../v3/document.js";
import { attempt } from "./attempt.js";
import { insertHardBreak, insertText } from "./commands.js";
import { formatDatePicture } from "./fieldupdate.js";
import { closeHistory, joinHistory } from "./history.js";
import { marksAt, Selection, TextSelection } from "./selection.js";
import { type Command, type EditorState, Plugin, type Transaction } from "./state.js";
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

/** On a transaction: `value` fills a control, `accept` accepts tracked changes. */
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

/** Whether `from..to` touches content that may not be edited. */
export function readOnlyAt(
  tree: Node,
  controls: Controls | undefined,
  from: number,
  to: number,
): boolean {
  if (!controls) return false;
  return controlsIn(tree).some((range) => {
    const control = Object.hasOwn(controls, range.id) ? controls[range.id] : undefined;
    return (
      !!control &&
      controlIsReadOnly(control) &&
      range.from < Math.max(to, from + 1) &&
      from < range.to
    );
  });
}

const contentOf = (tree: Node, range: ControlRange): Fragment =>
  range.level === "inline"
    ? tree.slice(range.from + 1, range.to - 1).content
    : tree.slice(range.from, range.to).content;

/** The range of `after` that is `range` of `before`: the same control, the same in order. */
function partner(
  range: ControlRange,
  before: readonly ControlRange[],
  after: readonly ControlRange[],
): ControlRange | undefined {
  const same = (r: ControlRange) => r.id === range.id;
  return after.filter(same)[before.filter(same).indexOf(range)];
}

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
  const single = tree.nodeAt(range.from);
  if (
    range.level !== "inline" &&
    !(single?.isTextblock && single.nodeSize === range.to - range.from)
  )
    return false;
  const had = new Set(was.map((n) => n.type.name));
  return inlineNodes(tree, range).every(
    (node) =>
      node.isText ||
      had.has(node.type.name) ||
      (node.type.name === "hardBreak" && control.multiLine === true),
  );
}

/** Whether `tr` keeps what the controls of `state` require. */
function allowed(tr: Transaction, state: EditorState): boolean {
  if (!tr.docChanged || tr.doc === state.doc || tr.getMeta("historyOp")) return true;
  const controls = wordContext(state)?.envelope.controls;
  if (!controls) return true;
  const before = scan(state.doc);
  if (!before.ranges.length) return true;
  const after = scan(tr.doc);
  const edit = tr.getMeta(controlEdit);
  for (const range of before.ranges) {
    const control = Object.hasOwn(controls, range.id) ? controls[range.id] : undefined;
    if (!control) continue;
    // A paragraph mark cannot go inside an inline control, nor half of one be deleted.
    if (after.unpaired.has(range.id) && !before.unpaired.has(range.id)) return false;
    const now = partner(range, before.ranges, after.ranges);
    if (!now) {
      if (LOCKED_CONTROL.has(control.lock ?? "")) return false;
      continue;
    }
    const same = contentOf(state.doc, range).eq(contentOf(tr.doc, now));
    if (same) continue;
    if (controlIsReadOnly(control) && edit !== "accept") return false;
    if (CHOICE_KINDS.has(control.kind) && !edit) return false;
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
function isEmpty(tree: Node, range: ControlRange, tr: Transaction): boolean {
  const from = tr.mapping.map(range.from, 1);
  const to = tr.mapping.map(range.to, -1);
  return to - from === 2 && (range.level === "inline" || !!tree.nodeAt(from)?.isTextblock);
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
 * What follows a change, added to `tr`: placeholders left or come back, a stale date, even
 * formatting. Returns the controls' properties as `tr` leaves them.
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
  const mapping = new Mapping(roots.flatMap((t) => t.mapping.maps));
  const filled = roots.some((t) => t.getMeta(controlEdit));
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
  for (const range of [...after].reverse()) {
    const control = Object.hasOwn(controls, range.id) ? controls[range.id] : undefined;
    const earlier = before.find((r) => r.id === range.id && partner(r, before, after) === range);
    if (!control || !earlier) continue;
    if (contentOf(old.doc, earlier).eq(contentOf(state.doc, range))) continue;
    const emptied = () => isEmpty(tr.doc, range, tr);
    if (oldControls[range.id]?.placeholder?.showing) {
      // What remains of the placeholder goes (tracking keeps a deleted copy: Word records none).
      const start = tr.mapping.map(mapping.map(earlier.contentFrom, 1), 1);
      const end = tr.mapping.map(mapping.map(earlier.contentTo, -1), -1);
      if (start < end) tr.delete(start, end);
      if (emptied() && !NO_PLACEHOLDER.has(control.kind)) {
        showPlaceholder(range, control);
        continue;
      }
      // The text put there does not look like it.
      const style = placeholderId({ envelope });
      const mark = style && tr.doc.type.schema.marks.characterStyle?.create({ id: style });
      const a = tr.mapping.map(range.contentFrom, -1);
      const b = tr.mapping.map(range.contentTo, 1);
      if (mark && a < b) tr.removeMark(a, b, mark);
      if (control.placeholder?.showing)
        set(range.id, { ...control, placeholder: { ...control.placeholder, showing: false } });
      continue;
    }
    if (emptied() && !NO_PLACEHOLDER.has(control.kind)) {
      showPlaceholder(range, control);
      continue;
    }
    if (filled) continue;
    if (
      control.kind === "date" &&
      control.date &&
      textIn(state.doc, range) !== formatDate(control, control.date)
    ) {
      const { date: _date, ...rest } = control;
      set(range.id, rest);
    }
    if (TEXT_KINDS.has(control.kind)) {
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

/** The rules of content controls (ADR-0007), in every editor of a document. */
export function controlsPlugin(): Plugin {
  return new Plugin({
    filterTransaction: allowed,
    appendTransaction(transactions, before, after) {
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
        ? { content: contentOf(state.doc, range).toJSON() }
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
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const day = typeof value === "string" ? /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] : undefined;
  return day && !Number.isNaN(Date.parse(day)) ? day : null;
}

function formatDate(control: ControlJSON, date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  return formatDatePicture(new Date(y, m - 1, d), control.dateFormat ?? "d MMMM yyyy");
}

const glyph = (state: { value: string }) => String.fromCodePoint(Number.parseInt(state.value, 16));

/** The inline nodes of `text`: line breaks as breaks where the control takes them. */
function textNodes(state: EditorState, text: string, marks: readonly Mark[]): Node[] {
  const { schema } = state;
  return text
    .split("\n")
    .flatMap((line, i) => [
      ...(i ? [schema.nodes.hardBreak?.create(null, null, marks) as Node] : []),
      ...(line ? [schema.text(line, marks)] : []),
    ]);
}

/** The first run's formatting: what a new value keeps of the old one. */
function valueMarks(tree: Node, range: ControlRange, control: ControlJSON): readonly Mark[] {
  if (control.placeholder?.showing) return [];
  const run = inlineNodes(tree, range).find((n) => n.isText);
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
  const marks = valueMarks(state.doc, range, control);
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
      const nodes = value.content.map((json) => state.schema.nodeFromJSON(json));
      if (!nodes.length) return { nodes, control };
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
      return nodes.every((n) => n.isBlock) ? { nodes, blocks: true, control: shown } : null;
    }
    case "dropDown":
    case "comboBox": {
      if (typeof value !== "string") return null;
      const item = control.items?.find((i) => i.value === value || i.display === value);
      if (!item && control.kind === "dropDown") return null;
      return text(item ? (item.display ?? item.value) : value);
    }
    case "date": {
      const day = dayOf(value);
      if (day) {
        const date = `${day}T00:00:00Z`;
        return { ...text(formatDate(control, date)), control: { ...shown, date } };
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
    return attempt(state, dispatch, (tr) => {
      tr.setMeta(controlEdit, "value").setMeta(join ? joinHistory : closeHistory, true);
      const controls: Record<string, ControlJSON> = { ...context.envelope.controls };
      for (const { range, next } of [...found].reverse()) {
        controls[range.id] = next.control;
        const wholeBlocks = next.blocks;
        const blockAttrs = wholeBlocks
          ? (state.doc.nodeAt(range.from)?.attrs.controls as string[])
          : null;
        const nodes = wholeBlocks
          ? next.nodes.map((n) =>
              n.type.create({ ...n.attrs, controls: blockAttrs }, n.content, n.marks),
            )
          : next.nodes;
        const [from, to] = wholeBlocks
          ? [range.from, range.to]
          : [range.contentFrom, range.contentTo];
        if (range.level !== "inline" && !wholeBlocks && !state.doc.nodeAt(range.from)?.isTextblock)
          throw new TransformError("Only a paragraph takes a value here");
        if (to > from) tr.delete(from, to);
        if (nodes.length) tr.insert(from, nodes);
      }
      setEnvelopeValue(state, tr, "controls", controls);
    });
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

/** A control's properties for a copy of it: Word gives the copy a `w:id` of its own. */
export function copiedControl(control: ControlJSON): ControlJSON {
  return control.ext
    ? { ...control, ext: control.ext.replace(/<[\w.-]+:id\b[^>]*\/>/, "") }
    : control;
}

/** An id no control of `controls` has. */
export function freshControlId(controls: Controls | undefined): string {
  let n = Object.keys(controls ?? {}).length + 1;
  while (Object.hasOwn(controls ?? {}, `control-${n}`)) n++;
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
    const id = freshControlId(envelope.controls);
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
        const marks = valueMarks(state.doc, range, control);
        tr.delete(range.contentFrom, range.contentTo);
        tr.insert(range.contentFrom, textNodes(state, formatDate(next, next.date), marks));
      }
    });
  };
}

/**
 * A repeating section gets another item after the caret's (or its last), a copy of it as in Word,
 * the controls in it copied too under new ids.
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
    if (!section) return false;
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
        copy = freshControlId({ ...controls, ...added });
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
        ...(json.content ? { content: json.content.map(renamed) } : {}),
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
