/**
 * Editing across a table's edges (10.6, ADR-0006): a range delete that keeps tables valid, as
 * Word does. A selection inside one cell is ordinary text. One that runs from outside a table
 * into it takes the whole rows it touches (the whole table when it touches every row); one
 * across cells of a table empties those cells. Nothing is joined across a table's edge.
 */
import { Fragment, type Node, type ResolvedPos, Slice } from "../model/index.js";
import { attempt as attemptTr } from "./attempt.js";
import { MARK_ATTRS } from "./mark.js";
import { Selection, TextSelection } from "./selection.js";
import { type Command, type EditorState, Plugin, type Transaction } from "./state.js";

const isTable = (node: Node) => node.type.name === "table";

/** The depth of the innermost table cell around `$pos`, or -1. */
function cellDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "tableCell") return d;
  return -1;
}

/**
 * The depth of the table around `$pos` just below the depth the two ends share (`shared`), or
 * -1: only that table is cut (a table nested deeper goes with the rows or blocks around it).
 */
function tableBelow($pos: ResolvedPos, shared: number): number {
  return $pos.depth > shared && isTable($pos.node(shared + 1)) ? shared + 1 : -1;
}

/**
 * Deletes `from..to` in `tr` keeping tables valid; returns false (and does nothing) when an
 * ordinary delete keeps them valid (no end of the range inside a table it leaves).
 */
export function deleteAcrossTables(tr: Transaction, from: number, to: number): boolean {
  const doc = tr.doc;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const fromCell = cellDepth($from);
  const toCell = cellDepth($to);
  if (fromCell < 0 && toCell < 0) return false;
  if (fromCell >= 0 && toCell >= 0 && $from.before(fromCell) === $to.before(toCell)) return false;
  // Ends in different cells of one table (or of one row): those cells are emptied.
  const shared = $from.sharedDepth(to);
  const common = $from.node(shared).type.name;
  if (common === "table" || common === "tableRow") {
    clearCells(tr, from, to, $from.before(shared + 1), $to.after(shared + 1));
    return true;
  }
  const tableTo = tableBelow($to, shared);
  const tableFrom = tableBelow($from, shared);
  if (tableTo < 0 && tableFrom < 0) return false;
  // From the end backward, so earlier positions stay valid.
  let middleEnd = to;
  if (tableTo >= 0) {
    const table = $to.node(tableTo);
    const start = $to.before(tableTo);
    const row = $to.index(tableTo);
    if (row === table.childCount - 1) tr.delete(start, start + table.nodeSize);
    else {
      let end = start + 1;
      for (let r = 0; r <= row; r++) end += table.child(r).nodeSize;
      tr.delete(start + 1, end);
    }
    middleEnd = start;
  }
  let middleStart = from;
  let fromRows: [number, number] | null = null;
  if (tableFrom >= 0) {
    const table = $from.node(tableFrom);
    const start = $from.before(tableFrom);
    const end = start + table.nodeSize;
    const row = $from.index(tableFrom);
    if (row === 0) fromRows = [start, end];
    else {
      let rowStart = start + 1;
      for (let r = 0; r < row; r++) rowStart += table.child(r).nodeSize;
      fromRows = [rowStart, end - 1];
    }
    middleStart = end;
  }
  if (middleStart < middleEnd) deleteBetween(tr, middleStart, middleEnd);
  if (fromRows) tr.delete(fromRows[0], fromRows[1]);
  return true;
}

/**
 * Deletes `a..b`, where one end may be inside a paragraph and the other at a block boundary
 * (next to a table): the paragraph's part and the whole blocks between, each on its own, so no
 * paragraph is joined across the table.
 */
function deleteBetween(tr: Transaction, a: number, b: number): void {
  const $a = tr.doc.resolve(a);
  const $b = tr.doc.resolve(b);
  const ranges: [number, number][] = [];
  let blocksFrom = a;
  let blocksTo = b;
  if ($a.parent.inlineContent) {
    ranges.push([a, $a.end()]);
    blocksFrom = $a.after();
  }
  if ($b.parent.inlineContent) {
    ranges.push([$b.start(), b]);
    blocksTo = $b.before();
  }
  if (blocksFrom < blocksTo) ranges.push([blocksFrom, blocksTo]);
  for (const [s, e] of ranges.sort((x, y) => y[0] - x[0])) if (s < e) tr.delete(s, e);
}

/**
 * Empties the cells of one table (or row) from the one holding `from` to the one holding `to`,
 * in document order (`start..end`: the table's or row's children there). Their text is deleted
 * (paragraphs in a cell joined), so a tracked clear can be rejected; a cell holding other
 * blocks (a nested table) gets one empty paragraph instead.
 *
 * shortcut: the cells in document order, not Word's rectangle (`CellSelection` will give that).
 */
function clearCells(tr: Transaction, from: number, to: number, start: number, end: number): void {
  const cells: { pos: number; node: Node }[] = [];
  tr.doc.nodesBetween(start, end, (node, pos) => {
    const within = pos >= start && pos + node.nodeSize <= end;
    // A cell around the table the ends share (it is nested): go on into it.
    if (node.type.name !== "tableCell" || !within) return true;
    // A cell of the table or row the ends share (a nested table's are not entered).
    if (pos < to && pos + node.nodeSize > from) cells.push({ pos, node });
    return false;
  });
  for (const { pos, node } of cells.reverse()) {
    let paragraphs = true;
    node.forEach((child) => {
      if (child.type.name !== "paragraph") paragraphs = false;
    });
    if (paragraphs) {
      const textStart = pos + 2;
      const textEnd = pos + node.nodeSize - 2;
      if (textStart < textEnd) tr.delete(textStart, textEnd);
      continue;
    }
    const paragraph = node.type.schema.nodes.paragraph?.create();
    if (paragraph)
      tr.replace(pos + 1, pos + node.nodeSize - 1, new Slice(Fragment.from(paragraph), 0, 0));
  }
}

/**
 * Restores Word's rules after a delete: a paragraph between two tables that became adjacent
 * (Word would merge them) and after a table that ends the body, as Word puts one.
 */
export function keepTablesApart(tr: Transaction): void {
  const paragraph = tr.doc.type.schema.nodes.paragraph;
  if (!paragraph) return;
  const inserts: number[] = [];
  const visit = (parent: Node, start: number) => {
    let pos = start;
    parent.forEach((child, _offset, index) => {
      if (isTable(child)) {
        const next = parent.maybeChild(index + 1);
        if (next ? isTable(next) : parent.type.name === "doc") inserts.push(pos + child.nodeSize);
        // Cells of this table: their content too.
        let rowPos = pos + 1;
        child.forEach((row) => {
          let cellPos = rowPos + 1;
          row.forEach((cell) => {
            visit(cell, cellPos + 1);
            cellPos += cell.nodeSize;
          });
          rowPos += row.nodeSize;
        });
      }
      pos += child.nodeSize;
    });
  };
  visit(tr.doc, 0);
  for (const at of inserts.reverse()) tr.insert(at, paragraph.create());
}

// ---- Moving between cells (10.6b) --------------------------------------------------------------

/** The innermost cell around the selection head: its depth, or -1. */
function headCell(state: EditorState): { $pos: ResolvedPos; depth: number } | null {
  const $pos = state.selection.$head;
  const depth = cellDepth($pos);
  return depth < 0 ? null : { $pos, depth };
}

/** The positions of the cells of `table` (at `start`) one can go to, row by row (not those a merge covers). */
function cellsOf(table: Node, start: number): number[] {
  const out: number[] = [];
  let rowPos = start + 1;
  table.forEach((row) => {
    let cellPos = rowPos + 1;
    row.forEach((cell) => {
      if (cell.attrs.vMerge !== "continue") out.push(cellPos);
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });
  return out;
}

/** Selects a cell's content (Word's Tab does), or puts the caret in an empty one. */
function selectCell(tr: Transaction, cellPos: number): void {
  const cell = tr.doc.nodeAt(cellPos) as Node;
  const from = Selection.near(tr.doc.resolve(cellPos + 1), 1).from;
  const to = Selection.near(tr.doc.resolve(cellPos + cell.nodeSize - 1), -1).to;
  tr.setSelection(TextSelection.create(tr.doc, from, Math.max(from, to)));
}

/**
 * Tab (`dir` 1) and Shift+Tab (-1) in a table: the next or previous cell, its content selected,
 * as Word does. Tab in the last cell adds a row like the last one (its cells empty, no merge).
 * Does not apply outside a table.
 */
export function goToCell(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const found = headCell(state);
    if (!found) return false;
    const { $pos, depth } = found;
    const tableDepth = depth - 2;
    const table = $pos.node(tableDepth);
    const tableStart = $pos.before(tableDepth);
    const cells = cellsOf(table, tableStart);
    const at = cells.indexOf($pos.before(depth));
    const next = cells[at + dir];
    if (next !== undefined) {
      if (dispatch) {
        const tr = state.tr;
        selectCell(tr, next);
        dispatch(tr);
      }
      return true;
    }
    if (dir < 0) return true; // the first cell: Word stays
    // The last cell: a new row after the table's last one.
    const last = table.lastChild as Node;
    const { schema } = state;
    const paragraph = schema.nodes.paragraph;
    if (!paragraph) return false;
    // A new row: the last one's properties, not its identity (`w14:paraId`…) or revisions; its
    // paragraphs the first ones' properties, without what only one paragraph has.
    const rowAttrs = { ...last.attrs, revision: null, header: null, attributes: null };
    const markOnly = Object.fromEntries(MARK_ATTRS.map((key) => [key, null]));
    const newCells: Node[] = [];
    last.forEach((cell) => {
      const attrs = { ...cell.attrs, vMerge: null };
      const first = cell.firstChild;
      const own = first?.type === paragraph ? { ...first.attrs, ...markOnly } : null;
      newCells.push(cell.type.create(attrs, paragraph.create(own)));
    });
    const row = last.type.create(rowAttrs, newCells);
    const insertAt = tableStart + table.nodeSize - 1;
    return attemptTr(state, dispatch, (tr) => {
      tr.insert(insertAt, row);
      tr.setSelection(TextSelection.create(tr.doc, insertAt + 3));
    });
  };
}

/**
 * Up (`dir` -1) and Down (1) from the first or last line of a cell (the view says when): the
 * cell above or below that covers the same grid column (a merge's first cell), its last or first
 * line; from the table's first or last row, out of the table.
 */
export function goToCellVertically(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const found = headCell(state);
    if (!found) return false;
    const { $pos, depth } = found;
    // A selection of a cell's whole content (Tab's) moves as the cell; any other selection is
    // the browser's (a word selected on a line moves by line).
    if (!state.selection.empty) {
      const start = $pos.before(depth);
      const node = $pos.node(depth);
      const first = Selection.near(state.doc.resolve(start + 1), 1).from;
      const last = Selection.near(state.doc.resolve(start + node.nodeSize - 1), -1).to;
      if (state.selection.from > first || state.selection.to < last) return false;
    }
    // Only from the cell's first (last) paragraph.
    const index = $pos.index(depth);
    const cell = $pos.node(depth);
    if (dir < 0 ? index > 0 : index < cell.childCount - 1) return false;
    const rowDepth = depth - 1;
    const tableDepth = depth - 2;
    const table = $pos.node(tableDepth);
    const tableStart = $pos.before(tableDepth);
    const rowIndex = $pos.index(tableDepth);
    const column = columnOf($pos.node(rowDepth), $pos.index(rowDepth));
    let target: number | null = null;
    for (let r = rowIndex + dir; r >= 0 && r < table.childCount; r += dir) {
      const cellPos = cellAtColumn(table, tableStart, r, column);
      if (cellPos === null) continue;
      const node = state.doc.nodeAt(cellPos) as Node;
      // A covered cell is part of the merge above it: going up, the merge's first cell.
      if (node.attrs.vMerge === "continue") continue;
      target = cellPos;
      break;
    }
    // Out of the table: before or after it. Nothing there (the document's start or end, or a
    // nested table at its cell's edge): the browser's move.
    let out: Selection | null = null;
    if (target === null) {
      const pos = dir < 0 ? tableStart : tableStart + table.nodeSize;
      out = Selection.near(state.doc.resolve(pos), dir);
      const end = tableStart + table.nodeSize;
      if (out.from > tableStart && out.from < end) return false;
      const outer = cellDepth(state.doc.resolve(tableStart));
      if (outer >= 0 && out.$head.before(outer) !== state.doc.resolve(tableStart).before(outer))
        return false;
    }
    if (!dispatch) return true;
    const tr = state.tr;
    if (out) tr.setSelection(out);
    else if (target !== null) {
      const node = tr.doc.nodeAt(target) as Node;
      const pos = dir < 0 ? target + node.nodeSize - 1 : target + 1;
      tr.setSelection(Selection.near(tr.doc.resolve(pos), dir < 0 ? -1 : 1));
    }
    dispatch(tr);
    return true;
  };
}

/** The first grid column of a row's cell at `index` (`gridBefore` counted). */
function columnOf(row: Node, index: number): number {
  let column = (row.attrs.gridBefore as number | null) ?? 0;
  for (let i = 0; i < index; i++) column += (row.child(i).attrs.gridSpan as number | null) ?? 1;
  return column;
}

/** The position of the cell of row `r` covering grid column `column`, if any. */
function cellAtColumn(table: Node, tableStart: number, r: number, column: number): number | null {
  let rowPos = tableStart + 1;
  for (let i = 0; i < r; i++) rowPos += table.child(i).nodeSize;
  const row = table.child(r);
  let at = (row.attrs.gridBefore as number | null) ?? 0;
  let cellPos = rowPos + 1;
  for (let i = 0; i < row.childCount; i++) {
    const cell = row.child(i);
    const span = (cell.attrs.gridSpan as number | null) ?? 1;
    if (column >= at && column < at + span) return cellPos;
    at += span;
    cellPos += cell.nodeSize;
  }
  return null;
}
/** Tab and Shift+Tab between cells: before the lists' Tab (in a cell Word moves, numbered or not). */
export function tableKeymap(): Plugin {
  return new Plugin({ keymap: { Tab: goToCell(1), "Shift-Tab": goToCell(-1) } });
}
