/**
 * Table commands (10.7, ADR-0006): inserting a table, inserting and deleting rows and columns,
 * deleting a table. They act on the table around the selection: the rectangle of a cell
 * selection, or the cell holding the caret. Rows are inserted and deleted as tracked changes
 * while tracking (the rebuild records them, 10.6a); column changes are not tracked by Foli yet,
 * so they do not apply while tracking.
 */
import { FoliDocumentError, Fragment, type Node, type NodeType, Slice } from "../model/index.js";
import { attempt } from "./attempt.js";
import { deleteSelectionKeepingTables } from "./commands.js";
import { closeHistory } from "./history.js";
import { MARK_ATTRS } from "./mark.js";
import { Selection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import {
  CellSelection,
  cellDepth,
  coveringAt,
  coveringCell,
  emptyRowLike,
  type GridCell,
  gridOf,
  keepTablesApart,
} from "./tables.js";
import { trackState } from "./track.js";
import { splitAttrs, withEnvelope, wordContext } from "./word.js";
import { ensureStyle } from "./wordformat.js";

/** Word's limits: 63 columns; rows are bounded here to keep a table insert reasonable. */
const MAX_COLUMNS = 63;
const MAX_ROWS = 1000;
/** Word's default page (Letter) and margins, in twips, when the section does not say. */
const PAGE_WIDTH = 12_240;
const MARGIN = 1_440;

const tracking = (state: EditorState) => trackState(state)?.on === true;
/** Word's largest measure in twips (22 inches). */
const MAX_TWIPS = 31_680;

/** `attempt`, as its own undo step (never joined with the typing or command before it). */
const apply = (
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  build: (tr: Transaction) => void,
) =>
  attempt(state, dispatch, (tr) => {
    tr.setMeta(closeHistory, true);
    build(tr);
  });

/**
 * An empty paragraph like a cell's last one (a cell always ends with a paragraph): its
 * properties, not what only that paragraph has (its identity, revisions, section).
 */
function emptyLike(cell: Node, paragraph: NodeType): Node {
  const last = cell.lastChild;
  if (last?.type !== paragraph) return paragraph.create();
  const own = Object.fromEntries(MARK_ATTRS.map((key) => [key, null]));
  return paragraph.create({ ...last.attrs, ...own, attributes: null });
}

/** The table around the selection and the rectangle of grid rows and columns it covers. */
interface Around {
  table: Node;
  /** The position before the table. */
  pos: number;
  grid: GridCell[];
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function around(state: EditorState): Around | null {
  const { selection } = state;
  let cells: number[];
  let $cell: ReturnType<typeof state.doc.resolve>;
  if (selection instanceof CellSelection) {
    cells = [...selection.cells];
    $cell = selection.$anchor;
  } else {
    const depth = cellDepth(selection.$from);
    if (depth < 0) return null;
    const pos = selection.$from.before(depth);
    cells = [pos];
    $cell = state.doc.resolve(pos);
  }
  const tableDepth = $cell.depth - 1;
  const table = $cell.node(tableDepth);
  const pos = $cell.before(tableDepth);
  const grid = gridOf(table, pos);
  const chosen = grid.filter((c) => cells.includes(c.pos));
  // A caret in a cell a merge covers: the merge's cell.
  const covering = chosen.length ? undefined : coveringCell(table, pos, grid, cells[0] as number);
  if (covering) chosen.push(covering);
  if (!chosen.length) return null;
  return {
    table,
    pos,
    grid,
    top: Math.min(...chosen.map((c) => c.row)),
    bottom: Math.max(...chosen.map((c) => c.row + c.rowSpan - 1)),
    left: Math.min(...chosen.map((c) => c.column)),
    right: Math.max(...chosen.map((c) => c.column + c.span - 1)),
  };
}

/** A row's cells with the grid column each starts at. */
function placed(row: Node): { cell: Node; column: number; span: number }[] {
  const out: { cell: Node; column: number; span: number }[] = [];
  let column = (row.attrs.gridBefore as number | null) ?? 0;
  row.forEach((cell) => {
    const span = (cell.attrs.gridSpan as number | null) ?? 1;
    out.push({ cell, column, span });
    column += span;
  });
  return out;
}

/** The position before row `index` of the table at `pos`. */
function rowPos(table: Node, pos: number, index: number): number {
  let at = pos + 1;
  for (let i = 0; i < index; i++) at += table.child(i).nodeSize;
  return at;
}

/** The caret at the start of the first paragraph of the cell at `cellPos`. */
const caretIn = (tr: Transaction, cellPos: number) =>
  tr.setSelection(Selection.near(tr.doc.resolve(cellPos + 1), 1));

/** The caret in the first cell of the row at `rowPos` that no merge covers (a covered cell is not drawn). */
function caretInRow(tr: Transaction, rowPos: number): void {
  const row = tr.doc.nodeAt(rowPos) as Node;
  let cellPos = rowPos + 1;
  for (let i = 0; i < row.childCount - 1 && row.child(i).attrs.vMerge === "continue"; i++)
    cellPos += row.child(i).nodeSize;
  caretIn(tr, cellPos);
}

/** The text width of the document's (last) section, in twips. */
function textWidth(state: EditorState): number {
  const section = wordContext(state)?.envelope.section;
  const width = section?.pageSize?.width ?? PAGE_WIDTH;
  const { left = MARGIN, right = MARGIN, gutter = 0 } = section?.margins ?? {};
  return Math.max(width - left - right - gutter, 1);
}

/**
 * Inserts a table of `rows` × `columns` empty cells at the caret, as Word does: before the
 * paragraph at its start, after it at its end, else between its two halves; a paragraph
 * follows it where nothing would. Its columns share the text width; it has Word's "Table Grid"
 * style (added to the document when missing). The caret goes into its first cell.
 */
export function insertTable(rows: number, columns: number): Command {
  return (state, dispatch) => {
    const { table, tableRow, tableCell, paragraph } = state.schema.nodes;
    const context = wordContext(state);
    if (!table || !tableRow || !tableCell || !paragraph || !context) return false;
    const valid = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
    if (!valid(rows, MAX_ROWS) || !valid(columns, MAX_COLUMNS)) return false;
    if (!state.selection.$from.parent.isTextblock) return false;
    const each = Math.max(Math.floor(textWidth(state) / columns), 1);
    const style = ensureStyle(context, "Table Grid", "table");
    const cell = tableCell.create({ width: { value: each, type: "dxa" } }, paragraph.create());
    const row = tableRow.create(
      null,
      Array.from({ length: columns }, () => cell),
    );
    const node = table.create(
      { style: style?.id ?? null, grid: Array.from({ length: columns }, () => each) },
      Array.from({ length: rows }, () => row),
    );
    return apply(state, dispatch, (tr) => {
      if (!tr.selection.empty) deleteSelectionKeepingTables(tr);
      const $pos = tr.selection.$from;
      if (!$pos.parent.isTextblock) throw new RangeError("No paragraph at the caret");
      let at: number;
      if ($pos.parentOffset === 0) at = $pos.before();
      // While tracking, after the paragraph: a tracked split would stay when the table is
      // rejected.
      else if ($pos.parentOffset === $pos.parent.content.size || tracking(state)) at = $pos.after();
      else {
        // As Enter splits: the first half gets a new paragraph mark, the second keeps it.
        const { before, after } = splitAttrs(context, $pos.parent, false);
        tr.split($pos.pos, 1, [{ type: $pos.parent.type, attrs: after }]);
        if (before) tr.setNodeMarkup($pos.before(), $pos.parent.type, before);
        at = $pos.pos + 1;
      }
      // A paragraph after it where nothing follows (a cell's last block, the body's end).
      const $at = tr.doc.resolve(at);
      const last = $at.index() === $at.parent.childCount;
      tr.insert(at, last ? Fragment.from([node, paragraph.create()]) : node);
      keepTablesApart(tr);
      if (style && style.envelope !== context.envelope) withEnvelope(tr, style.envelope);
      caretIn(tr, at + 2);
    });
  };
}

/**
 * Inserts an empty row above the selection's first row (`dir` -1) or below its last (1), like
 * that row (its cells' properties, no content); a vertical merge running across it goes on
 * through the new row. While tracking, the row is a tracked insertion.
 */
export function insertRow(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const found = around(state);
    if (!found) return false;
    const { table, pos } = found;
    const index = dir < 0 ? found.top : found.bottom;
    const reference = table.child(index);
    const plain = emptyRowLike(reference);
    if (!plain) return false;
    // A merge goes on through the new row where the row past it continues it (below) or the
    // reference row is itself continued (above).
    const beyond = dir > 0 ? table.maybeChild(index + 1) : null;
    const continued = new Set(
      (dir > 0 ? (beyond ? placed(beyond) : []) : placed(reference))
        .filter((p) => p.cell.attrs.vMerge === "continue")
        .map((p) => p.column),
    );
    const cells: Node[] = [];
    const refPlaced = placed(reference);
    plain.forEach((cell, _o, i) => {
      const { column, cell: ref } = refPlaced[i] as (typeof refPlaced)[number];
      const merged = continued.has(column) && ref.attrs.vMerge !== null;
      cells.push(
        merged ? cell.type.create({ ...cell.attrs, vMerge: "continue" }, cell.content) : cell,
      );
    });
    // Header rows are a run from the table's top: a row put above or among them is one too.
    const header = reference.attrs.header && (dir < 0 || beyond?.attrs.header);
    const row = plain.type.create(
      header ? { ...plain.attrs, header: reference.attrs.header } : plain.attrs,
      cells,
    );
    const at = dir < 0 ? rowPos(table, pos, index) : rowPos(table, pos, index + 1);
    return apply(state, dispatch, (tr) => {
      tr.insert(at, row);
      caretInRow(tr, at);
    });
  };
}

/**
 * Deletes the selection's rows (the whole table when they are all its rows). A vertical merge
 * starting in a deleted row goes on from the first row kept, with its content. While tracking,
 * the rows are tracked deletions instead.
 */
export const deleteRows: Command = (state, dispatch) => {
  const found = around(state);
  if (!found) return false;
  const { table, pos, grid, top, bottom } = found;
  if (top === 0 && bottom === table.childCount - 1) return deleteTable(state, dispatch);
  const from = rowPos(table, pos, top);
  const to = rowPos(table, pos, bottom + 1);
  return apply(state, dispatch, (tr) => {
    const next = table.maybeChild(bottom + 1);
    if (next && !tracking(state)) {
      // Merges cut at their start: the first kept row's covered cell starts them again.
      let cellPos = to + 1;
      const starts: { pos: number; from: GridCell }[] = [];
      for (const { cell, column } of placed(next)) {
        if (cell.attrs.vMerge === "continue") {
          const start = grid.find(
            (c) =>
              c.column === column &&
              c.row >= top &&
              c.row <= bottom &&
              c.row + c.rowSpan > bottom + 1,
          );
          if (start) starts.push({ pos: cellPos, from: start });
        }
        cellPos += cell.nodeSize;
      }
      for (const { pos: at, from: start } of starts.reverse()) {
        const cell = tr.doc.nodeAt(at) as Node;
        const first = state.doc.nodeAt(start.pos) as Node;
        // The merge's cell as it was (its properties, its text, then any text the covered
        // cell held, which Word does not show).
        const content = cell.textContent ? first.content.append(cell.content) : first.content;
        tr.setNodeMarkup(at, cell.type, { ...first.attrs, vMerge: "restart" });
        tr.replace(at + 1, at + cell.nodeSize - 1, new Slice(content, 0, 0));
      }
    }
    tr.delete(from, to);
    // The row after the deleted ones, or the one before when they were the last.
    const last = bottom === table.childCount - 1;
    caretInRow(tr, last ? rowPos(table, pos, top - 1) : tr.mapping.map(from));
  });
};

/** Deletes the table around the selection (while tracking, its rows are tracked deletions). */
export const deleteTable: Command = (state, dispatch) => {
  const found = around(state);
  if (!found) return false;
  const { table, pos } = found;
  return apply(state, dispatch, (tr) => {
    tr.delete(pos, pos + table.nodeSize);
    keepTablesApart(tr);
    tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(pos)), 1));
  });
};

/** The table at `pos` rebuilt with each row passed through `row` (null: the row goes). */
function rebuild(
  table: Node,
  attrs: Node["attrs"],
  row: (row: Node, index: number) => Node | null,
): Node | null {
  const rows: Node[] = [];
  table.forEach((r, _o, i) => {
    const next = row(r, i);
    if (next) rows.push(next);
  });
  return rows.length ? table.type.create(attrs, rows) : null;
}

/** A cell's `width` in twips set to the grid columns it spans, when it gives one in twips. */
function widthFor(attrs: Node["attrs"], grid: readonly number[], column: number, span: number) {
  const width = attrs.width as { value: number; type: string } | null;
  if (width?.type !== "dxa" || grid.length < column + span) return attrs;
  const value = grid.slice(column, column + span).reduce((a, b) => a + b, 0);
  return { ...attrs, width: { value: Math.min(Math.max(value, 0), MAX_TWIPS), type: "dxa" } };
}

/** Replaces the table at `pos` with `next` and puts the caret in its cell at `row`, `column`. */
function replaceTable(
  tr: Transaction,
  pos: number,
  old: Node,
  next: Node,
  row: number,
  column: number,
) {
  tr.replace(pos, pos + old.nodeSize, new Slice(Fragment.from(next), 0, 0));
  const grid = gridOf(next, pos);
  const at =
    grid.find(
      (c) =>
        c.row <= row && row < c.row + c.rowSpan && c.column <= column && column < c.column + c.span,
    ) ?? grid[0];
  if (at) caretIn(tr, at.pos);
}

/**
 * Inserts an empty column left of the selection's first column (`dir` -1) or right of its last
 * (1), as wide as that column: a cell spanning the boundary grows by it; the new cells take
 * their neighbour's properties (a vertical merge too). Not while tracking (Foli does not
 * record column changes yet).
 */
export function insertColumn(dir: -1 | 1): Command {
  return (state, dispatch) => {
    if (tracking(state)) return false;
    const found = around(state);
    const paragraph = state.schema.nodes.paragraph;
    if (!found || !paragraph) return false;
    const { table, pos, top } = found;
    const at = dir < 0 ? found.left : found.right + 1;
    const oldGrid = table.attrs.grid as number[];
    const columns = Math.max(oldGrid.length, ...found.grid.map((c) => c.column + c.span));
    if (columns >= MAX_COLUMNS) return false;
    // A table without a grid (widths left to Word) keeps none.
    const width = oldGrid[dir < 0 ? found.left : found.right] ?? 0;
    const grid =
      oldGrid.length >= columns ? [...oldGrid.slice(0, at), width, ...oldGrid.slice(at)] : oldGrid;
    const next = rebuild(table, { ...table.attrs, grid, gridExt: null }, (row) => {
      const cells = placed(row);
      const before = (row.attrs.gridBefore as number | null) ?? 0;
      const end = cells.length
        ? (cells[cells.length - 1] as (typeof cells)[number]).column +
          (cells[cells.length - 1] as (typeof cells)[number]).span
        : before;
      if (at < before)
        return row.type.create({ ...row.attrs, gridBefore: before + 1 }, row.content);
      // Past the row's cells: its empty columns after them widen where they reach the new
      // column's place; a row ending before it stays short (as Word leaves it).
      if (at > end) {
        const after = (row.attrs.gridAfter as number | null) ?? 0;
        return at > end + after
          ? row
          : row.type.create({ ...row.attrs, gridAfter: after + 1 }, row.content);
      }
      const out: Node[] = [];
      // The neighbour on the selection's side: the cell starting at the boundary (left) or
      // ending at it (right).
      const neighbour =
        cells.find((c) => (dir < 0 ? c.column === at : c.column + c.span === at)) ??
        cells.find((c) => c.column === at) ??
        cells[cells.length - 1];
      const fresh = (ref: Node) => {
        const first = ref.firstChild;
        const own =
          first?.type === paragraph ? { ...first.attrs, attributes: null, revision: null } : null;
        const attrs = widthFor({ ...ref.attrs, gridSpan: null }, grid, at, 1);
        return ref.type.create(attrs, paragraph.create(own));
      };
      for (const c of cells) {
        if (c.column < at && at < c.column + c.span) {
          // Spans the boundary: one column wider.
          out.push(
            c.cell.type.create(
              widthFor({ ...c.cell.attrs, gridSpan: c.span + 1 }, grid, c.column, c.span + 1),
              c.cell.content,
            ),
          );
          continue;
        }
        if (c.column === at && neighbour) out.push(fresh(neighbour.cell));
        out.push(c.cell);
      }
      if (at === end && neighbour) out.push(fresh(neighbour.cell));
      return row.type.create(row.attrs, out);
    });
    if (!next) return false;
    return apply(state, dispatch, (tr) => replaceTable(tr, pos, table, next, top, at));
  };
}

/**
 * Deletes the selection's columns (the whole table when they are all its columns): cells in
 * them go, cells spanning into them narrow, a row left with no cell goes. Not while tracking.
 */
export const deleteColumns: Command = (state, dispatch) => {
  if (tracking(state)) return false;
  const found = around(state);
  if (!found) return false;
  const { table, pos, top, left, right } = found;
  const oldGrid = table.attrs.grid as number[];
  const width = Math.max(oldGrid.length, ...found.grid.map((c) => c.column + c.span));
  if (left === 0 && right >= width - 1) return deleteTable(state, dispatch);
  const removed = right - left + 1;
  const grid = [...oldGrid.slice(0, left), ...oldGrid.slice(right + 1)];
  const overlap = (from: number, span: number) =>
    Math.max(0, Math.min(from + span - 1, right) - Math.max(from, left) + 1);
  const next = rebuild(table, { ...table.attrs, grid, gridExt: null }, (row) => {
    const before = (row.attrs.gridBefore as number | null) ?? 0;
    const cells: Node[] = [];
    let column = before - overlap(0, before);
    for (const c of placed(row)) {
      const span = c.span - overlap(c.column, c.span);
      if (span <= 0) continue;
      cells.push(
        c.cell.type.create(
          widthFor({ ...c.cell.attrs, gridSpan: span > 1 ? span : null }, grid, column, span),
          c.cell.content,
        ),
      );
      column += span;
    }
    if (!cells.length) return null;
    const cellsEnd = placed(row).reduce((end, c) => Math.max(end, c.column + c.span), before);
    const after = (row.attrs.gridAfter as number | null) ?? 0;
    const afterLeft = after - overlap(cellsEnd, after);
    return row.type.create(
      {
        ...row.attrs,
        gridBefore: before - overlap(0, before) || null,
        gridAfter: afterLeft || null,
      },
      cells,
    );
  });
  if (!next) return deleteTable(state, dispatch);
  return apply(state, dispatch, (tr) =>
    replaceTable(tr, pos, table, next, top, Math.min(left, width - removed - 1)),
  );
};

// ---- Cells and properties (10.7b) --------------------------------------------------------------

/** A cell holding only one empty paragraph. */
const blank = (cell: Node) =>
  cell.childCount === 1 && !!cell.firstChild?.isTextblock && !cell.firstChild.content.size;

/**
 * Merges the selected cells into one, as Word does: the rectangle's first cell spans its columns
 * (`gridSpan`) and, over several rows, starts a vertical merge the rows below continue; it holds
 * the text of every selected cell in order. Applies to a cell selection whose rectangle cells
 * fill. Not while tracking.
 */
export const mergeCells: Command = (state, dispatch) => {
  if (tracking(state) || !(state.selection instanceof CellSelection)) return false;
  const found = around(state);
  const paragraph = state.schema.nodes.paragraph;
  if (!found || !paragraph) return false;
  const { table, pos, grid, top, bottom, left, right } = found;
  const width = right - left + 1;
  const inside = grid.filter(
    (c) => c.row >= top && c.row <= bottom && c.column >= left && c.column <= right,
  );
  if (inside.length < 2) return false;
  // Every grid place of the rectangle has a cell (no row starts or ends inside it).
  const area = inside.reduce((sum, c) => sum + c.span * c.rowSpan, 0);
  if (area !== width * (bottom - top + 1)) return false;
  // Every cell's blocks, row by row (a covered cell's own text too: nothing is dropped).
  const content: Node[] = [];
  for (let r = top; r <= bottom; r++)
    for (const c of placed(table.child(r)))
      if (c.column >= left && c.column <= right && !blank(c.cell))
        c.cell.forEach((block) => {
          content.push(block);
        });
  if (!content.length || !content[content.length - 1]?.isTextblock)
    content.push(paragraph.create());
  const tableGrid = table.attrs.grid as number[];
  const next = rebuild(table, table.attrs, (row, r) => {
    if (r < top || r > bottom) return row;
    const cells: Node[] = [];
    let merged = false;
    for (const c of placed(row)) {
      if (c.column < left || c.column > right) {
        cells.push(c.cell);
        continue;
      }
      if (merged) continue;
      merged = true;
      const attrs = widthFor(
        {
          ...c.cell.attrs,
          gridSpan: width > 1 ? width : null,
          vMerge: bottom > top ? (r === top ? "restart" : "continue") : null,
        },
        tableGrid,
        left,
        width,
      );
      cells.push(
        c.cell.type.create(
          attrs,
          r === top ? Fragment.from(content) : emptyLike(c.cell, paragraph),
        ),
      );
    }
    return row.type.create(row.attrs, cells);
  });
  if (!next) return false;
  return apply(state, dispatch, (tr) => replaceTable(tr, pos, table, next, top, left));
};

/**
 * Splits the selected merged cells back into their grid's cells (a horizontal span into one
 * cell per column, a vertical merge into one cell per row); the text stays in the first.
 * Applies where a selected cell is merged. Not while tracking.
 */
export const splitCell: Command = (state, dispatch) => {
  if (tracking(state)) return false;
  const found = around(state);
  const paragraph = state.schema.nodes.paragraph;
  if (!found || !paragraph) return false;
  const { table, pos, grid, top, bottom, left, right } = found;
  const split = new Set(
    grid
      .filter(
        (c) =>
          (c.span > 1 || c.rowSpan > 1) &&
          c.row >= top &&
          c.row <= bottom &&
          c.column >= left &&
          c.column <= right,
      )
      .map((c) => c.pos),
  );
  if (!split.size) return false;
  const tableGrid = table.attrs.grid as number[];
  const next = rebuild(table, table.attrs, (row, r) => {
    const cells: Node[] = [];
    for (const c of placed(row)) {
      const owner = coveringAt(grid, r, c.column);
      if (!owner || !split.has(owner.pos)) {
        cells.push(c.cell);
        continue;
      }
      for (let i = 0; i < c.span; i++) {
        const attrs = widthFor(
          { ...c.cell.attrs, gridSpan: null, vMerge: null },
          tableGrid,
          c.column + i,
          1,
        );
        // The merge's text stays in its first cell; a covered cell's own text (which Word does
        // not show) stays in its cell.
        const keep = i === 0 && (r === owner.row || !blank(c.cell));
        cells.push(c.cell.type.create(attrs, keep ? c.cell.content : emptyLike(c.cell, paragraph)));
      }
    }
    return row.type.create(row.attrs, cells);
  });
  if (!next) return false;
  return apply(state, dispatch, (tr) => replaceTable(tr, pos, table, next, top, left));
};

/** Whether the selection's rows are all header rows (repeated on each page). */
export function isHeaderRow(state: EditorState): boolean {
  const found = around(state);
  if (!found) return false;
  for (let r = found.top; r <= found.bottom; r++)
    if (found.table.child(r).attrs.header !== true) return false;
  return true;
}

/**
 * Makes the selection's rows header rows, with every row above them (Word repeats only a run of
 * rows from the table's top), or, when they all are, makes them and the header rows below them
 * ordinary rows. Not while tracking.
 */
export const toggleHeaderRow: Command = (state, dispatch) => {
  if (tracking(state)) return false;
  const found = around(state);
  if (!found) return false;
  const { table, pos, top, bottom } = found;
  const on = !isHeaderRow(state);
  return apply(state, dispatch, (tr) => {
    for (let r = 0; r < table.childCount; r++) {
      const row = table.child(r);
      const header = row.attrs.header === true;
      const value = on ? (r <= bottom ? true : header) : r >= top ? false : header;
      if (value !== header)
        tr.setNodeMarkup(rowPos(table, pos, r), row.type, {
          ...row.attrs,
          header: value || null,
        });
    }
  });
};

/** The table styles one can pick: the document's, with Word's Table Grid where it lacks it. */
export function tableStyles(state: EditorState): string[] {
  const styles = wordContext(state)?.envelope.styles ?? [];
  const names = styles.filter((s) => s.type === "table" && s.name).map((s) => s.name as string);
  return names.some((n) => n.toLowerCase() === "table grid") ? names : [...names, "Table Grid"];
}

/** The name of the style of the table around the selection (null: none, or no table). */
export function tableStyleAt(state: EditorState): string | null {
  // O(depth): the table above the selection's cell, not its grid (runs after every transaction).
  const { selection } = state;
  let table: Node | undefined;
  if (selection instanceof CellSelection)
    table = selection.$anchor.node(selection.$anchor.depth - 1);
  else {
    const depth = cellDepth(selection.$from);
    if (depth >= 0) table = selection.$from.node(depth - 2);
  }
  const id = table?.attrs.style as string | null | undefined;
  if (!id) return null;
  return wordContext(state)?.envelope.styles.find((s) => s.id === id)?.name ?? null;
}

/**
 * Gives the table around the selection the table style named `name` (Word's Table Grid is
 * added when missing; any other must exist), or none. Not while tracking.
 */
export function setTableStyle(name: string | null): Command {
  return (state, dispatch) => {
    if (tracking(state)) return false;
    const found = around(state);
    const context = wordContext(state);
    if (!found || !context) return false;
    const style = name === null ? null : ensureStyle(context, name, "table");
    if (name !== null && !style) return false;
    // A built-in of another type (a heading's) is not a table style.
    if (style && style.envelope.styles.find((s) => s.id === style.id)?.type !== "table")
      return false;
    const { table, pos } = found;
    return apply(state, dispatch, (tr) => {
      tr.setNodeMarkup(pos, table.type, { ...table.attrs, style: style?.id ?? null });
      if (style && style.envelope !== context.envelope) withEnvelope(tr, style.envelope);
    });
  };
}

/**
 * Shades the selected cells with `fill` (`RRGGBB`), or takes their shading off (null). Not
 * while tracking.
 */
export function setCellShading(fill: string | null): Command {
  return (state, dispatch) => {
    if (tracking(state)) return false;
    if (fill !== null && !/^[0-9A-Fa-f]{6}$/.test(fill)) return false;
    const found = around(state);
    if (!found) return false;
    const { table, pos, top, bottom, left, right } = found;
    const shading =
      fill === null ? null : { pattern: "clear", color: "auto", fill: fill.toUpperCase() };
    return apply(state, dispatch, (tr) => {
      // Every cell of the rectangle, the ones a merge covers too: Word paints each row's part of
      // a merged cell from its own properties.
      for (let r = top; r <= bottom; r++) {
        let at = rowPos(table, pos, r) + 1;
        for (const c of placed(table.child(r))) {
          if (c.column >= left && c.column <= right)
            tr.setNodeMarkup(at, c.cell.type, { ...c.cell.attrs, shading });
          at += c.cell.nodeSize;
        }
      }
    });
  };
}

/** The narrowest a column gets by dragging its border, in twips (0.1 inch). */
const MIN_COLUMN = 144;

/**
 * Sets grid column `column` of the table at `pos` to `width` twips, as dragging its right border
 * does in Word: the column after it gives or takes the difference (the table keeps its width),
 * neither narrower than 0.1 inch; the last column's border widens or narrows the table. The
 * widths in twips of the cells over those columns follow. Not while tracking.
 */
export function setColumnWidth(pos: number, column: number, width: number): Command {
  return (state, dispatch) => {
    if (tracking(state)) return false;
    const table = state.doc.nodeAt(pos);
    if (table?.type.name !== "table" || !Number.isFinite(width)) return false;
    const grid = [...(table.attrs.grid as number[])];
    const old = grid[column];
    if (old === undefined) return false;
    const after = grid[column + 1];
    // Two columns too narrow to give each other anything.
    if (after !== undefined && old + after < 2 * MIN_COLUMN) return false;
    let next = Math.min(Math.max(Math.round(width), MIN_COLUMN), MAX_TWIPS);
    if (after !== undefined) next = Math.min(next, old + after - MIN_COLUMN);
    if (next === old) return false;
    if (after !== undefined) grid[column + 1] = after - (next - old);
    grid[column] = next;
    // The last column's border: a table width in twips grows or shrinks with it.
    const tableWidth = table.attrs.width as { value: number; type: string } | null;
    const widthAttr =
      after === undefined && tableWidth?.type === "dxa"
        ? { value: Math.min(Math.max(tableWidth.value + next - old, 0), MAX_TWIPS), type: "dxa" }
        : tableWidth;
    let rebuilt: Node | null;
    try {
      rebuilt = rebuild(table, { ...table.attrs, grid, gridExt: null, width: widthAttr }, (row) =>
        row.type.create(
          row.attrs,
          placed(row).map((c) =>
            c.cell.type.create(widthFor(c.cell.attrs, grid, c.column, c.span), c.cell.content),
          ),
        ),
      );
    } catch (error) {
      // A grid the schema does not take (a width out of its range): the drag does not apply.
      if (error instanceof FoliDocumentError) return false;
      throw error;
    }
    if (!rebuilt) return false;
    return apply(state, dispatch, (tr) => {
      const selection = tr.selection.toJSON();
      tr.replace(pos, pos + table.nodeSize, new Slice(Fragment.from(rebuilt), 0, 0));
      // The same shape: the selection stays where it was.
      tr.setSelection(Selection.fromJSON(tr.doc, selection));
    });
  };
}
