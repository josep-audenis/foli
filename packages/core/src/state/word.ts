/**
 * Editing a schema v3 document as Word edits it (8.7). An editor holding a v3 document keeps
 * the document's envelope (styles, numbering, defaults, theme) in a plugin state field, and the
 * generic commands consult it: Enter splits a paragraph as Word does, the bold, italic,
 * underline and strike toggles act on the formatting text shows (a heading's style bold
 * included), and Backspace and Delete step over the invisible markers (bookmarks, comment
 * ranges) and select opaque content before deleting it.
 *
 * shortcut: v2 and v3 editing live side by side until 8.7d makes v3 the only schema; then these
 * become the commands themselves.
 */
import type { Attrs, Mark, MarkType, Node } from "../model/index.js";
import type { FoliDocumentV3 } from "../v3/document.js";
import { Resolver, type RunFormat } from "../v3/resolve.js";
import { MARK_ATTRS } from "./mark.js";
import { NodeSelection, TextSelection } from "./selection.js";
import { type EditorState, Plugin, PluginKey, type Transaction } from "./state.js";

/** A v3 document without its content: what the editor keeps beside the edited tree. */
export type WordEnvelope = Omit<FoliDocumentV3, "content">;

export interface WordContext {
  readonly envelope: WordEnvelope;
  readonly resolver: Resolver;
}

const key = new PluginKey<WordContext>("word");

/**
 * The plugin that gives commands a v3 document's envelope. A transaction changes it with
 * `withEnvelope` (a new list's numbering definition); undo leaves such additions, as Word does.
 */
export function wordPlugin(envelope: WordEnvelope): Plugin<WordContext> {
  const context: WordContext = { envelope, resolver: new Resolver(envelope) };
  return new Plugin({
    key,
    state: {
      init: () => context,
      apply: (tr, value) => {
        const next = tr.getMeta(key) as WordEnvelope | undefined;
        return next ? { envelope: next, resolver: new Resolver(next) } : value;
      },
    },
  });
}

/** Makes `tr` change the document's envelope to `envelope` (styles, numbering…). */
export function withEnvelope(tr: Transaction, envelope: WordEnvelope): Transaction {
  return tr.setMeta(key, envelope);
}

/** The envelope and resolver of the v3 document in `state`, or null for a v2 editor. */
export function wordContext(state: EditorState): WordContext | null {
  return key.getState(state) ?? null;
}

/**
 * What the paragraph mark carries alone (`MARK_ATTRS`): a split leaves it on the second
 * paragraph, which keeps the original mark.
 */
const MARK_ONLY = Object.fromEntries(MARK_ATTRS.map((key) => [key, null]));

/** The id of the default paragraph style: the last one marked default, as `Resolver` reads it. */
function defaultParagraphStyle(envelope: WordEnvelope): string | undefined {
  let id: string | undefined;
  for (const style of envelope.styles)
    if (style.type === "paragraph" && style.isDefault) id = style.id;
  return id;
}

/**
 * The attributes of the two paragraphs Enter makes of `paragraph`. The first gets a new mark
 * with the same properties; the second keeps the original mark. At the end of a paragraph whose
 * style names another as the next (a heading: Normal), the second paragraph is in that style,
 * without the first's direct formatting. `before` is null when the first keeps every attribute.
 */
export function splitAttrs(
  context: WordContext,
  paragraph: Node,
  atEnd: boolean,
): { before: Attrs | null; after: Attrs } {
  const attrs = paragraph.attrs;
  const markOnly = Object.keys(MARK_ONLY).some((k) => attrs[k] !== null);
  const before = markOnly ? { ...attrs, ...MARK_ONLY } : null;
  if (!atEnd) return { before, after: attrs };
  const id = (attrs.style as string | null) ?? defaultParagraphStyle(context.envelope);
  const style = context.envelope.styles.find((s) => s.id === id);
  const next = style?.next;
  if (next === undefined || next === id) return { before, after: attrs };
  const mark = Object.fromEntries(Object.keys(MARK_ONLY).map((k) => [k, attrs[k] ?? null]));
  return { before, after: { ...mark, style: next } };
}

/** Run toggles: whether text shows the property, from its resolved formatting. */
const TOGGLES: Record<string, (run: RunFormat) => boolean> = {
  bold: (run) => run.bold,
  italic: (run) => run.italic,
  underline: (run) => run.underline !== null,
  strike: (run) => run.strike,
  doubleStrike: (run) => run.doubleStrike,
  caps: (run) => run.caps,
  smallCaps: (run) => run.smallCaps,
  hidden: (run) => run.hidden,
};

/** Whether `type` is a run property the toggles handle on a v3 document. */
export function isWordToggle(context: WordContext | null, type: MarkType): boolean {
  return context !== null && Object.hasOwn(TOGGLES, type.name);
}

/** Whether text with `marks` in `paragraph` shows the toggle `type` (marks included or not). */
function shows(
  context: WordContext,
  paragraph: Node,
  marks: readonly Mark[],
  type: MarkType,
  own = true,
): boolean {
  const { run } = context.resolver.paragraph(paragraph.attrs);
  const json = marks.filter((m) => own || m.type !== type).map((m) => m.toJSON());
  return (TOGGLES[type.name] as (run: RunFormat) => boolean)(context.resolver.run(run, json));
}

/**
 * The direct mark that makes text show the toggle `type` as `on`, given what it shows without
 * one (`inherited`); null when no mark is needed. Bold and italic keep their complex-script twin.
 */
function directMark(type: MarkType, on: boolean, inherited: boolean, existing?: Mark): Mark | null {
  const twin = existing?.attrs.complexScript ?? null;
  const hasTwin = Object.hasOwn(type.spec.attrs ?? {}, "complexScript");
  if (on === inherited)
    return hasTwin && twin !== null ? type.create({ value: null, complexScript: twin }) : null;
  if (type.name === "underline") return type.create({ style: on ? "single" : "none" });
  return type.create(hasTwin ? { value: on, complexScript: twin } : { value: on });
}

/**
 * The inline nodes a toggle formats in a range (not markers: nothing to format), and those it
 * judges: text nodes, or every one when there is none.
 */
function inlineIn(state: EditorState, from: number, to: number, type: MarkType) {
  const found: { node: Node; pos: number; parent: Node }[] = [];
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isInline || !parent?.type.allowsMarkType(type)) return undefined;
    if (MARKERS.has(node.type.name)) return false;
    found.push({ node, pos, parent });
    return false;
  });
  const text = found.filter((f) => f.node.isText);
  return text.length ? { all: found, judged: text } : { all: found, judged: found };
}

/** Whether all the selected text (or the text typed at a caret) shows the toggle `type`. */
export function wordToggleActive(
  context: WordContext,
  state: EditorState,
  type: MarkType,
  caretMarks: readonly Mark[] | null,
): boolean {
  const { selection } = state;
  if (caretMarks) return shows(context, selection.$from.parent, caretMarks, type);
  const { judged } = inlineIn(state, selection.from, selection.to, type);
  return judged.length > 0 && judged.every((f) => shows(context, f.parent, f.node.marks, type));
}

/**
 * The stored marks for a toggle at a caret: what makes the next typed text show the opposite of
 * what text typed there would show now.
 */
export function toggledCaretMarks(
  context: WordContext,
  paragraph: Node,
  marks: readonly Mark[],
  type: MarkType,
): readonly Mark[] {
  const on = !shows(context, paragraph, marks, type);
  const existing = type.isInSet(marks);
  const rest = existing ? existing.removeFromSet(marks) : marks;
  const mark = directMark(type, on, shows(context, paragraph, marks, type, false), existing);
  return mark ? mark.addToSet(rest) : rest;
}

/**
 * The mark changes that make every inline node in `from..to` show the toggle `type` as `on`:
 * per node, a direct mark where its style does not already give that, none where it does.
 */
export function toggleRanges(
  context: WordContext,
  state: EditorState,
  from: number,
  to: number,
  type: MarkType,
  on: boolean,
): { from: number; to: number; mark: Mark | null }[] {
  return inlineIn(state, from, to, type).all.map(({ node, pos, parent }) => ({
    from: Math.max(from, pos),
    to: Math.min(to, pos + node.nodeSize),
    mark: directMark(
      type,
      on,
      shows(context, parent, node.marks, type, false),
      type.isInSet(node.marks),
    ),
  }));
}

/** Zero-width markers: nothing to see, so the caret and deletion step over them. */
const MARKERS = new Set([
  "bookmarkStart",
  "bookmarkEnd",
  "commentStart",
  "commentEnd",
  // A comment's reference mark: deleting it would take the comment's anchor.
  "commentReference",
]);

/** Whether `node` is an invisible marker of a v3 document. */
export function isMarker(context: WordContext | null, node: Node | null | undefined): boolean {
  return context !== null && !!node && MARKERS.has(node.type.name);
}

/** Opaque content: deleted only once selected, as Word selects a field before deleting it. */
export function isOpaque(context: WordContext | null, node: Node | null | undefined): boolean {
  return (
    context !== null &&
    !!node &&
    (node.type.name === "opaqueInline" || node.type.name === "opaqueBlock")
  );
}

/** A node selection of the node at `pos`, or a text selection when it cannot be selected. */
export function selectionAt(state: EditorState, pos: number): NodeSelection | TextSelection {
  const node = state.doc.nodeAt(pos);
  return node && NodeSelection.isSelectable(node)
    ? NodeSelection.create(state.doc, pos)
    : TextSelection.create(state.doc, pos);
}
