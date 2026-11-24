/**
 * Table operations (23.3, ADR-0013): a table named by its handle, its rows and columns by the
 * indexes `read` prints (`r1 c1`: rows as with every change accepted, grid columns). Each is a
 * core command run with the selection where it acts, so every edit is tracked as the editor
 * tracks it.
 */
import {
  CellSelection,
  deleteRows as deleteRowsCommand,
  Fragment,
  insertRow,
  insertTable as insertTableCommand,
  type Node,
  type ResolvedPos,
  Slice,
  setCellShading,
  setTableStyle as setTableStyleCommand,
  tableStyles,
  toggleHeaderRow,
} from "@folijs/core";
import {
  type Changed,
  type Context,
  changed,
  inline,
  MAX_WRITTEN,
  quote,
  resolve,
} from "./operations.js";
import { readBlocks } from "./read.js";
import { type Refusal, type Result, refuse } from "./result.js";

/** The depth of the innermost cell around `$pos`, or -1. */
function cellDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "tableCell") return d;
  return -1;
}

/** Word's limits: what `insertTable` of core takes. */
const MAX_ROWS = 1000;
const MAX_COLUMNS = 63;

/** A cell where `read` puts it. */
interface Placed {
  pos: number;
  node: Node;
  column: number;
  span: number;
}
/** A row `read` counts: its index among the table's rows, and its cells. */
interface Row {
  index: number;
  pos: number;
  node: Node;
  cells: Placed[];
}

/** The rows of the table at `pos` as `read` numbers them: those not deleted as tracked changes. */
function rowsOf(pos: number, table: Node): Row[] {
  const rows: Row[] = [];
  table.forEach((row, offset, index) => {
    if ((row.attrs.revision as { deletion?: unknown } | null)?.deletion) return;
    const start = pos + 1 + offset;
    const cells: Placed[] = [];
    let column = 1 + ((row.attrs.gridBefore as number | null) ?? 0);
    row.forEach((cell, cellOffset) => {
      const span = (cell.attrs.gridSpan as number | null) ?? 1;
      cells.push({ pos: start + 1 + cellOffset, node: cell, column, span });
      column += span;
    });
    rows.push({ index, pos: start, node: row, cells });
  });
  return rows;
}

interface Table {
  handle: string;
  pos: number;
  node: Node;
  rows: Row[];
}

/** The table `handle` names: a table's own, or a paragraph's in one of its cells. */
function tableOf(context: Context, handle: string): Table | Refusal {
  const found = resolve(context, handle);
  if ("ok" in found) return found;
  let { pos, node } = found;
  if (node.type.name !== "table") {
    const $pos = context.editor.state.doc.resolve(pos);
    const depth = cellDepth($pos);
    if (depth < 0)
      return refuse(
        "invalid",
        `Block ${handle} is not a table or in one. A table is named by the handle of its "table" line, or of a paragraph in one of its cells.`,
      );
    pos = $pos.before(depth - 2);
    node = $pos.node(depth - 2);
  }
  return { handle: context.handles.at(pos, node), pos, node, rows: rowsOf(pos, node) };
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The row `row` (1-based, as read prints it), or why there is none. */
function rowAt(table: Table, row: unknown): Row | Refusal {
  const found = Number.isInteger(row) ? table.rows[(row as number) - 1] : undefined;
  return (
    found ??
    refuse(
      "invalid",
      `Table ${table.handle} has ${count(table.rows.length, "row")}: row is 1 to ${table.rows.length}.`,
    )
  );
}

/**
 * The cell at `row`, grid column `column`: the one spanning it, or the top of the vertical merge
 * that covers it (where its text is).
 */
function cellAt(table: Table, row: unknown, column: unknown): Placed | Refusal {
  let r = rowAt(table, row);
  if ("ok" in r) return r;
  const columns = Math.max(
    0,
    ...table.rows.map((x) => x.cells.reduce((n, c) => Math.max(n, c.column + c.span - 1), 0)),
  );
  const at = (x: Row) =>
    x.cells.find((c) => (column as number) >= c.column && (column as number) < c.column + c.span);
  let cell = Number.isInteger(column) ? at(r) : undefined;
  if (!cell)
    return refuse(
      "invalid",
      `Row ${row as number} of table ${table.handle} has no cell in column ${String(column)}: columns are 1 to ${columns}.`,
    );
  // Merged up: the text is in the merge's top cell.
  for (let i = table.rows.indexOf(r) - 1; cell.node.attrs.vMerge === "continue" && i >= 0; i--) {
    r = table.rows[i] as Row;
    cell = at(r) ?? cell;
  }
  return cell;
}

/** The table's blocks as they read now: its line and its cells' blocks. */
function tableBlocks(context: Context, handle: string): Changed {
  const blocks = readBlocks(context.editor.state, context.handles);
  const inTable = new Set([handle]);
  const handles = blocks
    .filter((b) => {
      const mine = b.handle === handle || (b.cell && inTable.has(b.cell.table));
      // A table nested in a cell is part of it too.
      if (mine && b.kind === "table") inTable.add(b.handle);
      return mine;
    })
    .map((b) => b.handle);
  return changed(context, handles);
}

/** Puts the caret in a cell's first paragraph. */
const caretIn = (context: Context, cell: { pos: number }) => context.editor.select(cell.pos + 2);

/** Rows of cell texts as a model gives them, or why they are not. */
function cellTexts(value: unknown, what: string): string[][] | Refusal {
  const rows = Array.isArray(value) ? value : null;
  if (
    !rows?.length ||
    !rows.every((r) => Array.isArray(r) && r.every((c) => typeof c === "string"))
  )
    return refuse(
      "invalid",
      `${what} is a list of rows, each a list of its cells' texts: [["Name", "Price"], ["Tea", "3.50"]].`,
    );
  const written = rows.flat().reduce((n: number, t: string) => n + t.length, 0);
  if (written > MAX_WRITTEN)
    return refuse("invalid", `That is ${written} characters: more than ${MAX_WRITTEN} at once.`);
  return rows as string[][];
}

/** Fills `cells` (positions in the document as it is) with `texts`, in one transaction. */
function fill(
  context: Context,
  cells: readonly { pos: number; node: Node }[],
  texts: readonly string[],
) {
  const { editor } = context;
  const tr = editor.state.tr;
  // From the last: a filled cell moves the ones after it.
  for (let i = Math.min(cells.length, texts.length) - 1; i >= 0; i--) {
    const nodes = inline(editor, texts[i] as string);
    if (nodes.length) tr.insert((cells[i] as { pos: number }).pos + 2, nodes);
  }
  if (tr.docChanged) editor.dispatch(tr);
}

export interface InsertTableOptions {
  /** Next to the block: after it (default) or before it. */
  where?: "after" | "before";
  /** Make the first row a header row (repeated on each page). */
  header?: boolean;
  /** A table style by name, as `tableStyles` lists them. Default: Word's Table Grid. */
  style?: string;
}

/** The table style named `name` (capitals do not count), or why there is none. */
function tableStyle(context: Context, name: unknown): string | Refusal {
  const names = tableStyles(context.editor.state);
  const found = names.find(
    (n) => typeof name === "string" && n.toLowerCase() === name.trim().toLowerCase(),
  );
  return (
    found ??
    refuse(
      "unknown-style",
      `There is no table style ${quote(String(name))}. The table styles are: ${names.map((n) => quote(n)).join(", ")}.`,
    )
  );
}

/**
 * Where to put the caret for core's `insertTable` to put a table next to the block at `pos`:
 * at a paragraph's end it goes after, at its start before.
 */
function caretFor(
  context: Context,
  pos: number,
  node: Node,
  where: "after" | "before",
): number | null {
  const $pos = context.editor.state.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const paragraph = (n: Node | null | undefined) => n?.type.name === "paragraph";
  if (paragraph(node)) {
    if (where === "before") return pos + 1;
    if (node.content.size) return pos + node.nodeSize - 1;
    // After an empty paragraph: before the next one, else at its own start (before it).
    const next = parent.maybeChild(index + 1);
    return paragraph(next) ? pos + node.nodeSize + 1 : pos + 1;
  }
  if (where === "after") {
    const next = parent.maybeChild(index + 1);
    return paragraph(next) ? pos + node.nodeSize + 1 : null;
  }
  const previous = parent.maybeChild(index - 1);
  return paragraph(previous) ? pos - 1 : null;
}

/** @internal */
export function insertTable(
  context: Context,
  handle: string,
  cells: readonly (readonly string[])[],
  options: InsertTableOptions = {},
): Result<Changed> {
  const { editor } = context;
  const texts = cellTexts(cells, "cells");
  if ("ok" in texts) return texts;
  const columns = Math.max(...texts.map((r) => r.length));
  if (texts.length > MAX_ROWS || columns > MAX_COLUMNS || columns < 1)
    return refuse("invalid", `A table has 1 to ${MAX_ROWS} rows and 1 to ${MAX_COLUMNS} columns.`);
  const where = options.where ?? "after";
  if (where !== "after" && where !== "before")
    return refuse("invalid", 'where is "after" or "before".');
  const style = options.style === undefined ? null : tableStyle(context, options.style);
  if (style && typeof style !== "string") return style;
  const found = resolve(context, handle);
  if ("ok" in found) return found;
  const caret = caretFor(context, found.pos, found.node, where);
  if (caret === null)
    return refuse(
      "invalid",
      `A table goes next to a paragraph, and there is none ${where} block ${handle}: insert one there first (insert_paragraphs), then the table next to it.`,
    );
  editor.select(caret);
  const before = editor.state.doc;
  if (!editor.run(insertTableCommand(texts.length, columns)) || editor.state.doc === before)
    return refuse(
      "refused",
      `A table could not be inserted ${where} block ${handle} (a locked content control?).`,
    );
  // The caret is in its first cell.
  const $from = editor.state.selection.$from;
  const depth = cellDepth($from);
  const tablePos = $from.before(depth - 2);
  const made = (): Table => {
    const node = editor.state.doc.nodeAt(tablePos) as Node;
    return {
      handle: context.handles.at(tablePos, node),
      pos: tablePos,
      node,
      rows: rowsOf(tablePos, node),
    };
  };
  const table = made();
  fill(
    context,
    table.rows.flatMap((r) => r.cells),
    texts.flatMap((r) => Array.from({ length: columns }, (_, i) => r[i] ?? "")),
  );
  if (options.header) {
    caretIn(context, made().rows[0]?.cells[0] as Placed);
    editor.run(toggleHeaderRow);
  }
  if (style && style !== "Table Grid") {
    caretIn(context, made().rows[0]?.cells[0] as Placed);
    editor.run(setTableStyleCommand(style));
  }
  return { ok: true, ...tableBlocks(context, table.handle) };
}

/** @internal */
export function insertRows(
  context: Context,
  handle: string,
  row: number,
  cells: readonly (readonly string[])[],
  where: "after" | "before" = "after",
): Result<Changed> {
  const { editor } = context;
  const table = tableOf(context, handle);
  if ("ok" in table) return table;
  const reference = rowAt(table, row);
  if ("ok" in reference) return reference;
  const texts = cellTexts(cells, "cells");
  if ("ok" in texts) return texts;
  if (where !== "after" && where !== "before")
    return refuse("invalid", 'where is "after" or "before".');
  const most = reference.cells.length;
  const long = texts.findIndex((r) => r.length > most);
  if (long >= 0)
    return refuse(
      "invalid",
      `A new row is made like row ${row}, which has ${count(most, "cell")}: row ${long + 1} of cells gives ${texts[long]?.length}.`,
    );
  if (texts.length > MAX_ROWS) return refuse("invalid", `At most ${MAX_ROWS} rows at once.`);
  caretIn(context, reference.cells[0] as Placed);
  for (const [i, rowTexts] of texts.entries()) {
    const before = editor.state.doc;
    // The first next to the reference row; the others after the one just made.
    if (
      !editor.run(insertRow(i === 0 && where === "before" ? -1 : 1)) ||
      editor.state.doc === before
    )
      return refuse(
        "refused",
        `Rows could not be inserted in table ${table.handle} (a locked content control?).`,
      );
    const $from = editor.state.selection.$from;
    const depth = cellDepth($from);
    const made = rowsOf(table.pos, editor.state.doc.nodeAt(table.pos) as Node).find(
      (r) => r.pos === $from.before(depth - 1),
    );
    if (made) fill(context, made.cells, rowTexts);
    // The caret back in the new row (filling moved it).
    const now = rowsOf(table.pos, editor.state.doc.nodeAt(table.pos) as Node).find(
      (r) => made && r.index === made.index,
    );
    if (now) caretIn(context, now.cells[0] as Placed);
  }
  return { ok: true, ...tableBlocks(context, table.handle) };
}

/** @internal */
export function deleteRows(
  context: Context,
  handle: string,
  rows: readonly number[],
): Result<{ text: string; blocks: Changed["blocks"] }> {
  const { editor } = context;
  const table = tableOf(context, handle);
  if ("ok" in table) return table;
  if (!Array.isArray(rows) || !rows.length)
    return refuse("invalid", "rows is a list of row numbers, as read prints them: [2, 3].");
  const picked: Row[] = [];
  for (const r of new Set(rows)) {
    const found = rowAt(table, r);
    if ("ok" in found) return found;
    picked.push(found);
  }
  // From the last: rows deleted as tracked changes stay, and those before keep their place.
  picked.sort((a, b) => b.index - a.index);
  for (const row of picked) {
    const node = editor.state.doc.nodeAt(table.pos);
    if (node?.type.name !== "table") break;
    const now = rowsOf(table.pos, node).find((r) => r.index === row.index);
    if (!now) continue;
    caretIn(context, now.cells[0] as Placed);
    const before = editor.state.doc;
    if (!editor.run(deleteRowsCommand) || editor.state.doc === before)
      return refuse(
        "refused",
        `Row ${table.rows.indexOf(row) + 1} of table ${table.handle} could not be deleted (a locked content control?).`,
      );
  }
  const all = picked.length === table.rows.length;
  const numbers = [...new Set(rows)].sort((a, b) => a - b).join(", ");
  const { blocks, text } = all ? { blocks: [], text: "" } : tableBlocks(context, table.handle);
  return {
    ok: true,
    blocks,
    text: all
      ? `Deleted table ${table.handle}, every row of it, as a tracked change.`
      : `Deleted ${picked.length === 1 ? "row" : "rows"} ${numbers} of table ${table.handle}, as tracked changes. The table now reads:\n${text}`,
  };
}

/** A cell's new text: where it is, as read prints it. */
export interface CellText {
  row: number;
  column: number;
  text: string;
}

/** @internal */
export function setCells(
  context: Context,
  handle: string,
  cells: readonly CellText[],
): Result<Changed> {
  const { editor } = context;
  const table = tableOf(context, handle);
  if ("ok" in table) return table;
  if (!Array.isArray(cells) || !cells.length)
    return refuse(
      "invalid",
      'cells is a list of { row, column, text }: [{ "row": 2, "column": 1, "text": "Tea" }].',
    );
  const targets = new Map<number, { cell: Placed; text: string }>();
  let written = 0;
  for (const given of cells) {
    if (typeof given?.text !== "string")
      return refuse("invalid", "Each cell has its text: a string.");
    const cell = cellAt(table, given.row, given.column);
    if ("ok" in cell) return cell;
    if (cell.node.content.content.some((b) => b.type.name !== "paragraph"))
      return refuse(
        "invalid",
        `The cell at row ${given.row}, column ${given.column} of table ${table.handle} holds a table: edit its paragraphs by their handles instead.`,
      );
    written += given.text.length;
    targets.set(cell.pos, { cell, text: given.text });
  }
  if (written > MAX_WRITTEN)
    return refuse("invalid", `That is ${written} characters: more than ${MAX_WRITTEN} at once.`);
  const before = editor.state.doc;
  const tr = editor.state.tr;
  // From the last cell: each replacement moves the ones after it.
  for (const { cell, text } of [...targets.values()].sort((a, b) => b.cell.pos - a.cell.pos)) {
    const from = cell.pos + 2;
    const to = cell.pos + cell.node.nodeSize - 2;
    const marks = cell.node.firstChild?.firstChild?.marks ?? [];
    const nodes = inline(editor, text).map((n) =>
      n.isText
        ? n.mark(
            marks.filter((m) => !["insertion", "deletion", "formatChange"].includes(m.type.name)),
          )
        : n,
    );
    if (from === to && !nodes.length) continue;
    tr.replace(from, to, new Slice(Fragment.from(nodes), 0, 0));
  }
  if (tr.docChanged) editor.dispatch(tr);
  if (tr.docChanged && editor.state.doc === before)
    return refuse(
      "refused",
      `The cells of table ${table.handle} could not be changed (a locked content control?).`,
    );
  return { ok: true, ...tableBlocks(context, table.handle) };
}

/** @internal */
export function setTableStyle(
  context: Context,
  handle: string,
  style: string | null,
): Result<Changed> {
  const { editor } = context;
  const table = tableOf(context, handle);
  if ("ok" in table) return table;
  const name = style === null ? null : tableStyle(context, style);
  if (name !== null && typeof name !== "string") return name;
  caretIn(context, table.rows[0]?.cells[0] as Placed);
  if (!editor.run(setTableStyleCommand(name)))
    return refuse("refused", `The style of table ${table.handle} could not be set.`);
  return { ok: true, ...tableBlocks(context, table.handle) };
}

export interface ShadeOptions {
  /** Only this row (with `column`: only that cell). */
  row?: number;
  /** Only this column (with `row`: only that cell). */
  column?: number;
}

/** @internal */
export function shadeCells(
  context: Context,
  handle: string,
  fill: string | null,
  options: ShadeOptions = {},
): Result<Changed> {
  const { editor } = context;
  const table = tableOf(context, handle);
  if ("ok" in table) return table;
  const color = typeof fill === "string" ? fill.trim().replace(/^#/, "") : fill;
  if (color !== null && !/^[0-9A-Fa-f]{6}$/.test(color))
    return refuse(
      "invalid",
      'fill is a color as RRGGBB ("D9E2F3"), or null to take the shading off.',
    );
  const { row, column } = options;
  const last = table.rows.length;
  const rows = row === undefined ? [1, last] : [row, row];
  const firsts = table.rows.map((r) => r.cells[0]?.column ?? 1);
  const ends = table.rows.map((r) =>
    r.cells.reduce((n, c) => Math.max(n, c.column + c.span - 1), 0),
  );
  const columns =
    column === undefined ? [Math.min(...firsts), Math.max(...ends)] : [column, column];
  const pick = (r: number, c: number, side: "first" | "last") => {
    const x = rowAt(table, r);
    if ("ok" in x) return x;
    if (column !== undefined) return cellAt(table, r, c);
    const cell = side === "first" ? x.cells[0] : x.cells[x.cells.length - 1];
    return cell ?? refuse("invalid", `Row ${r} has no cells.`);
  };
  const anchor = pick(rows[0] as number, columns[0] as number, "first");
  if ("ok" in anchor) return anchor;
  const head = pick(rows[1] as number, columns[1] as number, "last");
  if ("ok" in head) return head;
  editor.dispatch(
    editor.state.tr.setSelection(CellSelection.create(editor.state.doc, anchor.pos, head.pos)),
  );
  if (!editor.run(setCellShading(color)))
    return refuse("refused", `The cells of table ${table.handle} could not be shaded.`);
  return { ok: true, ...tableBlocks(context, table.handle) };
}

/** @internal Makes the first `count` rows the header rows (repeated on each page), and no others. */
export function setHeaderRows(context: Context, handle: string, count: number): Result<Changed> {
  const { editor } = context;
  let table = tableOf(context, handle);
  if ("ok" in table) return table;
  if (!Number.isInteger(count) || count < 0 || count > table.rows.length)
    return refuse(
      "invalid",
      `count is how many rows from the top are header rows: 0 to ${table.rows.length}.`,
    );
  const header = (r: Row | undefined) => r?.node.attrs.header === true;
  const again = () => tableOf(context, (table as Table).handle) as Table;
  // On through the count's row (the rows above it come too), then off from the row after it.
  if (count > 0 && !table.rows.slice(0, count).every(header)) {
    caretIn(context, table.rows[count - 1]?.cells[0] as Placed);
    editor.run(toggleHeaderRow);
    table = again();
  }
  if (header(table.rows[count])) {
    caretIn(context, table.rows[count]?.cells[0] as Placed);
    editor.run(toggleHeaderRow);
    table = again();
  }
  return { ok: true, ...tableBlocks(context, table.handle) };
}

/** @internal What the table actions Foli cannot record as tracked changes say. */
export const UNTRACKED_TABLE_EDIT =
  "Adding or deleting columns, merging or splitting cells and changing column widths cannot be recorded as tracked changes yet, and every edit here is one: nothing was changed. To give the reader a table with other columns, insert a new table next to this one with the cells you want, delete this one, and say why in a comment.";
