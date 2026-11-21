import { controlsIn, type EditorState, fieldsIn, type Node } from "@folijs/core";
import { wordContext } from "@folijs/core/internal";
import type { Handles } from "./handles.js";

/** A block as an agent reads it: the document as it would be with every change accepted. */
export interface Block {
  /** Its name in the session's operations. It stays the block's across edits. */
  handle: string;
  /** `other`: content Foli does not model, or a custom block. It cannot be edited. */
  kind: "paragraph" | "table" | "other";
  /** A paragraph's style, by the name Word shows; the default style when it names none. */
  style?: string;
  /** A numbered or bulleted paragraph's marker, as Word shows it ("1.", "(a)", "•"). */
  number?: string;
  /**
   * A paragraph's text: tabs as tabs, line breaks as "\n". What is not text stands in brackets:
   * "[picture]", "[note]" (a note's reference), "[page break]", "[column break]", "[empty: Offer
   * date]" (a content control showing its placeholder, by its title), "[object]". Text deleted
   * as a tracked change, hidden text and field codes are left out. A table: "". Other: what it
   * is.
   */
  text: string;
  /** A table's size: its rows, and the cells of its longest row. */
  rows?: number;
  columns?: number;
  /** Where a block in a table is: its table's handle, row and cell in the row, from 1. */
  cell?: { table: string; row: number; column: number };
  /** How many tables it is inside: 0 in the body. */
  depth: number;
  /** It holds tracked changes not yet accepted or rejected (anyone's). */
  changed: boolean;
  /** How many comments are anchored in it. */
  comments: number;
}

type Attrs = Record<string, unknown>;

const revisionOf = (node: Node) =>
  node.attrs.revision as { insertion?: unknown; deletion?: unknown } | null | undefined;
const marked = (node: Node, name: string) =>
  node.marks.some((m) => m.type.name === name && m.attrs.value !== false);
const TRACKED = ["insertion", "deletion", "formatChange"];
/**
 * Inline nodes that draw nothing: text runs on across them, for find too. Core's own list
 * (`isUnseen`, state/fields.ts). Anything else that is not text stops a match there, so it
 * shows in the text as something no document text is.
 */
const UNSEEN = new Set([
  "fieldStart",
  "fieldCode",
  "fieldSeparator",
  "fieldEnd",
  "bookmarkStart",
  "bookmarkEnd",
  "commentStart",
  "commentEnd",
  "commentReference",
  "controlStart",
  "controlEnd",
]);
const STANDS_AS: Record<string, string> = {
  picture: "[picture]",
  noteReference: "[note]",
  pageBreak: "[page break]",
  columnBreak: "[column break]",
};

/** A stretch of the body that does not show; `label`: what shows in its place. */
interface Hidden {
  from: number;
  to: number;
  label?: string;
}

/** What of the body does not show: field codes and controls' placeholders, in order. */
function hiddenRanges(state: EditorState): Hidden[] {
  const doc = state.doc;
  const ranges: Hidden[] = fieldsIn(doc).map((f) => ({ from: f.from, to: f.codeEnd }));
  const controls = wordContext(state)?.envelope.controls;
  if (controls)
    for (const range of controlsIn(doc)) {
      const control = Object.hasOwn(controls, range.id) ? controls[range.id] : undefined;
      if (control?.placeholder?.showing)
        ranges.push({
          from: range.contentFrom,
          to: range.contentTo,
          label: `[empty: ${control.alias ?? control.tag ?? control.kind}]`,
        });
    }
  return ranges.sort((a, b) => a.from - b.from);
}

/** A paragraph's text as `Block.text` has it, and what else a read says of it. */
function paragraphText(node: Node, pos: number, hiddenAt: (at: number) => Hidden | null) {
  let text = "";
  let shown: Hidden | null = null;
  let changed = !!revisionOf(node) || !!node.attrs.formatChange;
  let comments = 0;
  node.forEach((child, offset) => {
    const name = child.type.name;
    if (name === "commentReference") comments++;
    if (TRACKED.some((mark) => marked(child, mark))) changed = true;
    const hidden = hiddenAt(pos + 1 + offset);
    if (hidden) {
      // What stands for a placeholder, once.
      if (hidden.label && shown !== hidden) text += hidden.label;
      shown = hidden;
      return;
    }
    if (marked(child, "hidden") || marked(child, "deletion")) return;
    if (child.isText) text += child.text;
    else if (name === "tab") text += "\t";
    else if (name === "hardBreak") text += "\n";
    else if (child.type.spec.text) text += child.type.spec.text(child.attrs);
    else if (!UNSEEN.has(name)) text += STANDS_AS[name] ?? "[object]";
  });
  return { text, changed, comments };
}

/**
 * @internal
 * The body's blocks in document order, a table before its cells' blocks. A paragraph, a row or a
 * table deleted as a tracked change is left out when nothing of it would stay.
 *
 * shortcut: a paragraph whose mark is deleted but that keeps text is read as its own block,
 * where Word's final view joins it with the next (which, as there, has no number of its own);
 * upgrade if agents trip on it.
 */
export function readBlocks(state: EditorState, handles: Handles): Block[] {
  const context = wordContext(state);
  const styleNames = new Map<string, string>();
  for (const style of context?.envelope.styles ?? [])
    if (style.type === "paragraph" && !styleNames.has(style.id))
      styleNames.set(style.id, style.name ?? style.id);
  const hidden = hiddenRanges(state);
  let h = 0;
  // Asked in document order only: the ranges are walked once.
  const hiddenAt = (at: number) => {
    while (h < hidden.length && (hidden[h] as Hidden).to <= at) h++;
    const range = hidden[h];
    return range && range.from <= at ? range : null;
  };

  const blocks: Block[] = [];
  /** Each read paragraph with its attributes, and whether the one before joins into it. */
  const paragraphs: { block: Block; attrs: Attrs; joined: boolean }[] = [];
  const add = (block: Omit<Block, "depth">, cell: Block["cell"], depth: number): Block => {
    const made: Block = { ...block, depth };
    if (cell) made.cell = cell;
    blocks.push(made);
    return made;
  };

  const walk = (parent: Node, start: number, cell: Block["cell"], depth: number) => {
    let joins = false;
    parent.forEach((node, offset, index) => {
      const pos = start + offset;
      const name = node.type.name;
      const joined = joins;
      joins = false;
      if (name === "paragraph") {
        const read = paragraphText(node, pos, hiddenAt);
        // A deleted mark joins its paragraph with the next one, when that is a paragraph.
        const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
        const deleted = !!revisionOf(node)?.deletion && next?.type.name === "paragraph";
        if (deleted && !read.text) {
          joins = joined;
          return;
        }
        joins = deleted;
        const block = add(
          { handle: handles.at(pos, node), kind: "paragraph", ...read },
          cell,
          depth,
        );
        paragraphs.push({ block, attrs: node.attrs as Attrs, joined });
      } else if (name === "table") {
        // Every row deleted as a tracked change: the table is not read.
        let stays = false;
        node.forEach((row) => {
          stays ||= !revisionOf(row)?.deletion;
        });
        if (!stays) return;
        const handle = handles.at(pos, node);
        const table = add(
          { handle, kind: "table", text: "", changed: false, comments: 0 },
          cell,
          depth,
        );
        let rows = 0;
        let columns = 0;
        node.forEach((row, rowOffset) => {
          if (revisionOf(row)) table.changed = true;
          if (revisionOf(row)?.deletion) return;
          rows++;
          columns = Math.max(columns, row.childCount);
          const rowStart = pos + 1 + rowOffset + 1;
          row.forEach((cellNode, cellOffset, column) => {
            const place = { table: handle, row: rows, column: column + 1 };
            walk(cellNode, rowStart + cellOffset + 1, place, depth + 1);
          });
        });
        table.rows = rows;
        table.columns = columns;
      } else {
        const text = node.type.spec.text?.(node.attrs) ?? String(node.attrs.label ?? name);
        add(
          { handle: handles.at(pos, node), kind: "other", text, changed: false, comments: 0 },
          cell,
          depth,
        );
      }
    });
  };
  walk(state.doc, 0, undefined, 0);

  if (context) {
    // As the view numbers the final text: what joins the paragraph before has no number.
    const markers = context.resolver.markers(
      paragraphs.map((p) => (p.joined ? { numbering: { id: 0 } } : p.attrs)),
    );
    paragraphs.forEach(({ block, attrs }, index) => {
      const id = context.resolver.paragraph(attrs).paragraph.style;
      if (id !== null) block.style = styleNames.get(id) ?? id;
      const marker = markers[index];
      // A bullet is a character of a symbol font, often in the private use area: one sign for all.
      const number =
        marker && (context.resolver.numberFormat(attrs) === "bullet" ? "•" : marker.text);
      if (number) block.number = number;
    });
  }
  return blocks;
}

const count = (n: number | undefined, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/**
 * Blocks as the text a model reads, a line each:
 *
 *     [b1] Title: Mutual Non-Disclosure Agreement
 *     [b2] Heading 1, 1.: Purpose
 *     [b3] Normal, changed, 2 comments: The parties wish to…
 *     [b4] table, 3 rows, 2 columns
 *     [b5]   r1 c1, Normal: Item
 *     [b9] not editable: w:sdt
 *
 * After the handle: where it is in a table, its style, its list number, `changed` when it holds
 * tracked changes, its comments; after the colon, its text. A line break inside a paragraph
 * shows as ↵, so a block is always one line.
 */
export function formatBlocks(blocks: readonly Block[]): string {
  const line = (block: Block): string => {
    const start = `[${block.handle}] ${"  ".repeat(block.depth)}`;
    const where = block.cell ? [`r${block.cell.row} c${block.cell.column}`] : [];
    const flags = [
      ...(block.changed ? ["changed"] : []),
      ...(block.comments ? [count(block.comments, "comment")] : []),
    ];
    if (block.kind === "table") {
      const size = [count(block.rows, "row"), count(block.columns, "column")];
      return start + [...where, "table", ...size, ...flags].join(", ");
    }
    const text = block.text.replace(/\r?\n/g, "↵");
    if (block.kind === "other") return `${start}${[...where, "not editable"].join(", ")}: ${text}`;
    const head = [...where, block.style ?? "paragraph", ...(block.number ? [block.number] : [])];
    return `${start}${[...head, ...flags].join(", ")}: ${text}`;
  };
  return blocks.map(line).join("\n");
}
