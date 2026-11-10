import { type AttributeSpec, type MarkSpec, Schema } from "../model/index.js";
import { isSafeHref } from "../schema.js";
import {
  bool,
  both,
  type Check,
  color,
  date,
  int,
  isRecord,
  listOf,
  nullable,
  oneOf,
  shape,
  text,
  token,
  xml,
} from "./check.js";

/**
 * Schema v3: Word's document model ([ADR-0005](../../../../docs/decisions/ADR-0005-word-compatible-model.md)).
 * Paragraphs carry Word's paragraph properties as attributes and text carries its run
 * properties as marks, in Word's units (twips, half-points, eighths of a point), so values
 * survive a DOCX round trip exactly. Headings are paragraphs with a heading style; lists are
 * numbered paragraphs. What Foli does not model yet is kept as verbatim XML: opaque nodes, and
 * `ext` attributes for unknown properties of known elements. An unset property is null (the
 * style decides); every attribute defaults to null or to Word's own default.
 *
 * The editor still runs on schema v2 until rendering and editing move to v3 (8.6, 8.7); this
 * schema, the v3 envelope and the v2 → v3 migration exist alongside it until then.
 */

const MAX_TWIPS = 31_680; // 22 inches: Word's largest page dimension
const twips = int(-MAX_TWIPS, MAX_TWIPS);
const positiveTwips = int(0, MAX_TWIPS);

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

/** Who made a tracked change or comment, and when (ids are Word's `w:id`). */
const revision = { id: int(0, 2_147_483_647), author: text(), date: nullable(date) };

/** A section's page setup (`w:sectPr`): on the last paragraph of each section, and the envelope's last. */
export const checkSection: Check = shape(
  {
    pageSize: shape(
      {
        width: int(1, MAX_TWIPS),
        height: int(1, MAX_TWIPS),
        orientation: oneOf(["portrait", "landscape"]),
      },
      ["width", "height"],
    ),
    margins: shape(
      {
        top: twips,
        right: positiveTwips,
        bottom: twips,
        left: positiveTwips,
        header: positiveTwips,
        footer: positiveTwips,
        gutter: positiveTwips,
      },
      ["top", "right", "bottom", "left"],
    ),
    type: oneOf(SECTION_TYPES),
    titlePage: bool,
    headers: shape({ default: text(), first: text(), even: text() }),
    footers: shape({ default: text(), first: text(), even: text() }),
    ext: xml,
  },
  ["pageSize", "margins"],
);

/** Marks given as JSON (a paragraph mark's run properties, a style's, a recorded change's previous ones). */
export const checkMarks: Check = (v) => {
  if (!Array.isArray(v)) return "must be an array of marks";
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
 * Paragraph properties (`w:pPr`). The same attributes describe a style's or a numbering level's
 * paragraph properties (without `section`, `revision` and `formatChange`).
 */
const paragraphProperties: Record<string, AttributeSpec> = {
  style: nullableAttr(text()),
  justification: nullableAttr(oneOf(JUSTIFICATIONS)),
  indent: nullableAttr(
    both(
      shape({ left: twips, right: twips, firstLine: positiveTwips, hanging: positiveTwips }),
      (v) =>
        isRecord(v) && "firstLine" in v && "hanging" in v
          ? "cannot have both firstLine and hanging"
          : undefined,
    ),
  ),
  spacing: nullableAttr(
    shape({
      before: positiveTwips,
      after: positiveTwips,
      line: twips,
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
  /** `id` is the numbering instance (`w:numId`; 0 removes numbering), `level` 0–8 (`w:ilvl`). */
  numbering: nullableAttr(shape({ id: int(0, 2_147_483_647), level: int(0, 8) }, ["id", "level"])),
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
  markFormat: nullableAttr(checkMarks),
  /** Unknown children of `w:pPr`, verbatim, written back while the paragraph is unchanged. */
  ext: nullableAttr(xml),
};

/** The attributes a style or numbering level may set (paragraph properties without the per-paragraph ones). */
export const PARAGRAPH_PROPERTY_NAMES = Object.keys(paragraphProperties);

/**
 * Paragraph properties as a style, a numbering level, the defaults or a recorded change give
 * them: only those attributes, none null (an unset property is left out).
 */
export const checkParagraphProperties: Check = (v) => {
  if (!isRecord(v)) return "must be an object";
  for (const [key, value] of Object.entries(v)) {
    const spec = paragraphProperties[key];
    if (!spec) return `unknown key ${key}`;
    const error = value === null ? "must not be null (leave it out)" : spec.validate?.(value);
    if (error) return `${key} ${error}`;
  }
  return undefined;
};

const markAttr = (check: Check, defaultValue?: unknown): AttributeSpec =>
  defaultValue === undefined ? { validate: check } : { default: defaultValue, validate: check };

/** A run property that is on unless `value` is false (`<w:b w:val="0"/>` turns off a style's bold). */
const toggle: MarkSpec = { attrs: { value: markAttr(bool, true) } };

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
        /** The paragraph mark inserted or deleted as a tracked change. */
        revision: nullableAttr(
          shape({ kind: oneOf(["insertion", "deletion"]), ...revision }, ["kind", "id", "author"]),
        ),
        /** A tracked formatting change: the paragraph properties before it. */
        formatChange: nullableAttr(
          shape({ ...revision, previous: (v) => checkParagraphProperties(v) }, [
            "id",
            "author",
            "previous",
          ]),
        ),
      },
    },
    /** Block content Foli does not model yet (tables until Phase 10…), kept verbatim. */
    opaqueBlock: { group: "block", attrs: { xml: { validate: xml }, label: nullableAttr(text()) } },
    text: { group: "inline" },
    tab: { group: "inline", inline: true },
    hardBreak: { group: "inline", inline: true, selectable: false },
    pageBreak: { group: "inline", inline: true, selectable: false },
    columnBreak: { group: "inline", inline: true, selectable: false },
    /** Where a comment's range starts and ends (`w:commentRangeStart`/`End`), and its reference mark. */
    commentStart: {
      group: "inline",
      inline: true,
      selectable: false,
      attrs: { id: { validate: revision.id } },
    },
    commentEnd: {
      group: "inline",
      inline: true,
      selectable: false,
      attrs: { id: { validate: revision.id } },
    },
    commentReference: { group: "inline", inline: true, attrs: { id: { validate: revision.id } } },
    /** Inline content Foli does not model yet (fields, drawings, symbols…), kept verbatim. */
    opaqueInline: {
      group: "inline",
      inline: true,
      attrs: { xml: { validate: xml }, label: nullableAttr(text()) },
    },
  },
  marks: {
    // Order: the canonical order of mark sets, and of nesting when rendered (outermost first).
    link: {
      attrs: {
        href: nullableAttr((v) =>
          isSafeHref(v) ? undefined : "must be a relative URL or use http, https, mailto or tel",
        ),
        /** A bookmark in this document (`w:anchor`). */
        anchor: nullableAttr(text()),
        tooltip: nullableAttr(text(1024)),
      },
      inclusive: false,
    },
    insertion: {
      attrs: {
        id: markAttr(revision.id),
        author: markAttr(revision.author),
        date: markAttr(revision.date, null),
      },
      inclusive: false,
    },
    deletion: {
      attrs: {
        id: markAttr(revision.id),
        author: markAttr(revision.author),
        date: markAttr(revision.date, null),
      },
      inclusive: false,
    },
    characterStyle: { attrs: { id: markAttr(text()) } },
    bold: toggle,
    italic: toggle,
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
        ascii: markAttr(nullable(text(31)), null),
        hAnsi: markAttr(nullable(text(31)), null),
        eastAsia: markAttr(nullable(text(31)), null),
        cs: markAttr(nullable(text(31)), null),
        asciiTheme: markAttr(nullable(oneOf(THEME_FONTS)), null),
        hAnsiTheme: markAttr(nullable(oneOf(THEME_FONTS)), null),
        eastAsiaTheme: markAttr(nullable(oneOf(THEME_FONTS)), null),
        csTheme: markAttr(nullable(oneOf(THEME_FONTS)), null),
      },
    },
    /** In half-points (`w:sz`; 24 = 12 pt), and for complex scripts (`w:szCs`). */
    fontSize: {
      attrs: {
        value: markAttr(int(1, 3276)),
        complexScript: markAttr(nullable(int(1, 3276)), null),
      },
    },
    color: {
      attrs: {
        value: markAttr(color),
        themeColor: markAttr(nullable(token), null),
        themeTint: markAttr(
          nullable((v) =>
            /^[0-9A-Fa-f]{2}$/.test(v as string) ? undefined : "must be a hex byte",
          ),
          null,
        ),
        themeShade: markAttr(
          nullable((v) =>
            /^[0-9A-Fa-f]{2}$/.test(v as string) ? undefined : "must be a hex byte",
          ),
          null,
        ),
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
    /** A tracked formatting change: the run's marks before it. */
    formatChange: {
      attrs: {
        id: markAttr(revision.id),
        author: markAttr(revision.author),
        date: markAttr(revision.date, null),
        previous: markAttr(checkMarks),
      },
    },
    /** Unknown children of `w:rPr`, verbatim. */
    runExt: { attrs: { xml: markAttr(xml) } },
  },
});
