/**
 * Editing across a table's edges (10.6, ADR-0006): a range delete that keeps tables valid, as
 * Word does. A selection inside one cell is ordinary text. One that runs from outside a table
 * into it takes the whole rows it touches (the whole table when it touches every row); one
 * across cells of a table empties those cells. Nothing is joined across a table's edge.
 */
import { Fragment, type Node, type ResolvedPos, Slice } from "../model/index.js";
import type { Mappable } from "../transform/stepmap.js";
import { attempt as attemptTr } from "./attempt.js";
import { MARK_ATTRS } from "./mark.js";
import { Selection, type SelectionJSON, TextSelection } from "./selection.js";
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
  emptyCells(
    tr,
    cells.map((c) => c.pos),
  );
}

/**
 * Empties the cells at positions (positions before them, any order): their text deleted
 * (paragraphs in a cell joined), so a tracked clear can be rejected; a cell holding other blocks
 * (a nested table) gets one empty paragraph instead.
 */
export function emptyCells(tr: Transaction, positions: readonly number[]): void {
  for (const pos of [...positions].sort((a, b) => b - a)) {
    const node = tr.doc.nodeAt(pos);
    if (node?.type.name !== "tableCell") continue;
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
    const row = emptyRowLike(table.lastChild as Node);
    if (!row) return false;
    const insertAt = tableStart + table.nodeSize - 1;
    return attemptTr(state, dispatch, (tr) => {
      tr.insert(insertAt, row);
      tr.setSelection(TextSelection.create(tr.doc, insertAt + 3));
    });
  };
}

/**
 * A new row like `last`: its properties, not its identity (`w14:paraId`…) or revisions; its
 * cells empty, unmerged, their paragraph with the first one's properties, without what only one
 * paragraph has. Null when the schema has no paragraph.
 */
function emptyRowLike(last: Node): Node | null {
  const paragraph = last.type.schema.nodes.paragraph;
  if (!paragraph) return null;
  const rowAttrs = { ...last.attrs, revision: null, header: null, attributes: null };
  const markOnly = Object.fromEntries(MARK_ATTRS.map((key) => [key, null]));
  const cells: Node[] = [];
  last.forEach((cell) => {
    const first = cell.firstChild;
    const own = first?.type === paragraph ? { ...first.attrs, ...markOnly } : null;
    cells.push(cell.type.create({ ...cell.attrs, vMerge: null }, paragraph.create(own)));
  });
  return last.type.create(rowAttrs, cells);
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

// ---- Cell selections (10.6c) ---------------------------------------------------------------------

/** A cell where a table's grid has it: its position and the rows and grid columns it covers. */
interface GridCell {
  pos: number;
  row: number;
  rowSpan: number;
  column: number;
  span: number;
}

/** A table's cells on its grid (a merge's first cell spans the rows its merge covers). */
function gridOf(table: Node, start: number): GridCell[] {
  const out: GridCell[] = [];
  const open = new Map<number, GridCell>();
  let rowPos = start + 1;
  table.forEach((row, _o, r) => {
    let column = (row.attrs.gridBefore as number | null) ?? 0;
    let cellPos = rowPos + 1;
    row.forEach((cell) => {
      const span = (cell.attrs.gridSpan as number | null) ?? 1;
      const above = open.get(column);
      // A merge continues only right below its last row (a row without that column ends it).
      if (cell.attrs.vMerge === "continue" && above && above.row + above.rowSpan === r)
        above.rowSpan++;
      else {
        const entry = { pos: cellPos, row: r, rowSpan: 1, column, span };
        out.push(entry);
        if (cell.attrs.vMerge === "restart") open.set(column, entry);
        else open.delete(column);
      }
      column += span;
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });
  return out;
}

/**
 * Cells selected as a rectangle (ADR-0006): `anchor` and `head` are the positions before two
 * cells of one table; the selection is every cell in the rectangle between them, widened until
 * no merged cell sticks out. `from` and `to` are the rectangle's first and last cell's edges.
 */
export class CellSelection extends Selection {
  /** The positions of the selected cells, in document order. */
  readonly cells: readonly number[];

  constructor($anchorCell: ResolvedPos, $headCell: ResolvedPos) {
    super($anchorCell, $headCell);
    this.cells = rectangle($anchorCell, $headCell);
  }

  /** A cell selection from the cell at `anchor` to the one at `head` (positions before them). */
  static create(doc: Node, anchor: number, head = anchor): CellSelection {
    return new CellSelection(doc.resolve(anchor), doc.resolve(head));
  }

  /** Whether `pos` is the position before a cell, and `other` before a cell of the same table. */
  static valid(doc: Node, anchor: number, head: number): boolean {
    const a = doc.resolve(anchor);
    const h = doc.resolve(head);
    return (
      a.nodeAfter?.type.name === "tableCell" &&
      h.nodeAfter?.type.name === "tableCell" &&
      a.depth === h.depth &&
      a.before(a.depth - 1) === h.before(h.depth - 1)
    );
  }

  override get from(): number {
    return this.cells[0] ?? this.anchor;
  }

  override get to(): number {
    const last = this.cells[this.cells.length - 1] ?? this.head;
    return last + ((this.$head.doc.nodeAt(last)?.nodeSize as number | undefined) ?? 0);
  }

  override get empty(): boolean {
    return false;
  }

  /** Each selected cell's content. */
  override get ranges(): readonly { from: number; to: number }[] {
    const doc = this.$head.doc;
    return this.cells.map((pos) => ({
      from: pos + 1,
      to: pos + ((doc.nodeAt(pos)?.nodeSize as number | undefined) ?? 2) - 1,
    }));
  }

  /** Still these cells when both survive the mapping; a text selection near the head otherwise. */
  map(doc: Node, mapping: Mappable): Selection {
    const anchor = mapping.mapResult(this.anchor, 1);
    const head = mapping.mapResult(this.head, 1);
    if (!anchor.deleted && !head.deleted && CellSelection.valid(doc, anchor.pos, head.pos))
      return CellSelection.create(doc, anchor.pos, head.pos);
    return Selection.near(doc.resolve(Math.min(head.pos, doc.content.size)));
  }

  toJSON(): SelectionJSON {
    return { type: "cell", anchor: this.anchor, head: this.head };
  }
}

/** The grid cell covering the cell at `pos` of `table` (at `start`): a merge's, for a covered one. */
function coveringCell(
  table: Node,
  start: number,
  grid: readonly GridCell[],
  pos: number,
): GridCell | undefined {
  let rowPos = start + 1;
  for (let r = 0; r < table.childCount; r++) {
    const row = table.child(r);
    let column = (row.attrs.gridBefore as number | null) ?? 0;
    let cellPos = rowPos + 1;
    for (let i = 0; i < row.childCount; i++) {
      const cell = row.child(i);
      if (cellPos === pos) return coveringAt(grid, r, column);
      column += (cell.attrs.gridSpan as number | null) ?? 1;
      cellPos += cell.nodeSize;
    }
    rowPos += row.nodeSize;
  }
  return undefined;
}

/** The grid cell covering `row` and `column`. */
const coveringAt = (grid: readonly GridCell[], row: number, column: number) =>
  grid.find(
    (c) =>
      c.row <= row && row < c.row + c.rowSpan && c.column <= column && column < c.column + c.span,
  );

/** The cells (positions) of the rectangle between two cells of a table, merges widening it. */
function rectangle($anchor: ResolvedPos, $head: ResolvedPos): number[] {
  const tableDepth = $anchor.depth - 1;
  const table = $anchor.node(tableDepth);
  const start = $anchor.before(tableDepth);
  const grid = gridOf(table, start);
  const cellAt = (pos: number) =>
    grid.find((c) => c.pos === pos) ?? coveringCell(table, start, grid, pos);
  const a = cellAt($anchor.pos);
  const h = cellAt($head.pos);
  if (!a || !h) return [$anchor.pos];
  let top = Math.min(a.row, h.row);
  let bottom = Math.max(a.row + a.rowSpan, h.row + h.rowSpan) - 1;
  let left = Math.min(a.column, h.column);
  let right = Math.max(a.column + a.span, h.column + h.span) - 1;
  const inside = (c: GridCell) =>
    c.row <= bottom &&
    c.row + c.rowSpan - 1 >= top &&
    c.column <= right &&
    c.column + c.span - 1 >= left;
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of grid) {
      if (!inside(c)) continue;
      const next = [
        Math.min(top, c.row),
        Math.max(bottom, c.row + c.rowSpan - 1),
        Math.min(left, c.column),
        Math.max(right, c.column + c.span - 1),
      ];
      if (next[0] !== top || next[1] !== bottom || next[2] !== left || next[3] !== right) {
        [top, bottom, left, right] = next as [number, number, number, number];
        changed = true;
      }
    }
  }
  return grid.filter(inside).map((c) => c.pos);
}

Selection.kinds.set("cell", (doc, json) => {
  const clamp = (pos: number) => Math.max(0, Math.min(pos, doc.content.size));
  const anchor = clamp(json.anchor);
  const head = clamp(json.head);
  return CellSelection.valid(doc, anchor, head)
    ? CellSelection.create(doc, anchor, head)
    : Selection.near(doc.resolve(head));
});
/**
 * Shift+arrows across cells: a cell selection's head moves to the cell beside it (`axis`
 * "row": the cell above or below; "column": left or right); from a caret or text selection in
 * a cell (the view says it leaves the cell) a cell selection starts, from that cell to the next.
 * Does not apply where there is no cell that way.
 */
export function extendCellSelection(axis: "row" | "column", dir: 1 | -1): Command {
  return (state, dispatch) => {
    const { selection } = state;
    let anchor: number;
    let head: number;
    if (selection instanceof CellSelection) {
      anchor = selection.anchor;
      head = selection.head;
    } else {
      const found = headCell(state);
      if (!found) return false;
      head = found.$pos.before(found.depth);
      const $a = selection.$anchor;
      const a = cellDepth($a);
      // A selection that started outside this cell's table is not a cell selection's.
      anchor =
        a === found.depth && $a.before(a - 2) === found.$pos.before(found.depth - 2)
          ? $a.before(a)
          : head;
    }
    const $head = state.doc.resolve(head);
    const tableDepth = $head.depth - 1;
    const table = $head.node(tableDepth);
    const tableStart = $head.before(tableDepth);
    const grid = gridOf(table, tableStart);
    const at = grid.find((c) => c.pos === head);
    if (!at) return false;
    let next: GridCell | undefined;
    if (axis === "row") {
      const row = dir > 0 ? at.row + at.rowSpan : at.row - 1;
      next = grid.find(
        (c) =>
          c.row <= row &&
          row < c.row + c.rowSpan &&
          c.column <= at.column &&
          at.column < c.column + c.span,
      );
    } else {
      const column = dir > 0 ? at.column + at.span : at.column - 1;
      next = grid.find(
        (c) =>
          c.row <= at.row &&
          at.row < c.row + c.rowSpan &&
          c.column <= column &&
          column < c.column + c.span,
      );
    }
    if (!next) return false;
    dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, anchor, next.pos)));
    return true;
  };
}

// ---- Copying and pasting cells (10.6d) ---------------------------------------------------------

/**
 * The selected cells as a table of their own, for the clipboard (ADR-0006): the rows the
 * rectangle covers, each cut to its columns (with the cells a merge covers), and the grid's
 * widths of those columns. A row with no cell in those columns is left out.
 */
export function cellsAsTable(selection: CellSelection): Node {
  const $cell = selection.$anchor;
  const tableDepth = $cell.depth - 1;
  const table = $cell.node(tableDepth);
  const chosen = gridOf(table, $cell.before(tableDepth)).filter((c) =>
    selection.cells.includes(c.pos),
  );
  const top = Math.min(...chosen.map((c) => c.row));
  const bottom = Math.max(...chosen.map((c) => c.row + c.rowSpan - 1));
  const left = Math.min(...chosen.map((c) => c.column));
  const right = Math.max(...chosen.map((c) => c.column + c.span - 1));
  const rows: Node[] = [];
  table.forEach((row, _o, r) => {
    if (r < top || r > bottom) return;
    let column = (row.attrs.gridBefore as number | null) ?? 0;
    let first = -1;
    let end = 0;
    const cells: Node[] = [];
    row.forEach((cell) => {
      const span = (cell.attrs.gridSpan as number | null) ?? 1;
      if (column >= left && column + span - 1 <= right) {
        if (first < 0) first = column;
        end = column + span;
        cells.push(cell);
      }
      column += span;
    });
    // shortcut: a row with no cell in these columns is left out, so the rows after it paste one
    // row higher; keep a placeholder row once pasting can tell one apart.
    if (!cells.length) return;
    const before = first - left;
    const after = right + 1 - end;
    rows.push(
      row.type.create(
        {
          ...row.attrs,
          // Not the row's identity (`w14:paraId`…) nor its revision: a copy is a new row.
          revision: null,
          attributes: null,
          gridBefore: before || null,
          gridAfter: after || null,
          // The widths of the grid columns left empty, while they are the same columns.
          widthBefore: before === (row.attrs.gridBefore ?? 0) ? row.attrs.widthBefore : null,
          widthAfter: after === (row.attrs.gridAfter ?? 0) ? row.attrs.widthAfter : null,
        },
        cells,
      ),
    );
  });
  const grid = table.attrs.grid as number[];
  const whole = left === 0 && right + 1 >= grid.length;
  return table.type.create(
    whole
      ? table.attrs
      : { ...table.attrs, grid: grid.slice(left, right + 1), gridExt: null, width: null },
    rows,
  );
}

/**
 * Pastes `table`'s rows into the table at `tr`'s selection (ADR-0006), from a cell selection's
 * first cell or the cell holding the selection: each pasted cell's content replaces that of the
 * cell at the same place from there, rows like the last one are added as needed, cells past the
 * table's last column are dropped, and a cell of the target a merge covers takes only the first
 * pasted cell it covers. The pasted cells end up selected. Returns false, doing nothing, when the
 * selection is not in one cell (or cells) of a table or no pasted cell lands in the table.
 */
export function pasteCells(tr: Transaction, table: Node): boolean {
  const { selection } = tr;
  let start: number;
  if (selection instanceof CellSelection) start = selection.cells[0] ?? selection.anchor;
  else {
    const { $from, $to } = selection;
    const depth = cellDepth($from);
    // A selection reaching out of its cell is not pasted into cells.
    if (depth < 0 || cellDepth($to) !== depth || $from.before(depth) !== $to.before(depth))
      return false;
    start = $from.before(depth);
  }
  const $start = tr.doc.resolve(start);
  const tableDepth = $start.depth - 1;
  const tablePos = $start.before(tableDepth);
  let current = $start.node(tableDepth);
  let grid = gridOf(current, tablePos);
  const origin = grid.find((c) => c.pos === start);
  if (!origin) return false;
  const width = Math.max(
    (current.attrs.grid as number[]).length,
    ...grid.map((c) => c.column + c.span),
  );
  const targets: { row: number; column: number; cell: Node }[] = [];
  table.forEach((row, _o, i) => {
    let column = origin.column + ((row.attrs.gridBefore as number | null) ?? 0);
    row.forEach((cell) => {
      if (cell.attrs.vMerge !== "continue" && column < width)
        targets.push({ row: origin.row + i, column, cell });
      column += (cell.attrs.gridSpan as number | null) ?? 1;
    });
  });
  if (!targets.length) return false;
  // The rows missing, added in one step.
  const rows = Math.max(...targets.map((t) => t.row)) + 1;
  if (current.childCount < rows) {
    const added = emptyRowLike(current.lastChild as Node);
    if (!added) return false;
    const extra = Array.from({ length: rows - current.childCount }, () => added);
    tr.insert(tablePos + current.nodeSize - 1, Fragment.from(extra));
    current = tr.doc.nodeAt(tablePos) as Node;
    grid = gridOf(current, tablePos);
  }
  // Each target cell once (the first pasted cell it covers), filled from the end so the
  // positions found before stay valid.
  const fills = new Map<number, { at: GridCell; cell: Node }>();
  for (const { row, column, cell } of targets) {
    const at = coveringAt(grid, row, column);
    if (at && !fills.has(at.pos)) fills.set(at.pos, { at, cell });
  }
  if (!fills.size) return false;
  for (const { at, cell } of [...fills.values()].sort((a, b) => b.at.pos - a.at.pos)) {
    const target = tr.doc.nodeAt(at.pos) as Node;
    tr.replace(at.pos + 1, at.pos + target.nodeSize - 1, new Slice(cell.content, 0, 0));
  }
  // The rectangle of the filled cells.
  const filled = [...fills.values()].map((f) => f.at);
  const after = gridOf(tr.doc.nodeAt(tablePos) as Node, tablePos);
  const first = coveringAt(
    after,
    Math.min(...filled.map((c) => c.row)),
    Math.min(...filled.map((c) => c.column)),
  );
  const last = coveringAt(
    after,
    Math.max(...filled.map((c) => c.row + c.rowSpan - 1)),
    Math.max(...filled.map((c) => c.column + c.span - 1)),
  );
  // A corner no cell covers (a shorter row): the first and last cells filled instead.
  const one = filled[0] as GridCell;
  const end = filled[filled.length - 1] as GridCell;
  const from = first ?? coveringAt(after, one.row, one.column);
  const to = last ?? coveringAt(after, end.row, end.column);
  if (from && to) tr.setSelection(CellSelection.create(tr.doc, from.pos, to.pos));
  return true;
}
