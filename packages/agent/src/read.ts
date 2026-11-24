import { controlsIn, type EditorState, fieldsIn, type Mark, type Node } from "@folijs/core";
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
  /** A table's size: its rows, and its grid's columns (a merged cell spans several). */
  rows?: number;
  columns?: number;
  /**
   * Where a block in a table is: its table's handle, row and grid column, from 1; `span`, the
   * grid columns a cell merged across covers; `merged`, a cell merged with the ones below
   * (`down`) or part of the cell above (`up`, its text shown there).
   */
  cell?: { table: string; row: number; column: number; span?: number; merged?: "down" | "up" };
  /** How many tables it is inside: 0 in the body. */
  depth: number;
  /** It holds tracked changes not yet accepted or rejected (anyone's). */
  changed: boolean;
  /** A table's style, by name, and how many rows from its top repeat on each page (23.9). */
  tableStyle?: string;
  headerRows?: number;
  /** How many comments are anchored in it. */
  comments: number;
  /**
   * The paragraph's own formatting, when `read` was asked for it (`formatting`): its own
   * properties (`paragraph centered, space after 6 pt`), then runs of text that have some, each
   * with what it has (`bold, 14 pt: "Total"`). The style's is not shown.
   */
  formatting?: string;
  /** A header's or footer's block (`read` with `headers`): which story it is in. */
  story?: { id: string; kind: "header" | "footer" };
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
  /** Its label is in a block's text already: a control over several paragraphs shows it once. */
  shown?: boolean;
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
  let changed = !!revisionOf(node) || !!node.attrs.formatChange;
  let comments = 0;
  node.forEach((child, offset) => {
    const name = child.type.name;
    if (name === "commentReference") comments++;
    if (TRACKED.some((mark) => marked(child, mark))) changed = true;
    const hidden = hiddenAt(pos + 1 + offset);
    if (hidden) {
      // What stands for a placeholder, once; not for one deleted with its control.
      if (hidden.label && !hidden.shown && !marked(child, "deletion")) {
        text += hidden.label;
        hidden.shown = true;
      }
      return;
    }
    if (marked(child, "hidden") || marked(child, "deletion")) return;
    if (child.isText) text += child.text;
    else if (name === "tab") text += "\t";
    else if (name === "hardBreak") text += "\n";
    else if (child.type.spec.text) text += child.type.spec.text(child.attrs);
    else if (name === "picture" && typeof child.attrs.alt === "string" && child.attrs.alt.trim()) {
      // Its alt text: what tells a model which picture it is (23.9's trial asked for it).
      const alt = child.attrs.alt.replace(/[\s\]]+/g, " ").trim();
      text += `[picture: ${alt.length > 60 ? `${alt.slice(0, 57)}…` : alt}]`;
    } else if (!UNSEEN.has(name)) text += STANDS_AS[name] ?? "[object]";
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
          { handle, kind: "table", text: "", changed: !!node.attrs.formatChange, comments: 0 },
          cell,
          depth,
        );
        let rows = 0;
        let columns = 0;
        node.forEach((row, rowOffset) => {
          if (revisionOf(row) || row.attrs.formatChange) table.changed = true;
          if (revisionOf(row)?.deletion) return;
          rows++;
          const rowStart = pos + 1 + rowOffset + 1;
          // The grid column each cell starts at: the columns the row leaves empty before its
          // first cell, the cells before it, and what they span.
          let grid = 1 + ((row.attrs.gridBefore as number | null) ?? 0);
          row.forEach((cellNode, cellOffset) => {
            if (cellNode.attrs.formatChange) table.changed = true;
            const span = (cellNode.attrs.gridSpan as number | null) ?? 1;
            const merge = cellNode.attrs.vMerge as string | null;
            const place = {
              table: handle,
              row: rows,
              column: grid,
              ...(span > 1 ? { span } : {}),
              ...(merge
                ? { merged: merge === "restart" ? ("down" as const) : ("up" as const) }
                : {}),
            };
            walk(cellNode, rowStart + cellOffset + 1, place, depth + 1);
            grid += span;
          });
          columns = Math.max(columns, grid - 1);
        });
        table.rows = rows;
        table.columns = columns;
        const styleId = node.attrs.style as string | null;
        const style = styleId
          ? (context?.envelope.styles.find((s) => s.id === styleId)?.name ?? styleId)
          : null;
        if (style) table.tableStyle = style;
        let header = 0;
        for (let r = 0; r < node.childCount && node.child(r).attrs.header === true; r++) header++;
        if (header) table.headerRows = header;
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

/**
 * @internal
 * Text from a document on one line: every character that ends a line shows as ↵. For all a
 * document names that is put in a line for a model (a style, a list number, a control), as for
 * its text: none of it may start a line of its own, which would read as another block.
 */
export const oneLine = (text: string) => text.replace(/\r\n|[\n\r\u0085\u2028\u2029]/g, "↵");

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
 * shows as ↵, as does any other character that ends a line, so a block is always one line.
 */
export function formatBlocks(blocks: readonly Block[]): string {
  const line = (block: Block): string => {
    const start = `[${block.handle}] ${"  ".repeat(block.depth)}`;
    const at = block.cell;
    const where = at
      ? [
          `r${at.row} c${at.column}${at.span ? `-${at.column + at.span - 1}` : ""}`,
          ...(at.merged === "down" ? ["merged down"] : at.merged === "up" ? ["merged up"] : []),
        ]
      : [];
    const flags = [
      ...(block.changed ? ["changed"] : []),
      ...(block.comments ? [count(block.comments, "comment")] : []),
    ];
    if (block.kind === "table") {
      const size = [count(block.rows, "row"), count(block.columns, "column")];
      const look = [
        ...(block.tableStyle ? [oneLine(block.tableStyle)] : []),
        ...(block.headerRows ? [count(block.headerRows, "header row")] : []),
      ];
      return start + [...where, "table", ...size, ...look, ...flags].join(", ");
    }
    const text = oneLine(block.text);
    if (block.kind === "other") return `${start}${[...where, "not editable"].join(", ")}: ${text}`;
    const head = [
      ...where,
      oneLine(block.style ?? "paragraph"),
      ...(block.number ? [oneLine(block.number)] : []),
    ];
    const own = block.formatting
      ? `
${" ".repeat(start.length)}  formatting: ${block.formatting}`
      : "";
    return `${start}${[...head, ...flags].join(", ")}: ${text}${own}`;
  };
  return blocks.map(line).join("\n");
}

/** What a run's own marks make it, in words; empty for none. */
function described(marks: readonly Mark[]): string[] {
  const out: string[] = [];
  for (const mark of marks) {
    const a = mark.attrs;
    switch (mark.type.name) {
      case "bold":
      case "italic":
      case "strike":
        out.push(a.value === false ? `not ${mark.type.name}` : mark.type.name);
        break;
      case "underline":
        out.push(a.style === "none" ? "not underlined" : "underlined");
        break;
      case "font": {
        const name = a.ascii ?? a.hAnsi;
        if (name) out.push(`font ${JSON.stringify(name)}`);
        break;
      }
      case "fontSize":
        if (typeof a.value === "number") out.push(`${a.value / 2} pt`);
        break;
      case "color":
        if (a.value && a.value !== "auto") out.push(`color ${a.value as string}`);
        break;
      case "highlight":
        if (a.value && a.value !== "none") out.push(`highlight ${a.value as string}`);
        break;
      case "link":
        out.push(`link ${JSON.stringify(a.href)}`);
        break;
    }
  }
  return out;
}

/**
 * @internal
 * A paragraph's runs that have formatting of their own, as `Block.formatting` gives them; text
 * deleted as a tracked change is left out, as `read` leaves it out.
 */
export function runFormatting(paragraph: Node): string {
  const runs: { what: string; text: string }[] = [];
  paragraph.forEach((child) => {
    if (!child.isText || child.marks.some((m) => m.type.name === "deletion")) return;
    const what = described(child.marks).join(", ");
    const last = runs[runs.length - 1];
    if (last && last.what === what) last.text += child.text;
    else runs.push({ what, text: child.text as string });
  });
  return runs
    .filter((r) => r.what)
    .map(
      (r) =>
        `${r.what}: ${JSON.stringify(r.text.length > 80 ? `${r.text.slice(0, 77)}…` : r.text)}`,
    )
    .join("; ");
}

/**
 * @internal
 * A paragraph's own properties in words (alignment, spacing, indentation), as
 * `Block.formatting` starts with them; empty when it has none of its own.
 */
export function paragraphFormatting(paragraph: Node): string {
  const a = paragraph.attrs as Record<string, Record<string, unknown> | string | null>;
  const out: string[] = [];
  const align: Record<string, string> = {
    center: "centered",
    right: "right aligned",
    end: "right aligned",
    both: "justified",
    distribute: "justified",
    left: "left aligned",
    start: "left aligned",
  };
  if (typeof a.justification === "string" && align[a.justification])
    out.push(align[a.justification] as string);
  const spacing = (a.spacing ?? {}) as Record<string, unknown>;
  if (typeof spacing.line === "number" && (spacing.lineRule ?? "auto") === "auto")
    out.push(`line spacing ${Math.round((spacing.line / 240) * 100) / 100}`);
  if (typeof spacing.before === "number") out.push(`space before ${spacing.before / 20} pt`);
  if (typeof spacing.after === "number") out.push(`space after ${spacing.after / 20} pt`);
  const indent = (a.indent ?? {}) as Record<string, unknown>;
  if (typeof indent.left === "number" && indent.left) out.push(`indent ${indent.left / 20} pt`);
  if (typeof indent.firstLine === "number" && indent.firstLine)
    out.push(`first line ${indent.firstLine / 20} pt`);
  if (typeof indent.hanging === "number" && indent.hanging)
    out.push(`hanging ${indent.hanging / 20} pt`);
  return out.length ? `paragraph ${out.join(", ")}` : "";
}
