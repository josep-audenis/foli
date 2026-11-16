/**
 * Table commands (10.7, ADR-0006): inserting a table, inserting and deleting rows and columns,
 * deleting a table. They act on the table around the selection: the rectangle of a cell
 * selection, or the cell holding the caret. Rows are inserted and deleted as tracked changes
 * while tracking (the rebuild records them, 10.6a); column changes are not tracked by Foli yet,
 * so they do not apply while tracking.
 */
import { Fragment, type Node, Slice } from "../model/index.js";
import { attempt } from "./attempt.js";
import { deleteSelectionKeepingTables } from "./commands.js";
import { Selection } from "./selection.js";
import type { Command, EditorState, Transaction } from "./state.js";
import {
  CellSelection,
  cellDepth,
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
    return attempt(state, dispatch, (tr) => {
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
    const row = plain.type.create(plain.attrs, cells);
    const at = dir < 0 ? rowPos(table, pos, index) : rowPos(table, pos, index + 1);
    return attempt(state, dispatch, (tr) => {
      tr.insert(at, row);
      caretIn(tr, at + 1);
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
  return attempt(state, dispatch, (tr) => {
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
    caretIn(tr, last ? rowPos(table, pos, top - 1) + 1 : tr.mapping.map(from) + 1);
  });
};

/** Deletes the table around the selection (while tracking, its rows are tracked deletions). */
export const deleteTable: Command = (state, dispatch) => {
  const found = around(state);
  if (!found) return false;
  const { table, pos } = found;
  return attempt(state, dispatch, (tr) => {
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
  if (width?.type !== "dxa") return attrs;
  const value = grid.slice(column, column + span).reduce((a, b) => a + b, 0);
  return { ...attrs, width: { value: Math.max(value, 0), type: "dxa" } };
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
      // A row ending before the new column: as it is (Word leaves short rows short).
      if (at > end) return row;
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
    return attempt(state, dispatch, (tr) => replaceTable(tr, pos, table, next, top, at));
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
  return attempt(state, dispatch, (tr) =>
    replaceTable(tr, pos, table, next, top, Math.min(left, width - removed - 1)),
  );
};
