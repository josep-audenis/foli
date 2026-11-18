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

export const LINE_RULES = ["auto", "exact", "atLeast"] as const;
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
export const TAB_LEADERS = ["none", "dot", "hyphen", "underscore", "heavy", "middleDot"] as const;
export const SECTION_TYPES = [
  "nextPage",
  "continuous",
  "evenPage",
  "oddPage",
  "nextColumn",
] as const;
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

/** How notes are placed and numbered (`w:footnotePr`, `w:endnotePr`), for a document or section. */
export const checkNoteProperties: Check = shape({
  position: oneOf(["pageBottom", "beneathText", "sectEnd", "docEnd"]),
  format: token,
  start: ID,
  restart: oneOf(["continuous", "eachSect", "eachPage"]),
});

/** Word's limit on a section's columns. */
const MAX_SECTION_COLUMNS = 45;

/**
 * A section's page setup (`w:sectPr`): on the last paragraph of each section, and the
 * envelope's for the last. Every part is optional (Word's defaults apply); `{}` is a section
 * break with Word's defaults.
 */
export const checkSection: Check = shape(
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
    footnotes: checkNoteProperties,
    endnotes: checkNoteProperties,
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

/** Table, row and cell properties as a table style or a row's exceptions give them. */
export const checkTableProperties: Check = propertiesCheck(tableProperties);
export const checkRowProperties: Check = propertiesCheck(rowProperties);
export const checkCellProperties: Check = propertiesCheck(cellProperties);

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
  },
  ["horizontal", "vertical", "wrap"],
);

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

/** Run properties given as marks JSON (a style's, a paragraph mark's, a recorded change's previous). */
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

/** The names of the paragraph properties (`w:pPr`) among a paragraph's attributes. */
export const PARAGRAPH_PROPERTY_KEYS: readonly string[] = Object.keys(paragraphProperties);

/** Paragraph properties as a style, a numbering level, the defaults or a recorded change give them. */
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
        /** `w:tr`'s own unknown attributes (`w14:paraId`, revision save ids…). */
        attributes: nullableAttr(attributes),
      },
    },
    tableCell: {
      // As Word requires, a cell ends with a paragraph.
      content: "block* paragraph",
      attrs: { ...cellProperties, ...controlsAttr },
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
        /** The `w:drawing` it was read from, verbatim (cropping, effects…). */
        ext: nullableAttr(xml),
      },
    },
    /** Inline content Foli does not model yet (fields, charts, shapes, symbols…), kept verbatim. */
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
      },
    },
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
  },
});
