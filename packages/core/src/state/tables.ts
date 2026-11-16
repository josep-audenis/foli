/**
 * Editing across a table's edges (10.6, ADR-0006): a range delete that keeps tables valid, as
 * Word does. A selection inside one cell is ordinary text. One that runs from outside a table
 * into it takes the whole rows it touches (the whole table when it touches every row); one
 * across cells of a table empties those cells. Nothing is joined across a table's edge.
 */
import { Fragment, type Node, type ResolvedPos, Slice } from "../model/index.js";
import type { Transaction } from "./state.js";

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
