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

/** The depth of the outermost table around `$pos` that does not hold `other`, or -1. */
function outerTable($pos: ResolvedPos, other: number): number {
  for (let d = 1; d <= $pos.depth; d++) {
    if (!isTable($pos.node(d))) continue;
    const start = $pos.before(d);
    if (other < start || other > start + $pos.node(d).nodeSize) return d;
  }
  return -1;
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
  const tableTo = outerTable($to, from);
  const tableFrom = outerTable($from, to);
  if (tableTo < 0 && tableFrom < 0) {
    clearCells(tr, from, to);
    return true;
  }
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

/** Empties the cells from the one holding `from` to the one holding `to` (in document order). */
function clearCells(tr: Transaction, from: number, to: number): void {
  const cells: { pos: number; node: Node }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== "tableCell") return true;
    cells.push({ pos, node });
    return true;
  });
  // Innermost cells only (a nested table's cells, not the outer cell holding them whole).
  const inner = cells.filter(
    (c) => !cells.some((o) => o !== c && o.pos > c.pos && o.pos < c.pos + c.node.nodeSize),
  );
  for (const { pos, node } of inner.reverse()) {
    const first = node.firstChild;
    const paragraph =
      first?.type.name === "paragraph"
        ? first.type.create(first.attrs)
        : node.type.schema.nodes.paragraph?.create();
    if (!paragraph) continue;
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
