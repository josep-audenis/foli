/**
 * How a schema v3 document looks: the effective paragraph and run formatting Word computes from
 * the document defaults, the styles and direct formatting (ECMA-376 Part 1, 17.7.2), and the
 * list markers numbering gives paragraphs (17.9). No DOM: the view turns these into CSS.
 */

import type { MarkJSON } from "../model/index.js";
import type {
  AbstractNumberingJSON,
  BorderJSON,
  CellPropertiesJSON,
  FoliDocument,
  MeasureJSON,
  NumberingInstanceJSON,
  NumberingLevelJSON,
  ParagraphPropertiesJSON,
  StyleJSON,
  TableCondition,
  TablePropertiesJSON,
  ThemeJSON,
} from "./document.js";

type Json = Record<string, unknown>;

/** Effective run formatting: what a run looks like after defaults, styles and direct marks. */
export interface RunFormat {
  bold: boolean;
  /** Bold for complex scripts (`w:bCs`). */
  boldCs: boolean;
  italic: boolean;
  italicCs: boolean;
  caps: boolean;
  smallCaps: boolean;
  strike: boolean;
  doubleStrike: boolean;
  hidden: boolean;
  /** Underline style (`single`, `double`…); null for none. */
  underline: string | null;
  underlineColor: string | null;
  /** Font names per script, theme fonts resolved; null where nothing names one. */
  font: { ascii: string | null; hAnsi: string | null; eastAsia: string | null; cs: string | null };
  /** Half-points (Word's default without any: 20, 10 pt). */
  size: number;
  sizeCs: number;
  /** `RRGGBB` (theme colors resolved); null for automatic. */
  color: string | null;
  highlight: string | null;
  /** Shading fill `RRGGBB`; null for none. */
  shading: string | null;
  verticalAlign: "baseline" | "superscript" | "subscript";
  /** Twips. */
  characterSpacing: number;
}

/** Effective paragraph properties: a paragraph's attributes after defaults, styles and numbering. */
export interface ParagraphFormat {
  /** The paragraph style that applies (the default paragraph style when none is named). */
  style: string | null;
  justification: string | null;
  /** Twips. Only one of `firstLine` and `hanging` is non-zero. */
  indent: { left: number; right: number; firstLine: number; hanging: number };
  spacing: {
    before: number;
    after: number;
    line: number | null;
    lineRule: "auto" | "exact" | "atLeast";
    beforeAutospacing: boolean;
    afterAutospacing: boolean;
  };
  keepNext: boolean;
  keepLines: boolean;
  widowControl: boolean;
  pageBreakBefore: boolean;
  contextualSpacing: boolean;
  outlineLevel: number | null;
  tabs: { position: number; kind: string; leader: string | null }[];
  borders: NonNullable<ParagraphPropertiesJSON["borders"]> | null;
  shading: ParagraphPropertiesJSON["shading"] | null;
  /** The numbering that applies (direct, or from the style): instance id and level. */
  numbering: { id: number; level: number } | null;
}

/** A paragraph's list marker. */
export interface ListMarker {
  /** As Word shows it ("1.", "1.1", "(a)", or a bullet's character as the file has it). */
  text: string;
  /** What follows the marker. */
  suffix: "tab" | "space" | "nothing";
  justification: string;
  /** The marker's formatting: the paragraph's, its mark's, then the level's run properties. */
  run: RunFormat;
  instance: number;
  level: number;
}

const TOGGLES = [
  "bold",
  "boldCs",
  "italic",
  "italicCs",
  "caps",
  "smallCaps",
  "strike",
  "doubleStrike",
  "hidden",
] as const;
type Toggle = (typeof TOGGLES)[number];

const DEFAULT_RUN: RunFormat = {
  bold: false,
  boldCs: false,
  italic: false,
  italicCs: false,
  caps: false,
  smallCaps: false,
  strike: false,
  doubleStrike: false,
  hidden: false,
  underline: null,
  underlineColor: null,
  font: { ascii: null, hAnsi: null, eastAsia: null, cs: null },
  size: 20,
  sizeCs: 20,
  color: null,
  highlight: null,
  shading: null,
  verticalAlign: "baseline",
  characterSpacing: 0,
};

/** While merging, the numbering level may be unknown (a style naming only the instance). */
type Merging = Omit<ParagraphFormat, "numbering"> & {
  numbering: { id: number; level: number | undefined } | null;
};

const DEFAULT_PARAGRAPH: Merging = {
  style: null,
  justification: null,
  indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
  spacing: {
    before: 0,
    after: 0,
    line: null,
    lineRule: "auto",
    beforeAutospacing: false,
    afterAutospacing: false,
  },
  keepNext: false,
  keepLines: false,
  widowControl: false,
  pageBreakBefore: false,
  contextualSpacing: false,
  outlineLevel: null,
  tabs: [],
  borders: null,
  shading: null,
  numbering: null,
};

const PLAIN_KEYS = new Set([
  "justification",
  "keepNext",
  "keepLines",
  "widowControl",
  "pageBreakBefore",
  "contextualSpacing",
  "outlineLevel",
  "shading",
]);

/** Paragraph properties merged in order, later winning, attribute by attribute as Word inherits them. */
function mergeParagraph(target: Merging, props: ParagraphPropertiesJSON | undefined): void {
  if (!props) return;
  const { indent, spacing, numbering, borders, tabs } = props;
  if (indent) {
    // A first-line indent and a hanging one are one value: setting one replaces the other.
    if (indent.firstLine !== undefined) target.indent.hanging = 0;
    Object.assign(target.indent, indent);
    // With both, Word applies the hanging indent.
    if (target.indent.hanging) target.indent.firstLine = 0;
  }
  if (spacing) Object.assign(target.spacing, spacing);
  if (numbering) {
    target.numbering = {
      id: numbering.id ?? target.numbering?.id ?? 0,
      level: numbering.level ?? target.numbering?.level,
    };
  }
  if (borders) target.borders = { ...target.borders, ...borders };
  if (tabs) {
    // Tab stops accumulate down the styles; a `clear` stop removes an inherited one.
    const stops = new Map(target.tabs.map((t) => [t.position, t]));
    for (const t of tabs) {
      if (t.kind === "clear") stops.delete(t.position);
      else stops.set(t.position, { position: t.position, kind: t.kind, leader: t.leader ?? null });
    }
    target.tabs = [...stops.values()].sort((a, b) => a.position - b.position);
  }
  for (const [key, value] of Object.entries(props)) {
    // A live node's attributes carry null for what is not set: it inherits.
    if (PLAIN_KEYS.has(key) && value != null) (target as unknown as Json)[key] = value;
  }
}

function cloneParagraph(p: Merging): Merging {
  return {
    ...p,
    indent: { ...p.indent },
    spacing: { ...p.spacing },
    tabs: p.tabs.map((t) => ({ ...t })),
    borders: p.borders
      ? Object.fromEntries(Object.entries(p.borders).map(([side, b]) => [side, { ...b }]))
      : null,
    shading: p.shading ? { ...p.shading } : null,
    numbering: p.numbering ? { ...p.numbering } : null,
  };
}

function cloneRun(r: RunFormat): RunFormat {
  return { ...r, font: { ...r.font } };
}

/** The toggle properties marks turn on or off (only those they name). */
function togglesOf(marks: readonly MarkJSON[] | undefined): Partial<Record<Toggle, boolean>> {
  const out: Partial<Record<Toggle, boolean>> = {};
  for (const m of marks ?? []) {
    const a = (m.attrs ?? {}) as Json;
    const value = a.value === undefined ? true : (a.value as boolean | null);
    switch (m.type) {
      case "bold":
      case "italic": {
        if (value !== null) out[m.type] = value;
        const cs = a.complexScript as boolean | null | undefined;
        if (cs !== null && cs !== undefined) out[m.type === "bold" ? "boldCs" : "italicCs"] = cs;
        break;
      }
      case "caps":
      case "smallCaps":
      case "strike":
      case "doubleStrike":
      case "hidden":
        if (value !== null) out[m.type] = value;
        break;
      default:
    }
  }
  return out;
}

/** Theme color names (`w:themeColor`) and the theme's color scheme entries they use. */
const THEME_COLORS: Record<string, string> = {
  text1: "dk1",
  background1: "lt1",
  text2: "dk2",
  background2: "lt2",
  dark1: "dk1",
  light1: "lt1",
  dark2: "dk2",
  light2: "lt2",
  hyperlink: "hlink",
  followedHyperlink: "folHlink",
};

/** Run properties other than toggles, applied in order (later wins). */
function mergeRun(
  target: RunFormat,
  marks: readonly MarkJSON[] | undefined,
  theme: ThemeJSON | undefined,
): void {
  for (const m of marks ?? []) {
    const a = (m.attrs ?? {}) as Json;
    switch (m.type) {
      case "underline": {
        const style = (a.style as string | undefined) ?? "single";
        target.underline = style === "none" ? null : style;
        target.underlineColor = (a.color as string | null | undefined) ?? null;
        break;
      }
      case "font":
        for (const script of ["ascii", "hAnsi", "eastAsia", "cs"] as const) {
          const themed = a[`${script}Theme`] as string | null | undefined;
          // A theme font the document has no theme for falls back to the name the file gives.
          const name =
            (themed && themeFont(theme, themed)) || (a[script] as string | null | undefined);
          if (name) target.font[script] = name;
        }
        break;
      case "fontSize":
        if (typeof a.value === "number") target.size = a.value;
        if (typeof a.complexScript === "number") target.sizeCs = a.complexScript;
        break;
      case "color": {
        // With a tint or shade, `value` is the computed color: Word writes it there.
        const themed =
          a.themeColor && !a.themeTint && !a.themeShade
            ? theme?.colors[THEME_COLORS[a.themeColor as string] ?? (a.themeColor as string)]
            : undefined;
        const value = (themed ?? a.value) as string | undefined;
        target.color = value === undefined || value === "auto" ? null : value.toUpperCase();
        break;
      }
      case "highlight":
        target.highlight = a.value === "none" ? null : (a.value as string);
        break;
      case "shading":
        target.shading =
          a.fill === "auto" || a.fill === undefined ? null : String(a.fill).toUpperCase();
        break;
      case "verticalAlign":
        target.verticalAlign = a.value as RunFormat["verticalAlign"];
        break;
      case "characterSpacing":
        target.characterSpacing = a.value as number;
        break;
      default:
    }
  }
}

/** Direct formatting: toggles set, everything else applied. */
function applyDirect(
  target: RunFormat,
  marks: readonly MarkJSON[] | undefined,
  theme: ThemeJSON | undefined,
): void {
  Object.assign(target, togglesOf(marks));
  mergeRun(target, marks, theme);
}

/**
 * A style chain's run formatting (root first). Within the chain a style overrides what it is
 * based on; the chain's toggles then flip the run's (ECMA-376 17.7.3), which is why a bold
 * character style on a bold heading shows plain text.
 */
function applyStyles(
  target: RunFormat,
  chain: readonly (readonly MarkJSON[])[],
  theme: ThemeJSON | undefined,
): void {
  const toggles: Partial<Record<Toggle, boolean>> = {};
  for (const marks of chain) {
    Object.assign(toggles, togglesOf(marks));
    mergeRun(target, marks, theme);
  }
  for (const key of TOGGLES) if (toggles[key]) target[key] = !target[key];
}

/** A theme font reference (`minorHAnsi`) as a font name. */
function themeFont(theme: ThemeJSON | undefined, ref: string): string | null {
  if (!theme) return null;
  const set = ref.startsWith("major") ? theme.fonts.major : theme.fonts.minor;
  const script = ref.slice(5);
  const name = script === "EastAsia" ? set.eastAsia : script === "Bidi" ? set.cs : set.latin;
  return name || null;
}

/** A counter in a number format (ST_NumberFormat); formats Foli does not know show as decimal. */
export function formatNumber(n: number, format: string | undefined): string {
  switch (format ?? "decimal") {
    case "none":
      return "";
    case "decimalZero":
      return n >= 0 && n < 10 ? `0${n}` : String(n);
    case "upperRoman":
      return roman(n);
    case "lowerRoman":
      return roman(n).toLowerCase();
    case "upperLetter":
      return letters(n);
    case "lowerLetter":
      return letters(n).toLowerCase();
    case "ordinal":
      return ordinal(n);
    default:
      return String(n);
  }
}

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let out = "";
  let rest = n;
  for (const [value, symbol] of ROMAN) {
    for (; rest >= value; rest -= value) out += symbol;
  }
  return out;
}

/** Word's letters: A…Z, then AA…ZZ, AAA… (the letter repeated). */
function letters(n: number): string {
  // shortcut: past 780 (30 letters) the number is written in digits, which bounds the string
  // a hostile counter can build; check what Word shows there if a real document gets that far.
  if (n <= 0 || n > 780) return String(n);
  return String.fromCharCode(65 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** A table's effective properties: its style's (the default table style's when it names none), then its own. */
export type TableFormat = Omit<TablePropertiesJSON, "style" | "ext"> & {
  /** The table style that applies. */
  style: string | null;
};

/** Where a cell is: its row among the table's rows, and its index among the row's cells. */
export interface CellPlace {
  row: number;
  rows: number;
  cell: number;
  cells: number;
}

type Side = "top" | "bottom" | "left" | "right";

/** A cell's effective formatting from the table style's parts that apply to it and its own properties. */
export interface CellFormat {
  /** The table style that applies. */
  style: string | null;
  /** The table style's parts that apply, in the order they apply (later wins). */
  conditions: TableCondition[];
  /** Fill `RRGGBB`; null for none. */
  shading: string | null;
  /** The cell's own edges before conflicts with its neighbours are resolved (left-to-right text). */
  borders: Partial<Record<Side, BorderJSON>>;
  /** Twips. */
  margins: Record<Side, number>;
  verticalAlign: "top" | "center" | "bottom" | "both";
}

/** A table style's parts for a set of conditions, flattened in the order they apply. */
interface TableLayer {
  key: string;
  paragraph: ParagraphPropertiesJSON[];
  run: MarkJSON[][];
  cell: CellPropertiesJSON[];
}

const TABLE_KEYS = new Set([
  "width",
  "justification",
  "indent",
  "layout",
  "borders",
  "cellMargins",
  "cellSpacing",
  "shading",
  "look",
  "rowBandSize",
  "columnBandSize",
]);
const PER_SIDE = new Set(["borders", "cellMargins", "look"]);

/** Table properties merged in order, later winning (borders and margins side by side). */
function mergeTable(target: Json, props: Json | undefined | null): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value == null || !TABLE_KEYS.has(key)) continue;
    target[key] = PER_SIDE.has(key) ? { ...(target[key] as Json), ...(value as Json) } : value;
  }
}

/** A cell margin in twips: Word measures margins in `dxa` (other types count as none). */
function twipsOf(measure: MeasureJSON | undefined): number | undefined {
  if (!measure) return undefined;
  return measure.type === "dxa" ? measure.value : 0;
}

/** The last value `pick` gives among `layers` (later layers win). */
function last<T, V>(layers: readonly T[], pick: (layer: T) => V | undefined | null): V | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const value = pick(layers[i] as T);
    if (value != null) return value;
  }
  return undefined;
}

/**
 * The table style's parts that apply to a cell, in Word's order: the whole table, banded
 * columns, banded rows, first and last column, first and last row, then the corners. The first
 * and last row and column (when `look` turns them on) are left out of banding.
 *
 * shortcut: banding and the first and last column count cells, not grid columns; not checked
 * against Word's drawing of a table with merged cells or rows starting late (`gridBefore`).
 */
export function tableConditions(
  look: NonNullable<TablePropertiesJSON["look"]>,
  place: CellPlace,
  rowBand = 1,
  columnBand = 1,
): TableCondition[] {
  const out: TableCondition[] = ["wholeTable"];
  const firstRow = !!look.firstRow && place.row === 0;
  const lastRow = !!look.lastRow && place.row === place.rows - 1;
  const firstCol = !!look.firstColumn && place.cell === 0;
  const lastCol = !!look.lastColumn && place.cell === place.cells - 1;
  if (!look.noVBand && !firstCol && !lastCol) {
    const i = place.cell - (look.firstColumn ? 1 : 0);
    out.push(Math.floor(i / columnBand) % 2 === 0 ? "band1Vert" : "band2Vert");
  }
  if (!look.noHBand && !firstRow && !lastRow) {
    const i = place.row - (look.firstRow ? 1 : 0);
    out.push(Math.floor(i / rowBand) % 2 === 0 ? "band1Horz" : "band2Horz");
  }
  if (firstCol) out.push("firstCol");
  if (lastCol) out.push("lastCol");
  if (firstRow) out.push("firstRow");
  if (lastRow) out.push("lastRow");
  if (firstRow && firstCol) out.push("nwCell");
  if (firstRow && lastCol) out.push("neCell");
  if (lastRow && firstCol) out.push("swCell");
  if (lastRow && lastCol) out.push("seCell");
  return out;
}

type Envelope = Pick<FoliDocument, "defaults" | "styles" | "numbering" | "theme" | "settings">;

interface Level {
  instance: NumberingInstanceJSON;
  abstract: AbstractNumberingJSON;
  index: number;
  level: NumberingLevelJSON;
}

/**
 * Resolves a document's formatting from its envelope (defaults, styles, numbering, theme).
 * Style resolutions are memoized: build one per envelope and reuse it.
 */
export class Resolver {
  readonly #styles = new Map<string, StyleJSON>();
  #defaultParagraphStyle: string | undefined;
  readonly #envelope: Envelope;
  readonly #paragraphStyles = new Map<
    string,
    { paragraph: Merging; run: RunFormat; chain: StyleJSON[] }
  >();
  readonly #characterStyles = new Map<string, MarkJSON[][]>();
  readonly #instances = new Map<number, NumberingInstanceJSON>();
  readonly #abstracts = new Map<number, AbstractNumberingJSON>();
  #defaultTableStyle: string | undefined;
  readonly #layers = new Map<string, TableLayer>();

  /** Whether a paragraph's space after and the next one's space before add up (else: the larger). */
  get addsParagraphSpacing(): boolean {
    return this.#envelope.settings?.doNotUseHTMLParagraphAutoSpacing === true;
  }

  constructor(envelope: Envelope) {
    this.#envelope = envelope;
    // With duplicate ids, the first wins, as in Word.
    for (const s of envelope.styles) if (!this.#styles.has(s.id)) this.#styles.set(s.id, s);
    // With several default styles of a type, the last one applies (ECMA-376 17.7.4.17).
    for (const s of envelope.styles) {
      if (s.type === "paragraph" && s.isDefault) this.#defaultParagraphStyle = s.id;
      if (s.type === "table" && s.isDefault) this.#defaultTableStyle = s.id;
    }
    for (const n of envelope.numbering.instances)
      if (!this.#instances.has(n.id)) this.#instances.set(n.id, n);
    for (const a of envelope.numbering.abstracts)
      if (!this.#abstracts.has(a.id)) this.#abstracts.set(a.id, a);
  }

  /** A style and those it is based on, the root first (a cycle or a missing style ends it). */
  #chain(id: string | undefined, type: StyleJSON["type"]): StyleJSON[] {
    const out: StyleJSON[] = [];
    const seen = new Set<string>();
    for (let at = id; at !== undefined && !seen.has(at); ) {
      seen.add(at);
      const style = this.#styles.get(at);
      if (style?.type !== type) break;
      out.unshift(style);
      at = style.basedOn;
    }
    return out;
  }

  /** A table style and those it is based on (the default table style for a missing one). */
  #tableChain(id: string | null | undefined): StyleJSON[] {
    const chain = id ? this.#chain(id, "table") : [];
    return chain.length ? chain : this.#chain(this.#defaultTableStyle, "table");
  }

  /** The table style's parts for `conditions`, memoized. */
  #layer(style: string | null, conditions: readonly TableCondition[]): TableLayer {
    // JSON: no two style ids and condition lists give the same key.
    const key = JSON.stringify([style, conditions]);
    const known = this.#layers.get(key);
    if (known) return known;
    const layer: TableLayer = { key, paragraph: [], run: [], cell: [] };
    const chain = this.#tableChain(style);
    for (const condition of conditions) {
      for (const s of chain) {
        const part =
          condition === "wholeTable" ? s : s.conditions?.find((c) => c.type === condition);
        if (part?.paragraph) layer.paragraph.push(part.paragraph);
        if (part?.run) layer.run.push(part.run);
        if (part?.cell) layer.cell.push(part.cell);
      }
    }
    this.#layers.set(key, layer);
    return layer;
  }

  /** A table's effective properties (`attrs`: the table node's attributes); the caller's to change. */
  table(attrs: Json): TableFormat {
    const chain = this.#tableChain(attrs.style as string | null | undefined);
    const out: Json = {};
    for (const s of chain) mergeTable(out, s.table as Json | undefined);
    mergeTable(out, attrs);
    // A copy: the merged values are the styles' and the node's own objects.
    return structuredClone({
      ...(out as Omit<TableFormat, "style">),
      style: chain.at(-1)?.id ?? null,
    });
  }

  /**
   * A cell's effective formatting (ECMA-376 17.7.6): the table style's parts that apply where
   * the cell is (`tableConditions`), the row's exceptions over the table's properties, and the
   * cell's own properties (`table`, `row`, `cell`: the nodes' attributes). Pass the result to
   * `paragraph` for the paragraphs in the cell. The result is the caller's to change.
   */
  cell(table: Json, row: Json, cell: Json, place: CellPlace): CellFormat {
    const props = this.table(table) as Json;
    mergeTable(props, row.exceptions as Json | null | undefined);
    const format = props as TableFormat;
    const conditions = tableConditions(
      format.look ?? {},
      place,
      format.rowBandSize,
      format.columnBandSize,
    );
    const layers = [...this.#layer(format.style, conditions).cell, cell as CellPropertiesJSON];
    const fill = last(layers, (l) => l.shading)?.fill ?? format.shading?.fill;
    const tableBorders = format.borders ?? {};
    const edge = (
      side: Side,
      start: "start" | "end" | null,
      inside: BorderJSON | undefined,
      outer: boolean,
    ) =>
      last(layers, (l) => l.borders?.[side] ?? (start ? l.borders?.[start] : undefined)) ??
      (outer ? (tableBorders[side] ?? (start ? tableBorders[start] : undefined)) : inside);
    const borders: Partial<Record<Side, BorderJSON>> = {};
    const sides: [Side, "start" | "end" | null, BorderJSON | undefined, boolean][] = [
      ["top", null, tableBorders.insideH, place.row === 0],
      ["bottom", null, tableBorders.insideH, place.row === place.rows - 1],
      ["left", "start", tableBorders.insideV, place.cell === 0],
      ["right", "end", tableBorders.insideV, place.cell === place.cells - 1],
    ];
    for (const [side, start, inside, outer] of sides) {
      const border = edge(side, start, inside, outer);
      // A copy: the border may be a style's or the node's own object.
      if (border) borders[side] = { ...border };
    }
    const margin = (side: Side, start: "start" | "end" | null) =>
      twipsOf(
        last(layers, (l) => l.margins?.[side] ?? (start ? l.margins?.[start] : undefined)) ??
          format.cellMargins?.[side] ??
          (start ? format.cellMargins?.[start] : undefined),
      ) ?? 0;
    return {
      style: format.style,
      conditions,
      shading: fill === undefined || fill === "auto" ? null : fill.toUpperCase(),
      borders,
      margins: {
        top: margin("top", null),
        bottom: margin("bottom", null),
        left: margin("left", "start"),
        right: margin("right", "end"),
      },
      verticalAlign: last(layers, (l) => l.verticalAlign) ?? "top",
    };
  }

  /**
   * A paragraph style's formatting over the defaults (and, in a table, the table style's parts
   * for the cell, which come between them as ECMA-376 17.7.2 orders them), memoized.
   *
   * shortcut: Word lets a table style's properties win over the default paragraph style's
   * (Normal) in some cases; not modeled (docs/limitations.md).
   */
  #paragraphStyle(id: string | undefined, layer?: TableLayer) {
    const key = JSON.stringify([layer?.key ?? null, id ?? null]);
    const known = this.#paragraphStyles.get(key);
    if (known) return known;
    const paragraph = cloneParagraph(DEFAULT_PARAGRAPH);
    const run = cloneRun(DEFAULT_RUN);
    this.#base(paragraph, run, layer);
    // A style that does not exist (or is not a paragraph style) is the default paragraph style.
    let chain = id === undefined ? [] : this.#chain(id, "paragraph");
    if (!chain.length) chain = this.#chain(this.#defaultParagraphStyle, "paragraph");
    for (const style of chain) mergeParagraph(paragraph, style.paragraph);
    applyStyles(
      run,
      chain.map((s) => s.run ?? []),
      this.#envelope.theme,
    );
    paragraph.style = chain.at(-1)?.id ?? null;
    const result = { paragraph, run, chain };
    this.#paragraphStyles.set(key, result);
    return result;
  }

  /** The document defaults, then a table style's parts for a cell. */
  #base(paragraph: Merging, run: RunFormat | null, layer: TableLayer | undefined): void {
    const { defaults, theme } = this.#envelope;
    mergeParagraph(paragraph, defaults.paragraph);
    if (run) applyDirect(run, defaults.run, theme);
    for (const p of layer?.paragraph ?? []) mergeParagraph(paragraph, p);
    // The table style's run properties are set, as the defaults are (not toggled).
    if (run) for (const r of layer?.run ?? []) applyDirect(run, r, theme);
  }

  /**
   * A paragraph's effective properties, and the formatting of its text before a run's own marks
   * (`attrs`: the paragraph node's attributes, as JSON or a live node has them; `cell`: the
   * format of the table cell it is in, from `cell`). The results are the caller's: changing
   * them changes nothing else.
   */
  paragraph(attrs: Json, cell?: CellFormat): { paragraph: ParagraphFormat; run: RunFormat } {
    const { paragraph, run } = this.#resolve(attrs, cell);
    return { paragraph, run };
  }

  #resolve(
    attrs: Json,
    cell?: CellFormat,
  ): { paragraph: ParagraphFormat; run: RunFormat; level: Level | undefined } {
    const props = attrs as ParagraphPropertiesJSON;
    const layer = cell ? this.#layer(cell.style, cell.conditions) : undefined;
    const base = this.#paragraphStyle(props.style ?? undefined, layer);
    let paragraph = cloneParagraph(base.paragraph);
    const directNumbering = props.numbering?.id != null;
    if (props.numbering) mergeParagraph(paragraph, { numbering: props.numbering });
    const level = this.#levelOf(paragraph);
    if (level?.level.paragraph) {
      if (directNumbering) {
        // Numbering's indents come over the style's, under direct formatting.
        mergeParagraph(paragraph, level.level.paragraph);
      } else {
        // Numbering given by the style: the style's own indents win over the level's.
        const stacked = cloneParagraph(DEFAULT_PARAGRAPH);
        this.#base(stacked, null, layer);
        mergeParagraph(stacked, level.level.paragraph);
        for (const style of base.chain) mergeParagraph(stacked, style.paragraph);
        stacked.style = paragraph.style;
        stacked.numbering = paragraph.numbering;
        paragraph = stacked;
      }
    }
    const { style: _style, numbering: _numbering, ...direct } = props;
    mergeParagraph(paragraph, direct);
    const numbering = level ? { id: level.instance.id, level: level.index } : null;
    // Cloned: the merged values may be the styles' own objects.
    return {
      paragraph: { ...cloneParagraph(paragraph), numbering },
      run: cloneRun(base.run),
      level,
    };
  }

  /**
   * The number format (`decimal`, `bullet`…) of the numbering level a paragraph is in (`attrs`:
   * its attributes), or null when it is not numbered.
   */
  numberFormat(attrs: Json): string | null {
    const level = this.#resolve(attrs).level;
    return level ? (level.level.format ?? "decimal") : null;
  }

  /** A run's formatting: its paragraph's (`paragraphRun`), its character style, then its own marks. */
  run(paragraphRun: RunFormat, marks: readonly MarkJSON[]): RunFormat {
    const run = cloneRun(paragraphRun);
    const styleId = marks.find((m) => m.type === "characterStyle")?.attrs?.id as string | undefined;
    if (styleId) {
      let chain = this.#characterStyles.get(styleId);
      if (!chain) {
        chain = this.#chain(styleId, "character").map((s) => s.run ?? []);
        this.#characterStyles.set(styleId, chain);
      }
      applyStyles(run, chain, this.#envelope.theme);
    }
    applyDirect(run, marks, this.#envelope.theme);
    return run;
  }

  /**
   * The numbering level a paragraph is in. A style that names only the instance (numbered
   * headings) is in the level whose `style` is that style.
   */
  #levelOf(paragraph: Merging): Level | undefined {
    const id = paragraph.numbering?.id;
    const instance = id ? this.#instances.get(id) : undefined;
    const abstract = instance && this.#abstractOf(instance.abstract);
    if (!instance || !abstract) return undefined;
    const index =
      paragraph.numbering?.level ??
      abstract.levels.find((l) => l.style !== undefined && l.style === paragraph.style)?.level ??
      0;
    const level = this.#definition(instance, abstract, index);
    return level ? { instance, abstract, index, level } : undefined;
  }

  #definition(instance: NumberingInstanceJSON, abstract: AbstractNumberingJSON, index: number) {
    const override = instance.overrides?.find((o) => o.level === index)?.definition;
    return override ?? abstract.levels.find((l) => l.level === index);
  }

  /** An abstract definition, following a numbering style's link to the definition it uses. */
  #abstractOf(id: number): AbstractNumberingJSON | undefined {
    let abstract = this.#abstracts.get(id);
    for (let hops = 0; abstract?.numStyleLink && hops < 8; hops++) {
      const style = this.#styles.get(abstract.numStyleLink);
      const numId = style?.paragraph?.numbering?.id;
      const instance = numId ? this.#instances.get(numId) : undefined;
      const next = instance ? this.#abstracts.get(instance.abstract) : undefined;
      if (!next || next === abstract) break;
      abstract = next;
    }
    return abstract;
  }

  /**
   * The list markers of a document's paragraphs in order (`paragraphs`: each paragraph's
   * attributes). Counters are kept per abstract definition, so instances that share one continue
   * a list; an instance's start override restarts it where the instance is first used; a level
   * restarts after a paragraph of a level above it, or as its `restart` says.
   */
  markers(paragraphs: readonly Json[]): (ListMarker | null)[] {
    const counters = new Map<number, (number | undefined)[]>();
    const overridden = new Set<string>();
    return paragraphs.map((attrs) => {
      const { run, level: found } = this.#resolve(attrs);
      if (!found) return null;
      const { instance, abstract, index, level } = found;
      let levels = counters.get(abstract.id);
      if (!levels) {
        levels = [];
        counters.set(abstract.id, levels);
      }
      const startOf = (i: number) => {
        const override = instance.overrides?.find((o) => o.level === i)?.start;
        return override ?? this.#definition(instance, abstract, i)?.start ?? 0;
      };
      const key = `${instance.id}:${index}`;
      const override = instance.overrides?.find((o) => o.level === index)?.start;
      const current = levels[index];
      if (override !== undefined && !overridden.has(key)) {
        overridden.add(key);
        levels[index] = override;
      } else levels[index] = current === undefined ? startOf(index) : current + 1;
      for (let deeper = index + 1; deeper < 9; deeper++) {
        const restart = this.#definition(instance, abstract, deeper)?.restart;
        if (restart === undefined || (restart !== 0 && index < restart)) levels[deeper] = undefined;
      }
      const text = (level.text ?? "").replace(/%([1-9])/g, (_, d: string) => {
        const i = Number(d) - 1;
        const format = level.legal ? "decimal" : this.#definition(instance, abstract, i)?.format;
        return formatNumber(levels[i] ?? startOf(i), format);
      });
      const marker = cloneRun(run);
      applyDirect(marker, attrs.markFormat as MarkJSON[] | undefined, this.#envelope.theme);
      applyDirect(marker, level.run, this.#envelope.theme);
      return {
        text,
        suffix: level.suffix ?? "tab",
        justification: level.justification ?? "left",
        run: marker,
        instance: instance.id,
        level: index,
      };
    });
  }
}
