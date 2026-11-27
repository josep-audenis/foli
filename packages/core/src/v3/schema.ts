import { type AttributeSpec, type MarkSpec, Schema } from "../model/index.js";
import {
  attributes,
  bool,
  type Check,
  color,
  date,
  int,
  isRecord,
  listOf,
  nullable,
  oneOf,
  shape,
  str,
  text,
  token,
  xml,
} from "./check.js";

/**
 * Schema v3: Word's document model ([ADR-0005](../../../../docs/decisions/ADR-0005-word-compatible-model.md)).
 * Paragraphs carry Word's paragraph properties as attributes and text carries its run
 * properties as marks, in Word's units (twips, half-points, eighths of a point), so values
 * survive a DOCX round trip exactly. Headings are paragraphs with a heading style; lists are
 * numbered paragraphs. An unset property is null (the style decides).
 *
 * Validation accepts what Word accepts: it rejects only what the engine cannot work with
 * (wrong types, out-of-range numbers), never a property combination Word would open.
 *
 * Lossless: an `ext` attribute holds the element the properties were read from (`w:pPr`,
 * `w:rPr`, `w:sectPr`…), verbatim. Export writes it back as it was while the modeled values
 * still match it, and otherwise rewrites the modeled values into it, keeping its unknown
 * children (in Word's order) and unknown attributes. `attributes` holds an element's own
 * unknown attributes (`w14:paraId` on a paragraph). Opaque nodes hold whole elements Foli does
 * not model yet.
 *
 * The editor still runs on schema v2 until rendering and editing move to v3 (8.6, 8.7); this
 * schema, the v3 envelope and the v2 → v3 migration exist alongside it until then.
 */

const MAX_TWIPS = 31_680; // 22 inches: Word's largest page dimension
const twips = int(-MAX_TWIPS, MAX_TWIPS);
const positiveTwips = int(0, MAX_TWIPS);
/** Line spacing: 240ths of a line ("auto") or twips. */
const lineSpacing = int(-MAX_TWIPS, MAX_TWIPS);

/** Word's paragraph justification (ST_Jc). */
export const JUSTIFICATIONS = [
  "left",
  "center",
  "right",
  "both",
  "start",
  "end",
  "distribute",
  "mediumKashida",
  "highKashida",
  "lowKashida",
  "thaiDistribute",
  "numTab",
] as const;
export type Justification = (typeof JUSTIFICATIONS)[number];

/** @internal */
export const LINE_RULES = ["auto", "exact", "atLeast"] as const;
/** @internal */
export const TAB_KINDS = [
  "left",
  "center",
  "right",
  "decimal",
  "bar",
  "clear",
  "num",
  "start",
  "end",
] as const;
/** @internal */
export const TAB_LEADERS = ["none", "dot", "hyphen", "underscore", "heavy", "middleDot"] as const;
/** @internal */
export const SECTION_TYPES = [
  "nextPage",
  "continuous",
  "evenPage",
  "oddPage",
  "nextColumn",
] as const;
/** @internal */
export const VERTICAL_ALIGNS = ["baseline", "superscript", "subscript"] as const;
/** Word's highlight colors (ST_HighlightColor); any other color is shading. */
export const HIGHLIGHT_COLORS = [
  "black",
  "blue",
  "cyan",
  "green",
  "magenta",
  "red",
  "yellow",
  "white",
  "darkBlue",
  "darkCyan",
  "darkGreen",
  "darkMagenta",
  "darkRed",
  "darkYellow",
  "darkGray",
  "lightGray",
  "none",
] as const;
/** @internal */
export const THEME_FONTS = [
  "majorAscii",
  "majorHAnsi",
  "majorEastAsia",
  "majorBidi",
  "minorAscii",
  "minorHAnsi",
  "minorEastAsia",
  "minorBidi",
] as const;

const border = shape(
  {
    style: token,
    size: int(0, 96), // eighths of a point
    space: int(0, 31), // points
    color,
    themeColor: token,
  },
  ["style"],
);

const shading = shape({ pattern: token, color, fill: color, themeFill: token }, ["pattern"]);

const nullableAttr = (check: Check): AttributeSpec => ({
  default: null,
  validate: nullable(check),
});

/** Who made a tracked change or comment, and when (ids are Word's `w:id`; authors may be empty). */
const ID = int(0, 2_147_483_647);
const revisionFields = { id: ID, author: str(), date: nullable(date) };
const revision = shape(revisionFields, ["id", "author"]);

/**
 * How notes are placed and numbered (`w:footnotePr`, `w:endnotePr`), for a document or section.
 * @internal
 */
export const checkNoteProperties: Check = shape({
  position: oneOf(["pageBottom", "beneathText", "sectEnd", "docEnd"]),
  format: token,
  start: ID,
  restart: oneOf(["continuous", "eachSect", "eachPage"]),
});

/**
 * A watermark (schema 9): a text's (`text`, `font`, `color` RRGGBB, `semitransparent`,
 * `rotation` in degrees: 315 is Word's diagonal) or a picture's (`picture`, a resource key;
 * `washout`), in a box of `width` by `height` twips centered on the page's text area.
 * @internal
 */
export const checkWatermark: Check = shape(
  {
    kind: oneOf(["text", "picture"]),
    text: str(),
    font: text(),
    color,
    semitransparent: bool,
    rotation: int(0, 359),
    picture: text(),
    washout: bool,
    width: int(1, MAX_TWIPS),
    height: int(1, MAX_TWIPS),
  },
  ["kind", "width", "height"],
);

/** Word's limit on a section's columns. */
const MAX_SECTION_COLUMNS = 45;

/**
 * A section's page setup (`w:sectPr`): on the last paragraph of each section, and the
 * envelope's for the last. Every part is optional (Word's defaults apply); `{}` is a section
 * break with Word's defaults.
 */
export const checkSection: Check = (value) => sectionShape(value);
const sectionShape: Check = shape(
  {
    pageSize: shape({
      width: int(1, MAX_TWIPS),
      height: int(1, MAX_TWIPS),
      orientation: oneOf(["portrait", "landscape"]),
    }),
    margins: shape({
      top: twips,
      right: positiveTwips,
      bottom: twips,
      left: positiveTwips,
      header: positiveTwips,
      footer: positiveTwips,
      gutter: positiveTwips,
    }),
    type: oneOf(SECTION_TYPES),
    titlePage: bool,
    headers: shape({ default: text(), first: text(), even: text() }),
    footers: shape({ default: text(), first: text(), even: text() }),
    /** `w:cols` (schema v5): `widths` when the columns are not equal. */
    columns: shape({
      count: int(1, MAX_SECTION_COLUMNS),
      space: positiveTwips,
      equalWidth: bool,
      separator: bool,
      widths: listOf(
        shape({ width: positiveTwips, space: positiveTwips }, ["width"]),
        MAX_SECTION_COLUMNS,
      ),
    }),
    /** `w:pgNumType` (schema v5). */
    pageNumbers: shape({ start: ID, format: token }),
    /** `w:pgBorders` (schema 9). */
    pageBorders: shape({
      top: border,
      left: border,
      bottom: border,
      right: border,
      offsetFrom: oneOf(["text", "page"]),
      display: oneOf(["allPages", "firstPage", "notFirstPage"]),
      zOrder: oneOf(["front", "back"]),
    }),
    /** `w:lnNumType` (schema 9). */
    lineNumbers: shape(
      {
        countBy: int(1, 32_767),
        start: int(0, 32_767),
        distance: positiveTwips,
        restart: oneOf(["newPage", "newSection", "continuous"]),
      },
      ["countBy"],
    ),
    footnotes: checkNoteProperties,
    endnotes: checkNoteProperties,
    /** `w:sectPrChange`: a tracked change of the page setup, and the setup before it. */
    change: shape({ ...revisionFields, previous: checkSection }, ["id", "author", "previous"]),
    ext: xml,
  },
  [],
  true,
);

/**
 * A table measure (`w:tblW`, `w:tcW`, `w:tblInd`, cell margins): `value` in twips (`dxa`) or
 * fiftieths of a percent (`pct`, 5000 = 100 %); `auto` and `nil` carry 0.
 */
const measure = shape({ value: twips, type: oneOf(["auto", "dxa", "pct", "nil"]) }, [
  "value",
  "type",
]);
const sides = (check: Check, extra: readonly string[] = []) =>
  shape(
    Object.fromEntries(
      ["top", "left", "bottom", "right", "start", "end", ...extra].map((side) => [side, check]),
    ),
  );
/** Word's limit: 63 columns. Files beyond it stay valid up to this bound. */
const MAX_COLUMNS = 1000;

/** Table properties (`w:tblPr`), also a row's exceptions (`w:tblPrEx`) and a table style's. */
const tableProperties: Record<string, AttributeSpec> = {
  style: nullableAttr(text()),
  width: nullableAttr(measure),
  justification: nullableAttr(oneOf(["left", "center", "right", "start", "end"])),
  indent: nullableAttr(measure),
  layout: nullableAttr(oneOf(["fixed", "autofit"])),
  borders: nullableAttr(sides(border, ["insideH", "insideV"])),
  cellMargins: nullableAttr(sides(measure)),
  cellSpacing: nullableAttr(measure),
  shading: nullableAttr(shading),
  /** `w:tblLook`: which of the table style's conditional formats apply. */
  look: nullableAttr(
    shape({
      firstRow: bool,
      lastRow: bool,
      firstColumn: bool,
      lastColumn: bool,
      noHBand: bool,
      noVBand: bool,
    }),
  ),
  /** Rows and columns per band of the table style's banding (`w:tblStyleRowBandSize`…). */
  rowBandSize: nullableAttr(int(1, MAX_COLUMNS)),
  columnBandSize: nullableAttr(int(1, MAX_COLUMNS)),
  /** The element these properties were read from, verbatim. */
  ext: nullableAttr(xml),
};

/** Row properties (`w:trPr`) as a row's attributes or a table style's. */
const rowProperties: Record<string, AttributeSpec> = {
  /** In twips; `auto` lets the content decide (Word's default). */
  height: nullableAttr(
    shape({ value: positiveTwips, rule: oneOf(["auto", "exact", "atLeast"]) }, ["value"]),
  ),
  /** The row is never split across pages. */
  cantSplit: nullableAttr(bool),
  /** A header row: repeated at the top of each page the table continues on. */
  header: nullableAttr(bool),
  /** Grid columns left empty before the first cell and after the last, and their widths. */
  gridBefore: nullableAttr(int(1, MAX_COLUMNS)),
  widthBefore: nullableAttr(measure),
  gridAfter: nullableAttr(int(1, MAX_COLUMNS)),
  widthAfter: nullableAttr(measure),
  ext: nullableAttr(xml),
};

/** Cell properties (`w:tcPr`) as a cell's attributes or a table style's. */
const cellProperties: Record<string, AttributeSpec> = {
  width: nullableAttr(measure),
  /** Grid columns the cell spans (null: one). */
  gridSpan: nullableAttr(int(1, MAX_COLUMNS)),
  /**
   * A vertical merge: `restart` starts one, `continue` is covered by the cell above. Kept as
   * Word writes it (a merged cell is present in every row it covers); layout derives the span.
   */
  vMerge: nullableAttr(oneOf(["restart", "continue"])),
  borders: nullableAttr(sides(border, ["insideH", "insideV", "tl2br", "tr2bl"])),
  shading: nullableAttr(shading),
  margins: nullableAttr(sides(measure)),
  verticalAlign: nullableAttr(oneOf(["top", "center", "bottom", "both"])),
  textDirection: nullableAttr(token),
  noWrap: nullableAttr(bool),
  ext: nullableAttr(xml),
};

const propertiesCheck =
  (specs: Record<string, AttributeSpec>): Check =>
  (v) => {
    if (!isRecord(v)) return "must be an object";
    for (const [key, value] of Object.entries(v)) {
      if (!Object.hasOwn(specs, key)) return `unknown key ${key}`;
      const error =
        value === null
          ? "must not be null (leave it out)"
          : (specs[key] as AttributeSpec).validate?.(value);
      if (error) return `${key} ${error}`;
    }
    return undefined;
  };

/**
 * Table, row and cell properties as a table style or a row's exceptions give them.
 * @internal
 */
export const checkTableProperties: Check = propertiesCheck(tableProperties);
/** @internal */
export const checkRowProperties: Check = propertiesCheck(rowProperties);
/** @internal */
export const checkCellProperties: Check = propertiesCheck(cellProperties);

/**
 * Table, row and cell properties a formatting change records (`previous`, schema 8): all but the
 * verbatim XML.
 * @internal
 */
export const TABLE_PROPERTY_KEYS: readonly string[] = Object.keys(tableProperties).filter(
  (k) => k !== "ext",
);
/** @internal */
export const ROW_PROPERTY_KEYS: readonly string[] = Object.keys(rowProperties).filter(
  (k) => k !== "ext",
);
/** @internal */
export const CELL_PROPERTY_KEYS: readonly string[] = Object.keys(cellProperties).filter(
  (k) => k !== "ext",
);
/**
 * A table's, row's or cell's recorded formatting (`w:tblPrChange`, `w:trPrChange`,
 * `w:tcPrChange`; schema 8): who, when, and the properties before.
 */
const tableFormatChange = (previous: Check) =>
  nullableAttr(shape({ ...revisionFields, previous }, ["id", "author", "previous"]));

/** EMU (English Metric Units: 914 400 per inch), as DrawingML measures pictures. */
const emu = int(0, 2_147_483_647);
const offset = int(-2_147_483_648, 2_147_483_647);

/** Where a floating picture is (`wp:anchor`): null for an inline picture. */
const checkFloat: Check = shape(
  {
    /** `relativeFrom` (page, margin, column, paragraph, character…) and an offset or alignment. */
    horizontal: shape({ relativeTo: token, offset, align: token }, ["relativeTo"]),
    vertical: shape({ relativeTo: token, offset, align: token }, ["relativeTo"]),
    /** How text goes around it; `behind` and `inFront` are no wrapping. */
    wrap: oneOf(["square", "tight", "through", "topAndBottom", "behind", "inFront"]),
    /** Which sides text goes on (`w:wrapText`). */
    side: oneOf(["bothSides", "left", "right", "largest"]),
    /** Distance from the text, in EMU. */
    distance: shape({ top: emu, bottom: emu, left: emu, right: emu }),
    allowOverlap: bool,
    layoutInCell: bool,
    /**
     * Its place among the floating objects, front to back as the number grows (`relativeHeight`;
     * schema 10, 33.6): set by Bring Forward and Send Backward; left out, as the file has it.
     */
    zOrder: int(0, 2_147_483_647),
  },
  ["horizontal", "vertical", "wrap"],
);

/**
 * A picture's rotation, clockwise, in 60 000ths of a degree (DrawingML's `a:xfrm/@rot`; schema 6):
 * 0 is none, said so; missing (null) is "as its `ext` has it" (documents of 1.0 to 1.3 kept a
 * file's rotation there only).
 */
const rotation = int(0, 21_599_999);

/**
 * What of a picture's image is cut off at each edge, in 1000ths of a percent of the image
 * (DrawingML's `a:srcRect`: 25 000 is a quarter; negative adds space; schema 6). What is left
 * must have a size: left + right and top + bottom stay under 100 000. All sides 0 (or none
 * given) is no crop, said so; missing (null) is "as its `ext` has it", as for `rotation`.
 */
/** DrawingML's coordinates and guide values (ST_Coordinate, ST_GeomGuideFormula's numbers). */
const coordinate = int(-27_273_042_316_900, 27_273_042_316_900);

/** A shape's adjust values (`a:avLst`: `adj` → 25 000), by guide name (schema 11, ADR-0017). */
const checkAdjust: Check = (v) => {
  if (!isRecord(v)) return "must be an object";
  const entries = Object.entries(v);
  if (entries.length > 32) return "must have at most 32 values";
  for (const [name, value] of entries) {
    if (text(64)(name)) return `${JSON.stringify(name)} is not a guide name`;
    const error = coordinate(value);
    if (error) return `${name} ${error}`;
  }
  return undefined;
};

/**
 * A custom geometry (`a:custGeom`, schema 11): its guides (`a:gdLst`: a name and a DrawingML
 * formula, `*\/ w adj 100000`) and its paths, each a list of commands whose arguments are
 * numbers or guide names, as the file has them: `M x y`, `L x y`, `C x1 y1 x2 y2 x y`,
 * `Q x1 y1 x y`, `A wR hR stAng swAng` (`a:arcTo`), `Z`. A path's `width` and `height` are its
 * own coordinate space (missing: the shape's); `fill` and `stroke` say how it is drawn.
 */
const checkCustomGeometry: Check = shape(
  {
    guides: listOf(shape({ name: text(64), formula: text(1024) }, ["name", "formula"]), 1000),
    paths: listOf(
      shape(
        {
          width: emu,
          height: emu,
          fill: oneOf(["norm", "none", "lighten", "lightenLess", "darken", "darkenLess"]),
          stroke: bool,
          commands: listOf(
            shape({ op: oneOf(["M", "L", "C", "Q", "A", "Z"]), args: listOf(text(64), 6) }, ["op"]),
            100_000,
          ),
        },
        ["commands"],
      ),
      100,
    ),
    /** The text's rectangle (`a:rect`): left, top, right, bottom as numbers or guide names. */
    text: shape({ l: text(64), t: text(64), r: text(64), b: text(64) }, ["l", "t", "r", "b"]),
  },
  ["paths"],
);

/** A line end (`a:headEnd`, `a:tailEnd`): its kind and size. */
const lineEnd = shape(
  {
    type: oneOf(["triangle", "stealth", "diamond", "oval", "arrow"]),
    width: oneOf(["sm", "med", "lg"]),
    length: oneOf(["sm", "med", "lg"]),
  },
  ["type"],
);

/**
 * A gradient fill (`a:gradFill`): its stops (position in 1000ths of a percent, 0 to 100 000, and
 * color), linear at `angle` (60 000ths of a degree, clockwise from left to right) or from the
 * center (`path`: circle, rect, shape).
 */
const checkGradient: Check = shape(
  {
    stops: listOf(shape({ position: int(0, 100_000), color }, ["position", "color"]), 32),
    angle: rotation,
    path: oneOf(["circle", "rect", "shape"]),
  },
  ["stops"],
);

const cropSide = int(-1_000_000, 99_999);
const cropShape = shape(
  { left: cropSide, top: cropSide, right: cropSide, bottom: cropSide },
  [],
  true,
);
const checkCrop: Check = (v) => {
  const error = cropShape(v);
  if (error) return error;
  const c = v as Record<string, number | undefined>;
  return (c.left ?? 0) + (c.right ?? 0) >= 100_000 || (c.top ?? 0) + (c.bottom ?? 0) >= 100_000
    ? "must leave some of the image"
    : undefined;
};

/** Marks that describe how text looks: what a style, a paragraph mark or a recorded change holds. */
export const RUN_PROPERTY_MARKS = [
  "characterStyle",
  "bold",
  "italic",
  "underline",
  "strike",
  "doubleStrike",
  "caps",
  "smallCaps",
  "hidden",
  "font",
  "fontSize",
  "color",
  "highlight",
  "shading",
  "verticalAlign",
  "characterSpacing",
];

/**
 * Run properties given as marks JSON (a style's, a paragraph mark's, a recorded change's previous).
 * @internal
 */
export const checkRunProperties: Check = (v) => {
  if (!Array.isArray(v)) return "must be an array of marks";
  for (const mark of v) {
    if (!isRecord(mark) || !RUN_PROPERTY_MARKS.includes(mark.type as string)) {
      return `${isRecord(mark) ? String(mark.type) : "a non-object"} is not a run property`;
    }
  }
  try {
    schema.nodeFromJSON({ type: "text", text: "x", marks: v });
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
};

/**
 * Paragraph properties (`w:pPr`). The same attributes describe a style's, a numbering level's
 * and the defaults' paragraph properties.
 */
const paragraphProperties: Record<string, AttributeSpec> = {
  style: nullableAttr(text()),
  justification: nullableAttr(oneOf(JUSTIFICATIONS)),
  /** In twips. With both `firstLine` and `hanging`, Word applies `hanging`. */
  indent: nullableAttr(
    shape({ left: twips, right: twips, firstLine: positiveTwips, hanging: positiveTwips }),
  ),
  spacing: nullableAttr(
    shape({
      before: positiveTwips,
      after: positiveTwips,
      line: lineSpacing,
      lineRule: oneOf(LINE_RULES),
      beforeAutospacing: bool,
      afterAutospacing: bool,
    }),
  ),
  keepNext: nullableAttr(bool),
  keepLines: nullableAttr(bool),
  widowControl: nullableAttr(bool),
  pageBreakBefore: nullableAttr(bool),
  contextualSpacing: nullableAttr(bool),
  /** `w:suppressLineNumbers` (schema 9): the paragraph's lines are not numbered. */
  suppressLineNumbers: nullableAttr(bool),
  outlineLevel: nullableAttr(int(0, 9)),
  /**
   * `id` is the numbering instance (`w:numId`; 0 removes numbering), `level` 0–8 (`w:ilvl`).
   * Either may be missing, as in Word: the style supplies the other (a style's numbering
   * often has only `id`; a paragraph demoting a style-numbered item only `level`).
   */
  numbering: nullableAttr(shape({ id: ID, level: int(0, 8) })),
  tabs: nullableAttr(
    listOf(
      shape({ position: twips, kind: oneOf(TAB_KINDS), leader: oneOf(TAB_LEADERS) }, [
        "position",
        "kind",
      ]),
      64,
    ),
  ),
  borders: nullableAttr(
    shape({
      top: border,
      bottom: border,
      left: border,
      right: border,
      between: border,
      bar: border,
    }),
  ),
  shading: nullableAttr(shading),
  /** The paragraph mark's run properties (`w:pPr/w:rPr`): the mark's look, the numbering's. */
  markFormat: nullableAttr(checkRunProperties),
  /** The `w:pPr` these properties were read from, verbatim (see the module comment). */
  ext: nullableAttr(xml),
};

/**
 * The names of the paragraph properties (`w:pPr`) among a paragraph's attributes.
 * @internal
 */
export const PARAGRAPH_PROPERTY_KEYS: readonly string[] = Object.keys(paragraphProperties);

/**
 * Paragraph properties as a style, a numbering level, the defaults or a recorded change give them.
 * @internal
 */
export const checkParagraphProperties: Check = (v) => {
  if (!isRecord(v)) return "must be an object";
  for (const [key, value] of Object.entries(v)) {
    if (!Object.hasOwn(paragraphProperties, key)) return `unknown key ${key}`;
    const error =
      value === null
        ? "must not be null (leave it out)"
        : (paragraphProperties[key] as AttributeSpec).validate?.(value);
    if (error) return `${key} ${error}`;
  }
  return undefined;
};

const markAttr = (check: Check, defaultValue?: unknown): AttributeSpec =>
  defaultValue === undefined ? { validate: check } : { default: defaultValue, validate: check };

/** A run property that is on unless `value` is false (`<w:b w:val="0"/>` turns off a style's bold). */
const toggle: MarkSpec = { attrs: { value: markAttr(bool, true) } };
/**
 * Bold and italic have a complex-script twin (`w:bCs`, `w:iCs`): `value` null when only the
 * twin is set.
 */
const toggleWithComplexScript: MarkSpec = {
  attrs: {
    value: markAttr(nullable(bool), true),
    complexScript: markAttr(nullable(bool), null),
  },
};
const reviewMark: MarkSpec = {
  attrs: {
    id: markAttr(ID),
    author: markAttr(str()),
    date: markAttr(nullable(date), null),
    /** A tracked move (`w:moveFrom`, `w:moveTo`): the move's name, shared by both ends. */
    move: markAttr(nullable(text()), null),
    /** The change element's other attributes (`w16du:dateUtc`…). */
    attributes: markAttr(nullable(attributes), null),
  },
  inclusive: false,
};
/** A marker's own unknown attributes (`w:displacedByCustomXml`…). */
const markerAttributes = { attributes: nullableAttr(attributes) };
/** Ids of content controls, outermost first: at least one, none twice. */
const controlIds: Check = (v) => {
  const error = listOf(text(), 64)(v);
  if (error) return error;
  const ids = v as string[];
  if (!ids.length) return "must not be empty (use null)";
  return new Set(ids).size === ids.length ? undefined : "must not repeat an id";
};
/** The content controls around a block, row or cell (schema v5, ADR-0007). */
const controlsAttr = { controls: nullableAttr(controlIds) };
/** Part of a field (schema v5): stands in a run, verbatim XML of what the model does not hold. */
const fieldPart = { group: "inline", inline: true, selectable: false } as const;
const fontName = markAttr(nullable(text()), null);
const themeFont = markAttr(nullable(oneOf(THEME_FONTS)), null);
const hexByte = (v: unknown) =>
  typeof v === "string" && /^[0-9A-Fa-f]{2}$/.test(v) ? undefined : "must be a hex byte";

/**
 * The name of a custom node or mark type (ADR-0008): `<namespace>:<name>`, lowercase letters,
 * digits and `-`. Word's types never have a colon.
 */
export const CUSTOM_TYPE = /^[a-z0-9-]+:[a-z0-9-]+$/;

/** The largest custom attributes a foreign node or mark holds, as JSON text. */
const MAX_FOREIGN_ATTRS = 65_536;

/** Plain JSON (no `undefined`, functions, non-finite numbers or cycles), nested at most 32 deep. */
function plainJSON(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => plainJSON(v, depth + 1));
  return (
    isRecord(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every((v) => plainJSON(v, depth + 1))
  );
}

/** A foreign type's attributes: a plain JSON object, size-limited. */
const foreignAttrs: Check = (v) => {
  if (!isRecord(v) || !plainJSON(v)) return "must be a plain JSON object";
  return JSON.stringify(v).length <= MAX_FOREIGN_ATTRS
    ? undefined
    : `must be at most ${MAX_FOREIGN_ATTRS} characters as JSON`;
};

/**
 * What a foreign node or mark holds: the custom type and attributes it was read as. `text` is
 * a foreign node's text as a `.docx` control showed it: in memory only, never saved.
 */
const foreign = {
  type: {
    validate: (v: unknown) =>
      typeof v === "string" && CUSTOM_TYPE.test(v) ? undefined : "must be a namespaced type",
  },
  attrs: nullableAttr(foreignAttrs),
};
const foreignNode = {
  attrs: { ...foreign, text: nullableAttr(str(65_535)) },
  text: (attrs: Record<string, unknown>) =>
    typeof attrs.text === "string" ? attrs.text : `[${String(attrs.type)}]`,
};

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: {
        ...paragraphProperties,
        ...controlsAttr,
        /** Ends a section: its page setup. The last section's is the envelope's `section`. */
        section: nullableAttr(checkSection),
        /** The paragraph mark inserted and/or deleted as tracked changes. */
        revision: nullableAttr(shape({ insertion: revision, deletion: revision })),
        /** A tracked formatting change: the paragraph properties before it. */
        formatChange: nullableAttr(
          shape({ ...revisionFields, previous: checkParagraphProperties }, [
            "id",
            "author",
            "previous",
          ]),
        ),
        /** `w:p`'s own unknown attributes (`w14:paraId`, revision save ids…). */
        attributes: nullableAttr(attributes),
      },
    },
    /**
     * A table (`w:tbl`, schema v4): rows of cells holding blocks. Word's rules beyond the
     * content expressions (no table right after a table, none ending the body or a cell, no
     * section or page break in a cell) are checked by `parseContent`.
     */
    table: {
      group: "block",
      content: "tableRow+",
      attrs: {
        ...tableProperties,
        ...controlsAttr,
        /** The grid's column widths in twips (`w:tblGrid`). */
        grid: { default: [], validate: listOf(positiveTwips, MAX_COLUMNS) },
        /** The `w:tblGrid` the grid was read from, verbatim. */
        gridExt: nullableAttr(xml),
        formatChange: tableFormatChange(checkTableProperties),
      },
    },
    tableRow: {
      content: "tableCell+",
      attrs: {
        ...rowProperties,
        ...controlsAttr,
        /** The row inserted or deleted as a tracked change (`w:trPr/w:ins`, `w:del`). */
        revision: nullableAttr(shape({ insertion: revision, deletion: revision })),
        /** The row's table property exceptions (`w:tblPrEx`). */
        exceptions: nullableAttr(checkTableProperties),
        formatChange: tableFormatChange(checkRowProperties),
        /** `w:tr`'s own unknown attributes (`w14:paraId`, revision save ids…). */
        attributes: nullableAttr(attributes),
      },
    },
    tableCell: {
      // As Word requires, a cell ends with a paragraph.
      content: "block* paragraph",
      attrs: {
        ...cellProperties,
        ...controlsAttr,
        formatChange: tableFormatChange(checkCellProperties),
      },
    },
    /** Block content Foli does not model yet (a table inside a content control…), kept verbatim. */
    opaqueBlock: {
      group: "block",
      attrs: { xml: { validate: xml }, label: nullableAttr(text()), ...controlsAttr },
    },
    text: { group: "inline" },
    tab: { group: "inline", inline: true },
    hardBreak: {
      group: "inline",
      inline: true,
      selectable: false,
      attrs: { clear: nullableAttr(oneOf(["none", "left", "right", "all"])) },
    },
    pageBreak: { group: "inline", inline: true, selectable: false },
    columnBreak: { group: "inline", inline: true, selectable: false },
    /** A bookmark's ends (`w:bookmarkStart`/`End`): what cross-references and internal links point at. */
    bookmarkStart: {
      group: "inline",
      inline: true,
      selectable: false,
      attrs: { id: { validate: ID }, name: { validate: str() }, ...markerAttributes },
    },
    bookmarkEnd: {
      group: "inline",
      inline: true,
      selectable: false,
      attrs: { id: { validate: ID }, ...markerAttributes },
    },
    /** Where a comment's range starts and ends (`w:commentRangeStart`/`End`), and its reference mark. */
    commentStart: {
      group: "inline",
      inline: true,
      selectable: false,
      attrs: { id: { validate: ID }, ...markerAttributes },
    },
    commentEnd: {
      group: "inline",
      inline: true,
      selectable: false,
      attrs: { id: { validate: ID }, ...markerAttributes },
    },
    commentReference: {
      group: "inline",
      inline: true,
      attrs: { id: { validate: ID }, ...markerAttributes },
    },
    /**
     * A field, as Word has it (schema v5, ADR-0007): start, code, optional separator, result,
     * end. The code range runs from the start to the separator (or the end) and may hold other
     * fields; the result is ordinary content.
     */
    fieldStart: {
      ...fieldPart,
      attrs: {
        dirty: nullableAttr(bool),
        locked: nullableAttr(bool),
        /** Read from `w:fldSimple`, and written back as one. */
        simple: nullableAttr(bool),
        ext: nullableAttr(xml),
      },
    },
    /** One `w:instrText`: part of a field's code. */
    fieldCode: { ...fieldPart, attrs: { text: { validate: str(65_535) }, ...markerAttributes } },
    fieldSeparator: { ...fieldPart, attrs: { ext: nullableAttr(xml) } },
    fieldEnd: { ...fieldPart, attrs: { ext: nullableAttr(xml) } },
    /** An inline content control's ends; its properties are the envelope's `controls[id]`. */
    controlStart: {
      group: "inline",
      inline: true,
      selectable: false,
      attrs: { id: { validate: text() } },
    },
    controlEnd: {
      group: "inline",
      inline: true,
      selectable: false,
      attrs: { id: { validate: text() } },
    },
    /** A footnote's or endnote's reference: its text is the envelope's `stories[story]`. */
    noteReference: {
      group: "inline",
      inline: true,
      attrs: {
        story: { validate: text() },
        /** `w:customMarkFollows`: the mark is the text after it, not a number. */
        customMark: nullableAttr(bool),
        ...markerAttributes,
      },
    },
    /** Where a note shows its own number (`w:footnoteRef`, `w:endnoteRef`). */
    noteMark: { group: "inline", inline: true, selectable: false },
    /**
     * A picture (`w:drawing` holding `pic:pic`, schema v4), inline or floating. Its bytes are
     * the envelope's `resources[resource]`.
     */
    picture: {
      group: "inline",
      inline: true,
      attrs: {
        resource: { validate: text() },
        /** In EMU. */
        width: { validate: emu },
        height: { validate: emu },
        /** Alt text (`wp:docPr/@descr`): allowed to be missing, as Word allows it. */
        alt: nullableAttr(str(65_535)),
        title: nullableAttr(str(65_535)),
        /** Marked decorative: no alt text needed. */
        decorative: nullableAttr(bool),
        float: nullableAttr(checkFloat),
        /** Clockwise, in 60 000ths of a degree (schema 6, 19.5). */
        rotation: nullableAttr(rotation),
        /** The image's edges cut off, in 1000ths of a percent (schema 6, 19.5). */
        crop: nullableAttr(checkCrop),
        /** The `w:drawing` it was read from, verbatim (effects, z-order…). */
        ext: nullableAttr(xml),
      },
    },
    /**
     * A text box (schema 10, ADR-0016): Word's rectangle holding text (`wps:wsp` with `wps:txbx`,
     * or VML's `v:textbox`), inline or floating as a picture is. Its text is the envelope's
     * `stories[story]` (kind `textBox`); its size and `float` are a picture's; `fill` and
     * `outline` are what it is drawn with (null: none); `ext` is the run content it was read from
     * (`mc:AlternateContent`, `w:drawing` or `w:pict`), written back with the story's text in it.
     */
    textBox: {
      group: "inline",
      inline: true,
      attrs: {
        story: { validate: text() },
        /** In EMU. */
        width: { validate: emu },
        height: { validate: emu },
        float: nullableAttr(checkFloat),
        /** RRGGBB, or null for no fill. */
        fill: nullableAttr(color),
        /** Color RRGGBB and width in EMU, or null for no line. */
        outline: nullableAttr(shape({ color, width: emu }, ["color", "width"])),
        /** The space between the box and its text, in EMU (null: Word's 0.1" and 0.05"). */
        inset: nullableAttr(shape({ left: emu, top: emu, right: emu, bottom: emu })),
        /** Where the text sits in the box's height (null: at the top). */
        verticalAlign: nullableAttr(oneOf(["top", "center", "bottom"])),
        /** The box grows to fit its text (`a:spAutoFit`, VML's `mso-fit-shape-to-text`). */
        autoFit: nullableAttr(bool),
        /** Alt text and title (`wp:docPr`, VML's `alt`). */
        alt: nullableAttr(str(65_535)),
        title: nullableAttr(str(65_535)),
        ext: nullableAttr(xml),
      },
    },
    /**
     * A shape (schema 11, ADR-0017): Word's drawn shape (`wps:wsp`), inline or floating as a
     * picture is. `geometry` is DrawingML's preset (`a:prstGeom/@prst`: `rect`, `ellipse`,
     * `rightArrow`…) with its `adjust` values, or `custom` with `custom`'s paths; its size,
     * `float` and `rotation` are a picture's, `flipH`/`flipV` mirror it. `fill` (RRGGBB, null for
     * none) or `gradient`, and `outline` (null for none) are what it is drawn with, a theme's
     * style resolved; effects (shadows, glow, 3-D) stay in `ext`, the run content it was read
     * from (`mc:AlternateContent` or `w:drawing`). Text in it is the envelope's `stories[story]`
     * (kind `textBox`, as a text box's), drawn with `inset`, `verticalAlign`, `autoFit` and
     * `textColor` (the style's font color) inside the geometry's text rectangle.
     */
    shape: {
      group: "inline",
      inline: true,
      attrs: {
        geometry: { default: "rect", validate: token },
        adjust: nullableAttr(checkAdjust),
        custom: nullableAttr(checkCustomGeometry),
        /** In EMU. */
        width: { validate: emu },
        height: { validate: emu },
        float: nullableAttr(checkFloat),
        /** Clockwise, in 60 000ths of a degree (null: none). */
        rotation: nullableAttr(rotation),
        flipH: nullableAttr(bool),
        flipV: nullableAttr(bool),
        /** RRGGBB, or null for no fill (`gradient` wins when set). */
        fill: nullableAttr(color),
        gradient: nullableAttr(checkGradient),
        /**
         * The line: color RRGGBB, width in EMU, Word's dash (`a:prstDash`: `dash`, `sysDot`…,
         * missing: solid), its ends (arrows); null for no line.
         */
        outline: nullableAttr(
          shape({ color, width: emu, dash: token, head: lineEnd, tail: lineEnd }, [
            "color",
            "width",
          ]),
        ),
        /** Its text (`wps:txbx`): a story of kind `textBox`; null for none. */
        story: nullableAttr(text()),
        inset: nullableAttr(shape({ left: emu, top: emu, right: emu, bottom: emu })),
        verticalAlign: nullableAttr(oneOf(["top", "center", "bottom"])),
        autoFit: nullableAttr(bool),
        /** The color of its text where the text sets none (the style's `a:fontRef`). */
        textColor: nullableAttr(color),
        alt: nullableAttr(str(65_535)),
        title: nullableAttr(str(65_535)),
        decorative: nullableAttr(bool),
        ext: nullableAttr(xml),
      },
    },
    /** Inline content Foli does not model yet (fields, charts, groups, symbols…), kept verbatim. */
    opaqueInline: {
      group: "inline",
      inline: true,
      attrs: {
        xml: { validate: xml },
        label: nullableAttr(text()),
        /**
         * Content of a run (`w:drawing`, `w:fldChar`… inside `w:r`): written back inside a run
         * with the node's run properties. Otherwise it stands between runs (`w:sdt`…).
         */
        run: { default: false, validate: bool },
        /**
         * Word's watermark (schema 9, ADR-0015): what its dialog sets, read from the VML shape
         * `xml` holds (`PowerPlusWaterMarkObject…`, `WordPictureWatermark…`). Drawn on the pages
         * of the header's sections; `xml` is written back while it still says this.
         */
        watermark: nullableAttr(checkWatermark),
      },
    },
    /**
     * A custom node whose extension is not loaded (ADR-0008): kept whole, written back as the
     * type and attributes it was read as. Only in memory: never saved under this name.
     */
    foreignInline: { group: "inline", inline: true, ...foreignNode },
    foreignBlock: { group: "block", ...foreignNode },
  },
  marks: {
    // Order: the canonical order of mark sets, and of nesting when rendered (outermost first).
    link: {
      attrs: {
        /**
         * The target as the file has it (`file:`, network paths…): not checked here. Whether
         * a link may be opened is decided where it is opened (`isSafeHref`).
         */
        href: markAttr(nullable(text(8192)), null),
        /** A bookmark in this document (`w:anchor`). */
        anchor: markAttr(nullable(text()), null),
        tooltip: markAttr(nullable(str(1024)), null),
        /** `w:hyperlink`'s other attributes (`w:history`, `w:tgtFrame`…). */
        attributes: markAttr(nullable(attributes), null),
      },
      inclusive: false,
    },
    insertion: reviewMark,
    deletion: reviewMark,
    characterStyle: { attrs: { id: markAttr(text()) } },
    bold: toggleWithComplexScript,
    italic: toggleWithComplexScript,
    underline: {
      attrs: { style: markAttr(token, "single"), color: markAttr(nullable(color), null) },
    },
    strike: toggle,
    doubleStrike: toggle,
    caps: toggle,
    smallCaps: toggle,
    hidden: toggle,
    font: {
      attrs: {
        ascii: fontName,
        hAnsi: fontName,
        eastAsia: fontName,
        cs: fontName,
        asciiTheme: themeFont,
        hAnsiTheme: themeFont,
        eastAsiaTheme: themeFont,
        csTheme: themeFont,
        hint: markAttr(nullable(oneOf(["default", "eastAsia", "cs"])), null),
      },
    },
    /** In half-points (`w:sz`; 24 = 12 pt), and for complex scripts (`w:szCs`); either may be missing. */
    fontSize: {
      attrs: {
        value: markAttr(nullable(int(1, 3276)), null),
        complexScript: markAttr(nullable(int(1, 3276)), null),
      },
    },
    color: {
      attrs: {
        value: markAttr(color),
        themeColor: markAttr(nullable(token), null),
        themeTint: markAttr(nullable(hexByte), null),
        themeShade: markAttr(nullable(hexByte), null),
      },
    },
    highlight: { attrs: { value: markAttr(oneOf(HIGHLIGHT_COLORS)) } },
    shading: {
      attrs: {
        pattern: markAttr(token),
        color: markAttr(color, "auto"),
        fill: markAttr(color, "auto"),
      },
    },
    verticalAlign: { attrs: { value: markAttr(oneOf(VERTICAL_ALIGNS)) } },
    /** Character spacing in twips (`w:spacing`), expanded or condensed. */
    characterSpacing: { attrs: { value: markAttr(twips) } },
    /** A tracked formatting change: the run properties before it. */
    formatChange: {
      attrs: {
        id: markAttr(ID),
        author: markAttr(str()),
        date: markAttr(nullable(date), null),
        previous: markAttr(checkRunProperties),
      },
    },
    /** The `w:rPr` these marks were read from, verbatim (see the module comment). */
    runExt: { attrs: { xml: markAttr(xml) } },
    /** A custom mark whose extension is not loaded, as `foreignInline` is a node. Several combine. */
    foreign: { attrs: foreign, excludes: "", inclusive: false },
  },
});
