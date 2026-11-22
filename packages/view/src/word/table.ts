/**
 * Tables in the editable view (10.5, ADR-0006): the document's blocks as the view renders them
 * (top-level paragraphs and opaque blocks, and every block inside table cells, in document
 * order: each a unit with its own position, leaves and fragments), and each table's frame: the
 * table, row and cell elements around its units, built from the model for the rows a page holds.
 * Built with createElement only.
 */
import type { Node as ModelNode } from "@folijs/core";
import type { CellFormat, Resolver } from "@folijs/core/internal";
import { borderJsonCss, PX_PER_TWIP, tableLayout } from "./blocks.js";

/**
 * A block the view renders: its node, the position before it, and the cell format it is in.
 * @internal
 */
export interface Unit {
  readonly node: ModelNode;
  readonly pos: number;
  readonly cell: CellFormat | null;
}

/**
 * What a cell holds, in order: units (by index) and nested tables.
 * @internal
 */
export type CellItem = { unit: number } | { frame: Frame };

/** @internal */
export interface FrameCell {
  readonly node: ModelNode;
  /** The first grid column it covers, and how many. */
  readonly column: number;
  readonly span: number;
  readonly vMerge: "restart" | "continue" | null;
  readonly format: CellFormat;
  readonly items: readonly CellItem[];
}

/** @internal */
export interface FrameRow {
  readonly node: ModelNode;
  readonly header: boolean;
  readonly cantSplit: boolean;
  /** Twips; `exact` is drawn as at least (shortcut: cells never clip their content). */
  readonly height: number | null;
  readonly cells: readonly FrameCell[];
}

/**
 * A table as the view draws it.
 * @internal
 */
export interface Frame {
  readonly node: ModelNode;
  readonly pos: number;
  readonly rows: readonly FrameRow[];
  /** Twips per grid column. */
  readonly grid: readonly number[];
  /** The leading header rows (repeated on each page the table continues on). */
  readonly headers: number;
  readonly css: { marginLeft: string; justify: string | null };
  /** The units inside it, nested tables' included: `[first, end)`. */
  readonly first: number;
  readonly end: number;
}

/**
 * A top-level item of the page flow: a unit (paragraph, opaque block) or a table.
 * @internal
 */
export type FlowItem = { unit: number; frame?: undefined } | { frame: Frame; unit?: undefined };

/**
 * The units and flow items of `doc`, in document order.
 * @internal
 */
export function collect(doc: ModelNode, resolver: Resolver): { units: Unit[]; items: FlowItem[] } {
  const units: Unit[] = [];
  const items: FlowItem[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === "table") items.push({ frame: frameOf(node, offset, resolver, units) });
    else {
      items.push({ unit: units.length });
      units.push({ node, pos: offset, cell: null });
    }
  });
  return { units, items };
}

function frameOf(table: ModelNode, pos: number, resolver: Resolver, units: Unit[]): Frame {
  const first = units.length;
  const attrs = table.attrs as Record<string, unknown>;
  const format = resolver.table(attrs);
  const rows: FrameRow[] = [];
  let rowPos = pos + 1;
  table.forEach((row, _r, r) => {
    const rowAttrs = row.attrs as Record<string, unknown>;
    let column = (rowAttrs.gridBefore as number | null) ?? 0;
    const cells: FrameCell[] = [];
    let cellPos = rowPos + 1;
    row.forEach((cell, _c, c) => {
      const cellAttrs = cell.attrs as Record<string, unknown>;
      const cellFormat = resolver.cell(attrs, rowAttrs, cellAttrs, {
        row: r,
        rows: table.childCount,
        cell: c,
        cells: row.childCount,
      });
      const items: CellItem[] = [];
      cell.forEach((block, offset) => {
        const at = cellPos + 1 + offset;
        if (block.type.name === "table") items.push({ frame: frameOf(block, at, resolver, units) });
        else {
          items.push({ unit: units.length });
          units.push({ node: block, pos: at, cell: cellFormat });
        }
      });
      const span = (cellAttrs.gridSpan as number | null) ?? 1;
      cells.push({
        node: cell,
        column,
        span,
        vMerge: (cellAttrs.vMerge as FrameCell["vMerge"]) ?? null,
        format: cellFormat,
        items,
      });
      column += span;
      cellPos += cell.nodeSize;
    });
    const height = rowAttrs.height as { value: number } | null;
    rows.push({
      node: row,
      header: !!rowAttrs.header,
      cantSplit: !!rowAttrs.cantSplit,
      height: height?.value ?? null,
      cells,
    });
    rowPos += row.nodeSize;
  });
  let headers = 0;
  while (headers < rows.length && rows[headers]?.header) headers++;
  // Word repeats header rows only while some body row follows them.
  if (headers === rows.length) headers = 0;
  const indent = format.indent?.type === "dxa" ? format.indent.value : 0;
  return {
    node: table,
    pos,
    rows,
    grid: (attrs.grid as number[] | undefined) ?? [],
    headers,
    css: {
      marginLeft: `${indent * PX_PER_TWIP}px`,
      justify:
        format.justification === "center" || format.justification === "right"
          ? format.justification
          : null,
    },
    first,
    end: units.length,
  };
}

/**
 * Marks a table's elements (wrapper, table, rows, cells): they hold blocks, not content.
 * @internal
 */
export const FRAME_ATTR = "data-foli-frame";
/**
 * Marks a repeated header row: shown, not document content.
 * @internal
 */
export const REPEATED_ATTR = "data-foli-repeated";

/**
 * The wrapper and table for `rows` of `frame` (indexes, in order), with `headers` (indexes of
 * header rows drawn again above them, not editable). `content(row, cell)` gives what a cell
 * shows on this page; a cell a vertical merge covers is drawn by the merge's first cell when
 * that is on the page (spanning the rows it covers here), else as an empty cell of its own.
 * @internal
 */
export function frameElement(
  frame: Frame,
  rows: readonly number[],
  headers: readonly number[],
  content: (row: number, cell: number) => readonly Node[],
  doc: Document,
  /** An autofit table's columns as the whole table drew them (twips): its parts keep them. */
  columns?: readonly number[],
): HTMLElement {
  const wrapper = doc.createElement("div");
  wrapper.setAttribute(FRAME_ATTR, "table");
  wrapper.style.display = "flow-root";
  const table = doc.createElement("table");
  table.setAttribute(FRAME_ATTR, "");
  const { style } = table;
  style.borderCollapse = "collapse";
  const measured = columns?.length === frame.grid.length ? columns : undefined;
  // A part of a measured autofit table: fixed at the columns the whole table drew.
  style.tableLayout = measured ? "fixed" : tableLayout(frame.node.attrs.layout);
  const grid = measured ?? frame.grid;
  const total = grid.reduce((a, b) => a + b, 0);
  if (total) style.width = `${total * PX_PER_TWIP}px`;
  if (frame.css.justify === "center") style.margin = "0 auto";
  else if (frame.css.justify === "right") style.marginLeft = "auto";
  else style.marginLeft = frame.css.marginLeft;
  const colgroup = doc.createElement("colgroup");
  for (const width of grid) {
    const col = doc.createElement("col");
    col.style.width = `${width * PX_PER_TWIP}px`;
    colgroup.append(col);
  }
  const body = doc.createElement("tbody");
  body.setAttribute(FRAME_ATTR, "");
  table.append(colgroup, body);
  for (const r of headers) {
    const repeated = rowElement(frame, r, [r], () => [], doc);
    repeated.setAttribute(REPEATED_ATTR, "");
    repeated.setAttribute("contenteditable", "false");
    repeated.setAttribute("aria-hidden", "true");
    // The header's text, drawn again: copied from the model's cells, not leaves.
    const source = frame.rows[r] as FrameRow;
    [...repeated.children].forEach((td, c) => {
      td.textContent = source.cells[c]?.node.textContent ?? "";
    });
    body.append(repeated);
  }
  for (const r of rows) body.append(rowElement(frame, r, rows, content, doc));
  wrapper.append(table);
  return wrapper;
}

function rowElement(
  frame: Frame,
  r: number,
  shown: readonly number[],
  content: (row: number, cell: number) => readonly Node[],
  doc: Document,
): HTMLElement {
  const row = frame.rows[r] as FrameRow;
  const tr = doc.createElement("tr");
  tr.setAttribute(FRAME_ATTR, "");
  if (row.header) tr.dataset.foliHeader = "";
  if (row.height) tr.style.height = `${row.height * PX_PER_TWIP}px`;
  row.cells.forEach((cell, c) => {
    // Covered by a merge whose first cell is drawn on this page: not shown. Its blocks (the
    // empty paragraph Word keeps) stay in document order, in a cell the table does not lay out.
    if (cell.vMerge === "continue" && mergeStartShown(frame, r, cell.column, shown)) {
      const td = doc.createElement("td");
      td.setAttribute(FRAME_ATTR, "covered");
      td.style.display = "none";
      td.append(...content(r, c));
      tr.append(td);
      return;
    }
    const td = doc.createElement("td");
    td.setAttribute(FRAME_ATTR, "");
    if (cell.span > 1) td.colSpan = cell.span;
    const rowSpan = covered(frame, r, cell.column, shown);
    if (rowSpan > 1) td.rowSpan = rowSpan;
    const { format } = cell;
    const s = td.style;
    if (format.shading) s.backgroundColor = `#${format.shading}`;
    const m = format.margins;
    s.padding = `${m.top * PX_PER_TWIP}px ${m.right * PX_PER_TWIP}px ${m.bottom * PX_PER_TWIP}px ${m.left * PX_PER_TWIP}px`;
    s.verticalAlign = format.verticalAlign === "center" ? "middle" : format.verticalAlign;
    for (const side of ["top", "left", "bottom", "right"] as const) {
      const css = borderJsonCss(format.borders[side]);
      if (css) s.setProperty(`border-${side}`, css);
    }
    td.append(...content(r, c));
    tr.append(td);
  });
  return tr;
}

/**
 * Whether a covered cell at (`r`, `column`) is drawn by a cell above it here: the row above is
 * shown and its cell there is part of the merge (its first cell, or one drawn for it because
 * the first is on an earlier page).
 */
function mergeStartShown(frame: Frame, r: number, column: number, shown: readonly number[]) {
  if (!shown.includes(r - 1)) return false;
  const above = frame.rows[r - 1]?.cells.find((x) => x.column === column);
  return above?.vMerge === "restart" || above?.vMerge === "continue";
}

/** How many shown rows from `r` a cell at `column` covers (itself and the merge below it). */
function covered(frame: Frame, r: number, column: number, shown: readonly number[]): number {
  let n = 1;
  for (let below = r + 1; shown.includes(below); below++) {
    const cell = frame.rows[below]?.cells.find((x) => x.column === column);
    if (cell?.vMerge !== "continue") break;
    n++;
  }
  return n;
}

/**
 * The columns of `wrapper`, a table of `frame` drawn whole, as the browser laid them out, in
 * twips: from the edges of its cells (each cell is the grid columns it spans). Undefined for a
 * fixed table, where they are its grid, or when an edge has no cell to read it from.
 * @internal
 */
export function drawnColumns(
  frame: Frame,
  wrapper: HTMLElement,
  /** CSS px on screen per layout px (the view's zoom). */
  scale = 1,
): number[] | undefined {
  if (tableLayout(frame.node.attrs.layout) === "fixed" || !frame.grid.length) return undefined;
  const table = wrapper.querySelector(`:scope > table[${FRAME_ATTR}]`);
  const trs = table?.querySelectorAll(`:scope > tbody > tr:not([${REPEATED_ATTR}])`) ?? [];
  if (trs.length !== frame.rows.length) return undefined;
  const edges = new Map<number, number>();
  // The outer edges are the table's: a cell's box holds only half of a collapsed border.
  const box = table?.getBoundingClientRect();
  if (box) {
    edges.set(0, box.left);
    edges.set(frame.grid.length, box.right);
  }
  trs.forEach((tr, r) => {
    const cells = (frame.rows[r] as FrameRow).cells;
    [...tr.children].forEach((td, i) => {
      const cell = cells[i];
      if (!cell || (td as HTMLElement).style.display === "none") return;
      const box = td.getBoundingClientRect();
      if (!edges.has(cell.column)) edges.set(cell.column, box.left);
      if (!edges.has(cell.column + cell.span)) edges.set(cell.column + cell.span, box.right);
    });
  });
  const out: number[] = [];
  for (let k = 0; k < frame.grid.length; k++) {
    const left = edges.get(k);
    const right = edges.get(k + 1);
    if (left === undefined || right === undefined) return undefined;
    out.push(Math.max(Math.round((right - left) / scale / PX_PER_TWIP), 1));
  }
  return out;
}
