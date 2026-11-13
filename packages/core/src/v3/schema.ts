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

/** Who made a tracked change or comment, and when (ids are Word's `w:id`; authors may be empty). */
const ID = int(0, 2_147_483_647);
const revisionFields = { id: ID, author: str(), date: nullable(date) };
const revision = shape(revisionFields, ["id", "author"]);

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
    ext: xml,
  },
  [],
  true,
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
    schemaV3.nodeFromJSON({ type: "text", text: "x", marks: v });
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
};

const nullableAttr = (check: Check): AttributeSpec => ({
  default: null,
  validate: nullable(check),
});

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
const fontName = markAttr(nullable(text()), null);
const themeFont = markAttr(nullable(oneOf(THEME_FONTS)), null);
const hexByte = (v: unknown) =>
  typeof v === "string" && /^[0-9A-Fa-f]{2}$/.test(v) ? undefined : "must be a hex byte";

export const schemaV3 = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: {
        ...paragraphProperties,
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
    /** Block content Foli does not model yet (tables until Phase 10…), kept verbatim. */
    opaqueBlock: {
      group: "block",
      attrs: { xml: { validate: xml }, label: nullableAttr(text()) },
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
    /** Inline content Foli does not model yet (fields, drawings, symbols…), kept verbatim. */
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
