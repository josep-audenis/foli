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
   * A paragraph's text: tabs as tabs, line breaks as "\n", a picture as "[picture]", a note's
   * reference as "[note]", other objects as "[object]". Text deleted as a tracked change and
   * hidden text are left out, as are field codes and controls' placeholders. A table: "".
   * Other: what it is.
   */
  text: string;
  /** A table's size: its rows, and the cells of its longest row. */
  rows?: number;
  columns?: number;
  /** Where a block in a table is: its table's handle, row and cell in the row, from 1. */
  cell?: { table: string; row: number; column: number };
  /** It holds tracked changes not yet accepted or rejected (anyone's). */
  changed: boolean;
  /** How many comments are anchored in it. */
  comments: number;
}

type Attrs = Record<string, unknown>;
type Range = readonly [from: number, to: number];

const revisionOf = (node: Node) =>
  node.attrs.revision as { insertion?: unknown; deletion?: unknown } | null | undefined;
const marked = (node: Node, name: string) =>
  node.marks.some((m) => m.type.name === name && m.attrs.value !== false);
const TRACKED = ["insertion", "deletion", "formatChange"];
/** Inline nodes that draw nothing: text runs on across them. */
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
  "pageBreak",
  "columnBreak",
  "noteMark",
]);
const STANDS_AS: Record<string, string> = { picture: "[picture]", noteReference: "[note]" };

/** What of the body does not show: field codes and controls' placeholders, in order. */
function hiddenRanges(state: EditorState): Range[] {
  const doc = state.doc;
  const ranges: Range[] = fieldsIn(doc).map((f) => [f.from, f.codeEnd]);
  const controls = wordContext(state)?.envelope.controls;
  if (controls)
    for (const range of controlsIn(doc))
      if (Object.hasOwn(controls, range.id) && controls[range.id]?.placeholder?.showing)
        ranges.push([range.contentFrom, range.contentTo]);
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** A paragraph's text as `Block.text` has it, and what else a read says of it. */
function paragraphText(node: Node, pos: number, isHidden: (at: number) => boolean) {
  let text = "";
  let changed = !!revisionOf(node) || !!node.attrs.formatChange;
  let comments = 0;
  node.forEach((child, offset) => {
    const name = child.type.name;
    if (name === "commentReference") comments++;
    if (TRACKED.some((mark) => marked(child, mark))) changed = true;
    if (isHidden(pos + 1 + offset) || marked(child, "hidden") || marked(child, "deletion")) return;
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
 * The body's blocks in document order, a table before its cells' blocks. A paragraph or a row
 * deleted as a tracked change is left out when nothing of it would stay.
 *
 * shortcut: a paragraph whose mark is deleted but that keeps text is read as its own block,
 * where Word's final view joins it with the next; upgrade if agents trip on it.
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
  const isHidden = (at: number) => {
    while (h < hidden.length && (hidden[h] as Range)[1] <= at) h++;
    const range = hidden[h];
    return !!range && range[0] <= at;
  };

  const blocks: Block[] = [];
  const paragraphs: { block: Block; attrs: Attrs }[] = [];
  const add = (block: Block, cell: Block["cell"]) => {
    if (cell) block.cell = cell;
    blocks.push(block);
    return block;
  };

  const walk = (parent: Node, start: number, cell: Block["cell"]) => {
    parent.forEach((node, offset) => {
      const pos = start + offset;
      const name = node.type.name;
      if (name === "paragraph") {
        const read = paragraphText(node, pos, isHidden);
        if (revisionOf(node)?.deletion && !read.text) return;
        const block = add({ handle: handles.at(pos), kind: "paragraph", ...read }, cell);
        paragraphs.push({ block, attrs: node.attrs as Attrs });
      } else if (name === "table") {
        const handle = handles.at(pos);
        const table = add({ handle, kind: "table", text: "", changed: false, comments: 0 }, cell);
        let rows = 0;
        let columns = 0;
        node.forEach((row, rowOffset) => {
          if (revisionOf(row)) table.changed = true;
          if (revisionOf(row)?.deletion) return;
          rows++;
          columns = Math.max(columns, row.childCount);
          const rowStart = pos + 1 + rowOffset + 1;
          row.forEach((cellNode, cellOffset, column) => {
            walk(cellNode, rowStart + cellOffset + 1, {
              table: handle,
              row: rows,
              column: column + 1,
            });
          });
        });
        table.rows = rows;
        table.columns = columns;
      } else {
        const text = node.type.spec.text?.(node.attrs) ?? String(node.attrs.label ?? name);
        add({ handle: handles.at(pos), kind: "other", text, changed: false, comments: 0 }, cell);
      }
    });
  };
  walk(state.doc, 0, undefined);

  if (context) {
    const markers = context.resolver.markers(paragraphs.map((p) => p.attrs));
    paragraphs.forEach(({ block, attrs }, index) => {
      const id = context.resolver.paragraph(attrs).paragraph.style;
      if (id !== null) block.style = styleNames.get(id) ?? id;
      const marker = markers[index];
      // A bullet is a character of a symbol font, often in the private use area: one sign for all.
      if (marker)
        block.number = context.resolver.numberFormat(attrs) === "bullet" ? "•" : marker.text;
      if (!block.number) delete block.number;
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
  const depth = new Map<string, number>();
  const line = (block: Block): string => {
    const level = block.cell ? (depth.get(block.cell.table) ?? 0) + 1 : 0;
    const start = `[${block.handle}] ${"  ".repeat(level)}`;
    const where = block.cell ? [`r${block.cell.row} c${block.cell.column}`] : [];
    const flags = [
      ...(block.changed ? ["changed"] : []),
      ...(block.comments ? [count(block.comments, "comment")] : []),
    ];
    if (block.kind === "table") {
      depth.set(block.handle, level);
      const size = [count(block.rows, "row"), count(block.columns, "column")];
      return start + [...where, "table", ...size, ...flags].join(", ");
    }
    if (block.kind === "other")
      return `${start}${[...where, "not editable"].join(", ")}: ${block.text}`;
    const head = [...where, block.style ?? "paragraph", ...(block.number ? [block.number] : [])];
    return `${start}${[...head, ...flags].join(", ")}: ${block.text.replaceAll("\n", "↵")}`;
  };
  return blocks.map(line).join("\n");
}
