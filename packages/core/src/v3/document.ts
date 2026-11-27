import { DEFAULT_SETTINGS, parseDocumentV2 } from "../document.js";
import {
  FoliDocumentError,
  type MarkJSON,
  type Node,
  type NodeJSON,
  type Schema,
} from "../model/index.js";
import {
  bool,
  type Check,
  color,
  date,
  int,
  isRecord,
  listOf,
  oneOf,
  shape,
  str,
  text,
  token,
  xml,
} from "./check.js";
import {
  type ContentOptions,
  type ParseOptions,
  resolveCustom,
  schemaWith,
  writeCustom,
} from "./extensions.js";
import { migrateToV3 } from "./migrate.js";
import {
  checkCellProperties,
  checkNoteProperties,
  checkRowProperties,
  checkSection,
  checkTableProperties,
  checkParagraphProperties as paragraphProperties,
  checkRunProperties as runProperties,
} from "./schema.js";

/**
 * The schema version of documents in the Word model (ADR-0005; v4 adds tables and pictures,
 * ADR-0006; v5 stories, fields, content controls and notes, ADR-0007; v6 a picture's rotation and
 * crop; v7 the tracking switch in the settings, ADR-0012; v8 a table's, row's or cell's recorded
 * formatting, Phase 23 task 23.2; v9 page decoration: the page color, a section's page borders
 * and line numbers, ADR-0015).
 */
export const SCHEMA_VERSION = 10;

/** Page setup of a section, in twips (1/1440 inch). Missing parts take Word's defaults. */
export interface SectionJSON {
  pageSize?: { width?: number; height?: number; orientation?: "portrait" | "landscape" };
  margins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
    header?: number;
    footer?: number;
    gutter?: number;
  };
  type?: "nextPage" | "continuous" | "evenPage" | "oddPage" | "nextColumn";
  titlePage?: boolean;
  /** Relationship ids of the header and footer parts (their content stays in the package until Phase 11). */
  headers?: { default?: string; first?: string; even?: string };
  footers?: { default?: string; first?: string; even?: string };
  /** `w:cols` (v5). `widths` when the columns are not of equal width. */
  columns?: {
    count?: number;
    space?: number;
    equalWidth?: boolean;
    separator?: boolean;
    widths?: { width: number; space?: number }[];
  };
  /** `w:pgNumType` (v5). */
  pageNumbers?: { start?: number; format?: string };
  /** `w:pgBorders` (v9): borders around the section's pages. */
  pageBorders?: PageBordersJSON;
  /** `w:lnNumType` (v9): the section's lines numbered in the margin. */
  lineNumbers?: LineNumbersJSON;
  footnotes?: NotePropertiesJSON;
  endnotes?: NotePropertiesJSON;
  /** `w:sectPrChange`: who changed the page setup while tracking, and what it was. */
  change?: { id: number; author: string; date?: string | null; previous: SectionJSON };
  /** The `w:sectPr` this was read from, verbatim. */
  ext?: string;
}

/** A section's page borders (`w:pgBorders`, schema 9). */
export interface PageBordersJSON {
  top?: BorderJSON;
  left?: BorderJSON;
  bottom?: BorderJSON;
  right?: BorderJSON;
  /** What each border's `space` (points) is measured from: the text (Word's default) or the page's edge. */
  offsetFrom?: "text" | "page";
  /** Which pages show them: every page (the default), the section's first, or all but its first. */
  display?: "allPages" | "firstPage" | "notFirstPage";
  /** In front of the text (the default) or behind it. */
  zOrder?: "front" | "back";
}

/**
 * A section's line numbers (`w:lnNumType`, schema 9), as Word writes them: every `countBy`th line
 * numbered (an element without it numbers none, and stays in the section's `ext`), from `start` + 1 (Word's "Start at" less one), `distance` twips from
 * the text (left out: Word's automatic distance), restarting on each page, section, or not at all
 * (left out: continuous, as Word 16 writes and reads it).
 */
export interface LineNumbersJSON {
  countBy: number;
  start?: number;
  distance?: number;
  restart?: "newPage" | "newSection" | "continuous";
}

/** How notes are placed and numbered (`w:footnotePr`, `w:endnotePr`). */
export interface NotePropertiesJSON {
  position?: "pageBottom" | "beneathText" | "sectEnd" | "docEnd";
  format?: string;
  start?: number;
  restart?: "continuous" | "eachSect" | "eachPage";
}

export interface BorderJSON {
  style: string;
  size?: number;
  space?: number;
  color?: string;
  themeColor?: string;
}

/** Paragraph properties (`w:pPr`) as a paragraph's attributes, a style, a numbering level or the defaults give them. */
export interface ParagraphPropertiesJSON {
  style?: string;
  justification?: string;
  /** Twips; with both `firstLine` and `hanging`, Word applies `hanging`. */
  indent?: { left?: number; right?: number; firstLine?: number; hanging?: number };
  spacing?: {
    before?: number;
    after?: number;
    line?: number;
    lineRule?: "auto" | "exact" | "atLeast";
    beforeAutospacing?: boolean;
    afterAutospacing?: boolean;
  };
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  pageBreakBefore?: boolean;
  contextualSpacing?: boolean;
  /** `w:suppressLineNumbers` (schema 9). */
  suppressLineNumbers?: boolean;
  outlineLevel?: number;
  numbering?: { id?: number; level?: number };
  tabs?: { position: number; kind: string; leader?: string }[];
  borders?: Partial<Record<"top" | "bottom" | "left" | "right" | "between" | "bar", BorderJSON>>;
  shading?: { pattern: string; color?: string; fill?: string; themeFill?: string };
  markFormat?: MarkJSON[];
  ext?: string;
}

/** A table measure: twips (`dxa`), fiftieths of a percent (`pct`), or `auto`/`nil` with 0. */
export interface MeasureJSON {
  value: number;
  type: "auto" | "dxa" | "pct" | "nil";
}

type Sides<T, Extra extends string = never> = Partial<
  Record<"top" | "left" | "bottom" | "right" | "start" | "end" | Extra, T>
>;

/** Table properties (`w:tblPr`): a table's attributes, a table style's, a row's exceptions. */
export interface TablePropertiesJSON {
  style?: string;
  width?: MeasureJSON;
  justification?: "left" | "center" | "right" | "start" | "end";
  indent?: MeasureJSON;
  layout?: "fixed" | "autofit";
  borders?: Sides<BorderJSON, "insideH" | "insideV">;
  cellMargins?: Sides<MeasureJSON>;
  cellSpacing?: MeasureJSON;
  shading?: ParagraphPropertiesJSON["shading"];
  look?: {
    firstRow?: boolean;
    lastRow?: boolean;
    firstColumn?: boolean;
    lastColumn?: boolean;
    noHBand?: boolean;
    noVBand?: boolean;
  };
  rowBandSize?: number;
  columnBandSize?: number;
  ext?: string;
}

/** Row properties (`w:trPr`). */
export interface RowPropertiesJSON {
  height?: { value: number; rule?: "auto" | "exact" | "atLeast" };
  cantSplit?: boolean;
  header?: boolean;
  gridBefore?: number;
  widthBefore?: MeasureJSON;
  gridAfter?: number;
  widthAfter?: MeasureJSON;
  ext?: string;
}

/** Cell properties (`w:tcPr`). */
export interface CellPropertiesJSON {
  width?: MeasureJSON;
  gridSpan?: number;
  vMerge?: "restart" | "continue";
  borders?: Sides<BorderJSON, "insideH" | "insideV" | "tl2br" | "tr2bl">;
  shading?: ParagraphPropertiesJSON["shading"];
  margins?: Sides<MeasureJSON>;
  verticalAlign?: "top" | "center" | "bottom" | "both";
  textDirection?: string;
  noWrap?: boolean;
  ext?: string;
}

/** The parts of a table style a conditional format (`w:tblStylePr`) can apply to. */
export const TABLE_CONDITIONS = [
  "wholeTable",
  "band1Vert",
  "band2Vert",
  "band1Horz",
  "band2Horz",
  "firstCol",
  "lastCol",
  "firstRow",
  "lastRow",
  "nwCell",
  "neCell",
  "swCell",
  "seCell",
] as const;
export type TableCondition = (typeof TABLE_CONDITIONS)[number];

/** A table style's conditional format (`w:tblStylePr`): what its part of the table looks like. */
export interface TableConditionJSON {
  type: Exclude<TableCondition, "wholeTable">;
  paragraph?: ParagraphPropertiesJSON;
  run?: MarkJSON[];
  table?: TablePropertiesJSON;
  row?: RowPropertiesJSON;
  cell?: CellPropertiesJSON;
  /** The `w:tblStylePr` this was read from, verbatim. */
  ext?: string;
}

export interface StyleJSON {
  /** `w:styleId`, what paragraphs and runs reference. With duplicates, the first wins, as in Word. */
  id: string;
  type: "paragraph" | "character" | "table" | "numbering";
  name?: string;
  basedOn?: string;
  next?: string;
  link?: string;
  /** The default style of its type (Normal, Default Paragraph Font, Normal Table…). */
  isDefault?: boolean;
  paragraph?: ParagraphPropertiesJSON;
  run?: MarkJSON[];
  /** A table style's whole-table properties. */
  table?: TablePropertiesJSON;
  row?: RowPropertiesJSON;
  cell?: CellPropertiesJSON;
  /** A table style's conditional formats (first row, bands…). */
  conditions?: TableConditionJSON[];
  /** The `w:style` this was read from, verbatim (UI priority…). */
  ext?: string;
}

/**
 * Where a picture's bytes are (schema v4): a part of the original package, a URL the app gave
 * (its upload hook's), or, when the app opts into it, a `data:` URL. At least one.
 */
export interface ResourceJSON {
  /** `image/png`, `image/jpeg`, `image/svg+xml`… */
  contentType: string;
  /** Bytes, when known. */
  size?: number;
  /** The package part (`word/media/image1.png`). */
  part?: string;
  url?: string;
  /** A `data:` URL holding the bytes. */
  data?: string;
}

export interface NumberingLevelJSON {
  level: number;
  start?: number;
  /** `w:numFmt`: decimal (Word's default), bullet, lowerLetter, upperRoman, none… */
  format?: string;
  /** `w:lvlText`: "%1.", "%1.%2", "•"… */
  text?: string;
  justification?: "left" | "center" | "right" | "start" | "end";
  /** `w:lvlRestart`: restart after this level (0 never). */
  restart?: number;
  /** `w:isLgl`: legal numbering (arabic numbers in a multi-level number). */
  legal?: boolean;
  suffix?: "tab" | "space" | "nothing";
  /** `w:pStyle`: the style this level numbers (numbered headings). */
  style?: string;
  paragraph?: ParagraphPropertiesJSON;
  run?: MarkJSON[];
  /** The `w:lvl` this was read from, verbatim. */
  ext?: string;
}

export interface AbstractNumberingJSON {
  /** `w:abstractNumId`. */
  id: number;
  multiLevelType?: "singleLevel" | "multilevel" | "hybridMultilevel";
  levels: NumberingLevelJSON[];
  styleLink?: string;
  numStyleLink?: string;
  ext?: string;
}

export interface NumberingInstanceJSON {
  /** `w:numId`, what paragraphs reference. */
  id: number;
  /** May name a definition that does not exist: the paragraphs are then not numbered, as in Word. */
  abstract: number;
  overrides?: { level: number; start?: number; definition?: NumberingLevelJSON }[];
  ext?: string;
}

export interface ThemeJSON {
  fonts: {
    major: { latin: string; eastAsia?: string; cs?: string };
    minor: { latin: string; eastAsia?: string; cs?: string };
  };
  /** dk1, lt1, dk2, lt2, accent1–6, hlink, folHlink: RRGGBB. */
  colors: Record<string, string>;
}

export interface CommentJSON {
  id: number;
  author: string;
  initials?: string;
  date?: string;
  /** The comment's paragraphs (schema v3 blocks). */
  content: NodeJSON[];
  /** The comment this one replies to (a missing one makes it a thread of its own). */
  parent?: number;
  /** Resolved. */
  done?: boolean;
  /** The `w:comment` start tag, verbatim: its attributes as the file has them. */
  ext?: string;
}

/**
 * Content outside the body (schema v5, ADR-0007). `noteType` is a note's `w:type`: the separators
 * and the continuation notice have no reference and are not numbered. A text box's text is a
 * story of kind `textBox` (schema 10, ADR-0016), its `textBox` node in the body or a header or
 * footer.
 */
export interface StoryJSON {
  kind: "header" | "footer" | "footnote" | "endnote" | "textBox";
  noteType?: "normal" | "separator" | "continuationSeparator" | "continuationNotice";
  /** A `doc` of blocks. */
  content: NodeJSON;
  /** What the part keeps of the story's own element, verbatim. */
  ext?: string;
}

/** A content control's properties (`w:sdtPr`, schema v5), by the id its nodes refer to. */
export interface ControlJSON {
  kind:
    | "text"
    | "richText"
    | "dropDown"
    | "comboBox"
    | "date"
    | "checkbox"
    | "picture"
    | "repeating"
    | "repeatingItem"
    | "other";
  tag?: string;
  alias?: string;
  lock?: "sdtLocked" | "contentLocked" | "sdtContentLocked" | "unlocked";
  items?: { value: string; display?: string }[];
  dateFormat?: string;
  /** `w:date/@w:fullDate`: the date picked, as Word writes it (`2026-03-03T00:00:00Z`). */
  date?: string;
  checked?: boolean;
  /** A check box's glyphs (`w14:checkedState`, `w14:uncheckedState`): hex code and font. */
  checkedState?: { value: string; font?: string };
  uncheckedState?: { value: string; font?: string };
  /** `w:text/@w:multiLine`: a plain text control that takes line breaks. */
  multiLine?: boolean;
  /** `w:sdtPr/w:rPr` as marks: how text put in place of the placeholder looks. */
  format?: MarkJSON[];
  /** `w15:doNotAllowInsertDeleteSection`: a repeating section's items are fixed. */
  noInsertDelete?: boolean;
  /** Deleted whole while tracking (in the editor: not written): accepting removes the control. */
  deleted?: boolean;
  /**
   * `showing`: the content is the placeholder. `docPart`: the glossary entry it comes from.
   * `text`: that entry's text, what emptying the control brings back.
   */
  placeholder?: { showing?: boolean; docPart?: string; text?: string };
  /** `w:dataBinding`: kept, not evaluated. */
  binding?: { xpath?: string; storeItemId?: string; prefixMappings?: string };
  /** `w:sdtPr` and `w:sdtEndPr`, verbatim. */
  ext?: string;
}

/** What `word/settings.xml` says about pages and notes (schema v5). */
export interface WordSettingsJSON {
  /**
   * `w:compat/w:doNotUseHTMLParagraphAutoSpacing`: the space after a paragraph and the space
   * before the next add up (without it Word takes the larger, in every compatibility mode).
   */
  doNotUseHTMLParagraphAutoSpacing?: boolean;
  evenAndOddHeaders?: boolean;
  footnotes?: NotePropertiesJSON;
  endnotes?: NotePropertiesJSON;
  /**
   * `w:trackRevisions`: edits are recorded as tracked changes (schema 7). Left out: the document
   * never said (an editor tracks when told to; `exportDocx` keeps the package's).
   */
  trackRevisions?: boolean;
  /**
   * The page color (schema 9): the main document's `w:background` (it lives in `document.xml`, not
   * in the settings part). `color` is RRGGBB; a theme color also gives its tint or shade, as Word
   * writes them (two hex digits). What else the element holds (Fill Effects) is kept while the
   * color stays.
   */
  background?: PageBackgroundJSON;
}

/**
 * Word's watermark (schema 9): an opaque run's `watermark`, read from the VML shape it holds. A
 * text's (`text`, `font`, `color` RRGGBB, `semitransparent`, `rotation` in degrees, 315 being
 * Word's diagonal) or a picture's (`picture`, a key of `resources`; `washout`), in a box of
 * `width` by `height` twips centered on the page's text area, behind the text.
 */
export interface WatermarkJSON {
  kind: "text" | "picture";
  text?: string;
  font?: string;
  color?: string;
  semitransparent?: boolean;
  rotation?: number;
  picture?: string;
  washout?: boolean;
  width: number;
  height: number;
}

/** The page color (`w:background`, schema 9). */
export interface PageBackgroundJSON {
  color?: string;
  themeColor?: string;
  themeTint?: string;
  themeShade?: string;
  /** The `w:background` this was read from, verbatim. */
  ext?: string;
}

/** A document in the Word model: the content tree and what Word keeps beside it. */
export interface FoliDocument {
  /**
   * The lowest schema its content needs (ADR-0008): 5 (1.0's) unless it holds what a later one
   * added (6: a picture's rotation or crop, 1.4; 10: text boxes).
   */
  schemaVersion: 5 | 6 | 7 | 8 | 9 | typeof SCHEMA_VERSION;
  /** The last section's page setup (`w:body/w:sectPr`); earlier sections end at paragraphs. */
  section: SectionJSON;
  /** Document defaults (`w:docDefaults`). */
  defaults: {
    paragraph?: ParagraphPropertiesJSON;
    run?: MarkJSON[];
    /** The `w:docDefaults` these were read from, verbatim. */
    ext?: string;
  };
  styles: StyleJSON[];
  numbering: { abstracts: AbstractNumberingJSON[]; instances: NumberingInstanceJSON[] };
  theme?: ThemeJSON;
  comments: CommentJSON[];
  /** The pictures' bytes, by the key `picture` nodes give (none when missing). */
  resources?: Record<string, ResourceJSON>;
  /** Headers, footers and notes, by id (a header's or footer's is its relationship id). */
  stories?: Record<string, StoryJSON>;
  /** Content controls' properties, by the id their nodes refer to. */
  controls?: Record<string, ControlJSON>;
  settings?: WordSettingsJSON;
  content: NodeJSON;
}

/** A document of schema v4 (no stories, fields or content controls in the model). */
export type FoliDocumentV4 = Omit<
  FoliDocument,
  "schemaVersion" | "stories" | "controls" | "settings"
> & { schemaVersion: 4 };

/** A document of schema v3 (no tables or pictures in the model), as `migrateToV3` gives it. */
export type FoliDocumentV3 = Omit<FoliDocumentV4, "schemaVersion" | "resources"> & {
  schemaVersion: 3;
};

/** Schema v3 → v4: the version only (a table kept opaque stays so until imported again). */
export function migrateToV4(doc: FoliDocumentV3): FoliDocumentV4 {
  return { ...doc, schemaVersion: 4 };
}

/** Schema v4 → v5: the version only (what is opaque stays so until imported again). */
export function migrateToV5(doc: FoliDocumentV4): FoliDocument {
  return { ...doc, schemaVersion: 5 };
}

/**
 * The lowest schema `doc`'s content needs (ADR-0008: a document is saved with it, so an older
 * 1.x reads it when it can): 10 for text boxes, 9 for page decoration (the page color, a section's page borders or
 * line numbers), 8 for a table's, row's or cell's recorded formatting, 7 for the tracking switch
 * in the settings, 6 for a picture rotated or cropped, else 5.
 * @internal
 */
export function schemaVersionOf(
  doc: Pick<FoliDocument, "content" | "comments" | "stories"> & {
    settings?: WordSettingsJSON | undefined;
    section?: SectionJSON | undefined;
    styles?: unknown;
    defaults?: unknown;
    numbering?: unknown;
  },
): FoliDocument["schemaVersion"] {
  const trees = [
    doc.content,
    ...doc.comments.map((c) => ({ content: c.content })),
    ...Object.values(doc.stories ?? {}).map((s) => s.content),
  ];
  if (
    Object.values(doc.stories ?? {}).some((s) => s.kind === "textBox") ||
    trees.some((tree) => laterNode(tree, 9))
  )
    return 10;
  if (
    doc.settings?.background !== undefined ||
    V9_SECTION_KEYS.some((key) => inSection(doc.section, key)) ||
    suppressesLineNumbers(doc) ||
    trees.some((tree) => laterNode(tree, 8))
  )
    return 9;
  if (trees.some((tree) => laterNode(tree, 7))) return 8;
  if (doc.settings?.trackRevisions !== undefined) return 7;
  return trees.some((tree) => laterNode(tree, 5)) ? 6 : 5;
}

/**
 * A new document: `content` (schema v5; default: one empty paragraph) on A4 with 25.4 mm
 * margins, with the styles and list definitions the editor's commands use (Normal, Heading 1–6,
 * List Paragraph, Hyperlink; bullets and numbers) and 11 pt Georgia, 1.5 lines: the look a
 * migrated 0.2.0 document has. `section` (in twips: `mmToTwips`) is merged over that page:
 * `pageSize` and `margins` part by part. Not validated: `parseDocument` (or `createEditor`) does
 * that.
 */
export function createDocument(
  content: NodeJSON = { type: "doc", content: [{ type: "paragraph" }] },
  section?: SectionJSON,
): FoliDocument {
  const empty = { type: "doc", content: [] } as const satisfies NodeJSON;
  const blank = migrateToV5(
    migrateToV4(
      migrateToV3({ schemaVersion: 2, settings: DEFAULT_SETTINGS, content: empty as never }),
    ),
  );
  const base = blank.section;
  const made: FoliDocument = {
    ...blank,
    // The default (A4) section has only pageSize and margins: each merged part by part.
    section: {
      ...section,
      pageSize: { ...base.pageSize, ...section?.pageSize },
      margins: { ...base.margins, ...section?.margins },
    },
    content,
  };
  // The version its content needs (6 for a rotated or cropped picture).
  made.schemaVersion = schemaVersionOf(made);
  return made;
}

/**
 * Validates untrusted input against schema v3. Returns a copy that shares nothing with the
 * input, with the content and the comments' content in canonical form. Documents of schema 1
 * and 2 are validated as such and migrated (`migrateToV3`). Throws FoliDocumentError instead
 * of dropping anything.
 *
 * Custom types (ADR-0008) are validated by `options.extensions`; a namespaced type none of them
 * declares is kept as it is, its attributes checked only as plain JSON (a foreign node or mark).
 *
 * What Word opens is accepted: duplicate ids (the first wins; a repeated comment id is given
 * anew, `distinctComments`), a numbering instance or a reply
 * whose target is missing, references to styles that do not exist. Rejected is only what the
 * engine cannot work with: wrong types, out-of-range values, and cycles (a style based on
 * itself, comments replying to each other) that would never end when followed.
 */
export function parseDocument(input: unknown, options: ParseOptions = {}): FoliDocument {
  if (!isRecord(input)) throw new FoliDocumentError("Document must be an object");
  const version = input.schemaVersion;
  if (version === 1 || version === 2) {
    return parseDocument(migrateToV5(migrateToV4(migrateToV3(parseDocumentV2(input)))), options);
  }
  if (
    version === 3 ||
    version === 4 ||
    version === 5 ||
    version === 6 ||
    version === 7 ||
    version === 8 ||
    version === 9
  ) {
    if (version === 3 && Object.hasOwn(input, "resources"))
      fail("resources", "unknown key (schema 4 and later)");
    if (version < 5)
      for (const key of V5_KEYS)
        if (Object.hasOwn(input, key)) fail(key, "unknown key (schema 5 and later)");
    const doc = parseDocument({ ...input, schemaVersion: SCHEMA_VERSION }, options);
    // What a later schema added is not in a document that says it is of an earlier one.
    const later = version < 5 ? laterSection(doc.section) : undefined;
    if (later) fail("section", `${later} is of schema 5 (the document says schema ${version})`);
    if (version < 7 && doc.settings?.trackRevisions !== undefined)
      fail("settings.trackRevisions", `is of schema 7 (the document says schema ${version})`);
    const boxed = Object.entries(doc.stories ?? {}).find(([, s]) => s.kind === "textBox");
    if (boxed)
      fail(
        `stories[${JSON.stringify(boxed[0])}]`,
        `a text box is of schema 10 (the document says schema ${version})`,
      );
    if (version === 9) {
      for (const [path, content] of contentTrees(doc)) {
        const found = laterNode(content, 9);
        if (found)
          fail(
            path,
            `${found.name} is a schema ${found.schema} node (the document says schema ${version})`,
          );
      }
      return doc;
    }
    if (doc.settings?.background !== undefined)
      fail("settings.background", `is of schema 9 (the document says schema ${version})`);
    if (suppressesLineNumbers(doc))
      fail(
        "styles, defaults or numbering",
        `suppressLineNumbers is of schema 9 (the document says schema ${version})`,
      );
    const decorated = V9_SECTION_KEYS.find((key) => inSection(doc.section, key));
    if (decorated)
      fail("section", `${decorated} is of schema 9 (the document says schema ${version})`);
    for (const [path, content] of contentTrees(doc)) {
      const found = laterNode(content, version);
      if (found)
        fail(
          path,
          `${found.name} is a schema ${found.schema} node (the document says schema ${version})`,
        );
    }
    adoptKeptDecoration(doc);
    if (version >= 5) return doc;
    if (version === 3)
      doc.styles.forEach((style, i) => {
        for (const key of ["table", "row", "cell", "conditions"]) {
          if (Object.hasOwn(style, key))
            fail(`styles[${i}]`, `unknown key ${key} (schema 4 and later)`);
        }
      });
    return doc;
  }
  if (version !== SCHEMA_VERSION) {
    if (typeof version === "string")
      throw new FoliDocumentError(
        `schemaVersion must be a number, not the string ${JSON.stringify(version)}`,
      );
    const newer = Number.isInteger(version) && (version as number) > SCHEMA_VERSION;
    throw new FoliDocumentError(
      `Unsupported schemaVersion: ${String(version)} (this version of @folijs/core reads 1 to ` +
        `${SCHEMA_VERSION}${newer ? "; the document was saved by a newer one" : ""})`,
    );
  }
  for (const key of Object.keys(input)) {
    if (!ENVELOPE_KEYS.includes(key)) throw new FoliDocumentError(`${key}: unknown key`);
  }
  check("section", input.section, checkSection);
  check(
    "defaults",
    input.defaults,
    shape({ paragraph: paragraphProperties, run: runProperties, ext: xml }, [], true),
  );
  check("styles", input.styles, listOf(checkStyle));
  check(
    "numbering",
    input.numbering,
    shape({ abstracts: listOf(checkAbstract), instances: listOf(checkInstance) }, [
      "abstracts",
      "instances",
    ]),
  );
  if (input.theme !== undefined) check("theme", input.theme, checkTheme);
  check("comments", input.comments, listOf(checkComment));
  if (input.resources !== undefined) check("resources", input.resources, checkResources);
  if (input.stories !== undefined) check("stories", input.stories, checkStories);
  if (input.controls !== undefined) check("controls", input.controls, checkControls);
  if (input.settings !== undefined) check("settings", input.settings, checkSettings);
  const styles = input.styles as StyleJSON[];
  const distinct = distinctComments(input.comments as CommentJSON[], input.content);
  const comments = distinct.comments;
  noCycles(
    "styles",
    styles,
    (s) => s.id,
    (s) => s.basedOn,
    (s) => `${s.id} is based on itself`,
  );
  noCycles(
    "comments",
    comments,
    (c) => c.id,
    (c) => c.parent,
    (c) => `comment ${c.id} replies to itself`,
  );

  const schema = schemaWith(options.extensions);
  const content = parseContent(distinct.content, { schema });
  const trees = new Map<string, Node>();
  const stories = Object.entries((input.stories ?? {}) as Record<string, StoryJSON>).map(
    ([id, story]) => {
      const path = `stories[${JSON.stringify(id)}].content`;
      const tree = parseContent(story.content, { path, schema });
      storyRules(tree, story.kind, path);
      trees.set(id, tree);
      return [id, { ...structuredClone({ ...story, content: null }), content: copied(tree) }];
    },
  );
  // A box's story, when there is one, is a text box's: no header or note drawn inside a box
  // (which could hold the box again).
  const given = (input.stories ?? {}) as Record<string, StoryJSON>;
  const boxStories = (tree: Node, path: string) =>
    tree.descendants((node) => {
      const id = node.type.name === "textBox" ? String(node.attrs.story) : null;
      if (id !== null && Object.hasOwn(given, id) && given[id]?.kind !== "textBox")
        fail(path, `a text box's story must be of kind textBox (${JSON.stringify(id)} is not)`);
      return true;
    });
  boxStories(content, "content");
  for (const [id, story] of Object.entries(given))
    if (story.kind === "header" || story.kind === "footer")
      boxStories(trees.get(id) as Node, `stories[${JSON.stringify(id)}].content`);
  // A copy: the validated document must not change when the caller's input does.
  const envelope = structuredClone({
    section: input.section,
    defaults: input.defaults,
    styles,
    numbering: input.numbering,
    theme: input.theme,
    resources: input.resources,
    controls: input.controls,
    settings: input.settings,
  }) as Pick<
    FoliDocument,
    | "section"
    | "defaults"
    | "styles"
    | "numbering"
    | "theme"
    | "resources"
    | "controls"
    | "settings"
  >;
  const parsed: FoliDocument = {
    schemaVersion: SCHEMA_VERSION,
    section: envelope.section,
    defaults: envelope.defaults,
    styles: envelope.styles,
    numbering: envelope.numbering,
    ...(envelope.theme === undefined ? {} : { theme: envelope.theme }),
    comments: comments.map((c, i) => ({
      ...structuredClone({ ...c, content: [] }),
      content: blocks(c.content, `comments[${i}].content`, schema).map((block) => {
        block.descendants((node) => {
          if (node.type.name === "noteReference")
            fail(`comments[${i}].content`, "a comment cannot hold a note reference");
          if (node.type.name === "textBox")
            fail(`comments[${i}].content`, "a comment cannot hold a text box");
          return true;
        });
        return copied(block);
      }),
    })),
    ...(envelope.resources === undefined ? {} : { resources: envelope.resources }),
    ...(input.stories === undefined ? {} : { stories: Object.fromEntries(stories) }),
    ...(envelope.controls === undefined ? {} : { controls: envelope.controls }),
    ...(envelope.settings === undefined ? {} : { settings: envelope.settings }),
    content: copied(content),
  };
  parsed.schemaVersion = schemaVersionOf(parsed);
  return parsed;
}

/** Each content tree of a validated document, with its path. */
const contentTrees = (doc: FoliDocument) =>
  [
    ["content", doc.content],
    ...doc.comments.map((c, i) => [`comments[${i}].content`, { content: c.content }] as const),
    ...Object.entries(doc.stories ?? {}).map(
      ([id, s]) => [`stories[${JSON.stringify(id)}].content`, s.content] as const,
    ),
  ] as const;

/** A node's JSON sharing nothing with the input its attributes came from, foreign types written back. */
const copied = (node: Node): NodeJSON => writeCustom(structuredClone(node.toJSON()));

/**
 * Parses untrusted schema v4 content into a `doc` node, with Word's rules the content
 * expressions do not say (`fragment`: content to paste, which a table may end): a table is never
 * followed by a table (Word would merge them; tables in different content controls stay apart)
 * nor ends the document, and a paragraph in a cell ends no section and holds no page or column
 * break. With `extensions` their types are read as themselves; a namespaced type they do not
 * declare becomes a foreign node or mark.
 */
export function parseContent(value: unknown, options: ContentOptions = {}): Node {
  const { path = "content", fragment = false } = options;
  const schema = options.schema ?? schemaWith(options.extensions);
  const doc = schema.nodeFromJSON(resolveCustom(value, schema), path);
  if (doc.type !== schema.topNodeType) fail(path, 'root node must be of type "doc"');
  if (doc.marks.length) fail(`${path}.marks`, "doc cannot have marks");
  wordRules(doc, path, false, fragment);
  return doc;
}

function wordRules(parent: Node, path: string, inCell: boolean, fragment = false): void {
  parent.forEach((node, _offset, index) => {
    const at = `${path}.content[${index}]`;
    if (node.type.name === "table") {
      const next = parent.maybeChild(index + 1);
      if (
        next?.type.name === "table" &&
        JSON.stringify(next.attrs.controls) === JSON.stringify(node.attrs.controls)
      ) {
        fail(at, "a table cannot follow a table (Word would merge them): a paragraph goes between");
      }
      if (!next && parent.type.name === "doc" && !fragment) {
        fail(at, "a table cannot end the document: a paragraph follows it, as in Word");
      }
      node.forEach((row, _r, r) => {
        row.forEach((cell, _c, c) => {
          wordRules(cell, `${at}.content[${r}].content[${c}]`, true);
        });
      });
    } else if (inCell && node.type.name === "paragraph") {
      if (node.attrs.section)
        fail(`${at}.attrs.section`, "a paragraph in a table cannot end a section");
      node.forEach((inline, _i, i) => {
        if (inline.type.name === "pageBreak" || inline.type.name === "columnBreak") {
          fail(`${at}.content[${i}]`, `a ${inline.type.name} cannot be in a table`);
        }
      });
    }
  });
}

/**
 * What a story may not hold (ADR-0007): import keeps such content opaque instead.
 * @internal
 */
export function storyRules(tree: Node, kind: StoryJSON["kind"], path: string): void {
  tree.descendants((node) => {
    const name = node.type.name;
    if (node.attrs.section) fail(path, "a story cannot end a section");
    if (name === "noteReference") fail(path, "a story cannot hold a note reference");
    if (COMMENT_NODES.has(name)) fail(path, `a ${kind} cannot hold comments`);
    if (
      (kind === "footnote" || kind === "endnote" || kind === "textBox") &&
      (name === "pageBreak" || name === "columnBreak")
    )
      fail(path, `a ${kind === "textBox" ? "text box" : "note"} cannot hold a ${name}`);
    // Word puts text boxes in the body, headers and footers only, never one in another.
    if (name === "textBox" && kind !== "header" && kind !== "footer")
      fail(path, `a ${kind === "textBox" ? "text box" : kind} cannot hold a text box`);
    return true;
  });
}

const COMMENT_NODES = new Set(["commentStart", "commentEnd", "commentReference"]);

const V4_NODES = new Set(["table", "tableRow", "tableCell", "picture"]);
const V5_NODES = new Set([
  "fieldStart",
  "fieldCode",
  "fieldSeparator",
  "fieldEnd",
  "controlStart",
  "controlEnd",
  "noteReference",
  "noteMark",
]);
const V5_KEYS = ["stories", "controls", "settings"];
const V5_SECTION_KEYS = ["columns", "pageNumbers", "footnotes", "endnotes"];

/** The first part of a section that schema 5 added, if any. */
function laterSection(section: unknown): string | undefined {
  return isRecord(section) ? V5_SECTION_KEYS.find((key) => Object.hasOwn(section, key)) : undefined;
}

const TABLE_NODES = new Set(["table", "tableRow", "tableCell"]);

/** Whether a style, the defaults or a list level says `suppressLineNumbers` (schema 9). */
function suppressesLineNumbers(doc: { styles?: unknown; defaults?: unknown; numbering?: unknown }) {
  return JSON.stringify([doc.styles, doc.defaults, doc.numbering]).includes(
    '"suppressLineNumbers":',
  );
}

/** The parts of a section that schema 9 added. */
const V9_SECTION_KEYS = ["pageBorders", "lineNumbers"];

/** Whether `section`, or the setup its tracked change recorded, has `key`. */
function inSection(section: unknown, key: string): boolean {
  if (!isRecord(section)) return false;
  if (Object.hasOwn(section, key)) return true;
  return isRecord(section.change) && inSection(section.change.previous, key);
}

/**
 * The first thing in validated content JSON that a schema after `version` added, if any: a node
 * type, a block's `controls`, a part of a section.
 */
function laterNode(
  content: NodeJSON | { content: NodeJSON[] },
  version: number,
): { name: string; schema: number } | undefined {
  const stack: unknown[] = [content];
  while (stack.length) {
    const node = stack.pop();
    if (!isRecord(node)) continue;
    const name = node.type as string;
    if (version < 4 && V4_NODES.has(name)) return { name, schema: 4 };
    if (version < 5 && V5_NODES.has(name)) return { name, schema: 5 };
    const attrs = isRecord(node.attrs) ? node.attrs : {};
    if (version < 5 && attrs.controls) return { name: "controls", schema: 5 };
    const part = version < 5 ? laterSection(attrs.section) : undefined;
    if (part) return { name: part, schema: 5 };
    if (version < 6 && name === "picture" && (attrs.rotation != null || attrs.crop != null))
      return { name: "a picture's rotation or crop", schema: 6 };
    if (version < 8 && TABLE_NODES.has(name) && attrs.formatChange != null)
      return { name: `a ${name} with a formatChange`, schema: 8 };
    const decorated =
      version < 9 ? V9_SECTION_KEYS.find((key) => inSection(attrs.section, key)) : undefined;
    if (decorated) return { name: `a section's ${decorated}`, schema: 9 };
    if (version < 10 && name === "textBox") return { name, schema: 10 };
    if (version < 10 && isRecord(attrs.float) && attrs.float.zOrder != null)
      return { name: `a ${name}'s zOrder`, schema: 10 };
    if (version < 9 && name === "opaqueInline" && attrs.watermark != null)
      return { name: "a watermark", schema: 9 };
    const previous = isRecord(attrs.formatChange) ? attrs.formatChange.previous : undefined;
    if (
      version < 9 &&
      (attrs.suppressLineNumbers != null ||
        (isRecord(previous) && previous.suppressLineNumbers != null))
    )
      return { name: "a paragraph's suppressLineNumbers", schema: 9 };
    if (Array.isArray(node.content)) for (const child of node.content) stack.push(child);
  }
  return undefined;
}

const ENVELOPE_KEYS = [
  "schemaVersion",
  "section",
  "defaults",
  "styles",
  "numbering",
  "theme",
  "comments",
  "resources",
  "stories",
  "controls",
  "settings",
  "content",
];

function fail(path: string, message: string): never {
  throw new FoliDocumentError(`${path}: ${message}`);
}

const COMMENT_ANCHORS = new Set(["commentStart", "commentEnd", "commentReference"]);

/**
 * Comments whose ids repeat (`1, 1, 2`: a damaged file, imported so by 1.4) each with an id of
 * its own, as copies: editing or resolving one by id would change another. The first keeps the
 * id; each later one gets one above every comment's and anchor's, and so do its anchors: the
 * n-th start and reference of that id, and the end that closes that start. A reply to a
 * repeated id stays the first's.
 */
function distinctComments(
  comments: CommentJSON[],
  content: unknown,
): { comments: CommentJSON[]; content: unknown } {
  const seen = new Set<number>();
  if (comments.every((c) => !seen.has(c.id) && seen.add(c.id))) return { comments, content };
  const copies = structuredClone(comments);
  const body = structuredClone(content);
  const trees = [body, ...copies.map((c) => c.content)];
  const anchors: { attrs: Record<string, unknown> }[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) for (const item of value) walk(item);
    else if (isRecord(value)) {
      if (COMMENT_ANCHORS.has(value.type as string) && isRecord(value.attrs))
        anchors.push(value as { attrs: Record<string, unknown> });
      walk(value.content);
    }
  };
  walk(trees);
  const idOf = (a: { attrs: Record<string, unknown> }) =>
    typeof a.attrs.id === "number" ? a.attrs.id : -1;
  let next = Math.max(-1, ...copies.map((c) => c.id), ...anchors.map(idOf)) + 1;
  const given = new Map<number, number[]>();
  for (const c of copies) {
    const ids = given.get(c.id);
    if (!ids) given.set(c.id, [c.id]);
    else {
      ids.push(next);
      c.id = next++;
    }
  }
  const counts = new Map<string, number>();
  const open = new Map<number, number[]>();
  for (const anchor of anchors) {
    const was = idOf(anchor);
    const ids = given.get(was);
    if (!ids || ids.length < 2) continue;
    const type = (anchor as { type?: string }).type;
    let id: number | undefined;
    if (type === "commentEnd") id = open.get(was)?.pop();
    else {
      const n = counts.get(`${type} ${was}`) ?? 0;
      counts.set(`${type} ${was}`, n + 1);
      id = ids[n];
      if (type === "commentStart" && id !== undefined)
        open.set(was, [...(open.get(was) ?? []), id]);
    }
    anchor.attrs = { ...anchor.attrs, id: id ?? was };
  }
  return { comments: copies, content: body };
}

function check(path: string, value: unknown, checker: Check): void {
  const error = checker(value);
  if (error) fail(path, error);
}

/**
 * Following `next` from any item ends (no item reaches itself). Linear: each item is walked
 * once. Ids that occur twice resolve to the first, as Word does.
 */
function noCycles<T>(
  path: string,
  items: readonly T[],
  id: (item: T) => unknown,
  next: (item: T) => unknown,
  message: (item: T) => string,
): void {
  const byId = new Map<unknown, number>();
  items.forEach((item, i) => {
    if (!byId.has(id(item))) byId.set(id(item), i);
  });
  const state = new Uint8Array(items.length); // 0 unseen, 1 on the current path, 2 ends
  items.forEach((_, start) => {
    const path_: number[] = [];
    let at: number | undefined = start;
    while (at !== undefined && state[at] === 0) {
      state[at] = 1;
      path_.push(at);
      const target = next(items[at] as T);
      at = target === undefined ? undefined : byId.get(target);
    }
    if (at !== undefined && state[at] === 1) fail(`${path}[${at}]`, message(items[at] as T));
    for (const i of path_) state[i] = 2;
  });
}

function blocks(content: NodeJSON[], path: string, schema: Schema): Node[] {
  const doc = parseContent({ type: "doc", content }, { path, schema });
  const list: Node[] = [];
  doc.forEach((block) => {
    list.push(block);
  });
  return list;
}

const checkCondition: Check = shape(
  {
    type: oneOf(TABLE_CONDITIONS.filter((c) => c !== "wholeTable")),
    paragraph: paragraphProperties,
    run: runProperties,
    table: checkTableProperties,
    row: checkRowProperties,
    cell: checkCellProperties,
    ext: xml,
  },
  ["type"],
);

const checkStyle: Check = shape(
  {
    id: text(),
    type: oneOf(["paragraph", "character", "table", "numbering"]),
    name: str(),
    basedOn: text(),
    next: text(),
    link: text(),
    isDefault: bool,
    paragraph: paragraphProperties,
    run: runProperties,
    table: checkTableProperties,
    row: checkRowProperties,
    cell: checkCellProperties,
    conditions: listOf(checkCondition, TABLE_CONDITIONS.length),
    ext: xml,
  },
  ["id", "type"],
);

const SAFE_PROTOCOLS = new Set(["http:", "https:", "blob:"]);

/** A URL's scheme as a browser resolves it (a relative URL is the base's, https). */
function protocolOf(url: string): string {
  try {
    return new URL(url, "https://base.invalid/").protocol;
  } catch {
    return "";
  }
}

/** Pictures only: `image/png`, `image/svg+xml`… */
const IMAGE_TYPE = /^image\/[A-Za-z0-9][\w.+-]{0,126}$/;

/** @internal */
export const checkResource: Check = (v) => {
  const error = shape(
    {
      contentType: (t) =>
        typeof t === "string" && IMAGE_TYPE.test(t) ? undefined : "must be an image media type",
      size: int(0, Number.MAX_SAFE_INTEGER),
      part: text(1024),
      // Relative, or http(s) or blob: no scheme that runs code (`javascript:`) where it is shown.
      // Read as browsers read it (leading spaces, controls and inner tabs dropped).
      url: (u) =>
        text(8192)(u) ??
        (SAFE_PROTOCOLS.has(protocolOf(u as string))
          ? undefined
          : "must be relative, http(s) or blob"),
      data: (d) =>
        typeof d === "string" && /^data:image\/[\w.+-]+[;,]/i.test(d) && d.length <= 67_108_864
          ? undefined
          : "must be a data: URL of an image",
    },
    ["contentType"],
  )(v);
  if (error) return error;
  const r = v as ResourceJSON;
  return r.part === undefined && r.url === undefined && r.data === undefined
    ? "needs part, url or data"
    : undefined;
};

/** An object keyed by ids, every value passing `check`. */
const recordOf =
  (check: Check, what: string): Check =>
  (v) => {
    if (!isRecord(v)) return "must be an object";
    const entries = Object.entries(v);
    if (entries.length > 100_000) return `must have at most 100000 ${what}s`;
    for (const [key, value] of entries) {
      // An own `__proto__` key would read as the prototype wherever a missing key is looked up.
      const keyError = key === "__proto__" ? `is not a ${what} key` : text()(key);
      if (keyError) return `${key.slice(0, 64)} ${keyError}`;
      const error = check(value);
      if (error) return `${key} ${error}`;
    }
    return undefined;
  };

const checkResources = recordOf(checkResource, "resource");

const NOTE_KINDS = ["footnote", "endnote"];
/** The tree is checked by `parseContent` afterwards, with its path. */
const checkStory: Check = (v) =>
  shape(
    {
      kind: oneOf(["header", "footer", ...NOTE_KINDS, "textBox"]),
      noteType: oneOf(["normal", "separator", "continuationSeparator", "continuationNotice"]),
      content: (c) => (isRecord(c) ? undefined : "must be an object"),
      ext: xml,
    },
    ["kind", "content"],
  )(v) ??
  (isRecord(v) && v.noteType !== undefined && !NOTE_KINDS.includes(v.kind as string)
    ? "noteType is for notes"
    : undefined);
const checkStories = recordOf(checkStory, "story");

/** A content control's properties. */
export const checkControl: Check = shape(
  {
    kind: oneOf([
      "text",
      "richText",
      "dropDown",
      "comboBox",
      "date",
      "checkbox",
      "picture",
      "repeating",
      "repeatingItem",
      "other",
    ]),
    tag: str(),
    alias: str(),
    lock: oneOf(["sdtLocked", "contentLocked", "sdtContentLocked", "unlocked"]),
    items: listOf(shape({ value: str(), display: str() }, ["value"])),
    dateFormat: str(),
    date: str(),
    checked: bool,
    checkedState: shape({ value: str(), font: str() }, ["value"]),
    uncheckedState: shape({ value: str(), font: str() }, ["value"]),
    multiLine: bool,
    format: runProperties,
    noInsertDelete: bool,
    deleted: bool,
    placeholder: shape({ showing: bool, docPart: str(), text: str(65_535) }, [], true),
    binding: shape(
      { xpath: str(65_535), storeItemId: str(), prefixMappings: str(65_535) },
      [],
      true,
    ),
    ext: xml,
  },
  ["kind"],
);
const checkControls = recordOf(checkControl, "control");

/** A theme color's tint or shade: two hex digits, as Word writes them. */
const hexByte: Check = (v) =>
  typeof v === "string" && /^[0-9A-Fa-f]{2}$/.test(v) ? undefined : "must be two hex digits";

const checkSettings: Check = shape(
  {
    doNotUseHTMLParagraphAutoSpacing: bool,
    evenAndOddHeaders: bool,
    footnotes: checkNoteProperties,
    endnotes: checkNoteProperties,
    trackRevisions: bool,
    background: shape({
      color,
      themeColor: token,
      themeTint: hexByte,
      themeShade: hexByte,
      ext: xml,
    }),
  },
  [],
  true,
);

const checkLevel: Check = shape(
  {
    level: int(0, 8),
    start: int(0, 2_147_483_647),
    format: token,
    text: str(),
    justification: oneOf(["left", "center", "right", "start", "end"]),
    restart: int(0, 9),
    legal: bool,
    suffix: oneOf(["tab", "space", "nothing"]),
    style: text(),
    paragraph: paragraphProperties,
    run: runProperties,
    ext: xml,
  },
  ["level"],
);

const checkAbstract: Check = shape(
  {
    id: int(0, 2_147_483_647),
    multiLevelType: oneOf(["singleLevel", "multilevel", "hybridMultilevel"]),
    levels: listOf(checkLevel, 9),
    styleLink: text(),
    numStyleLink: text(),
    ext: xml,
  },
  ["id", "levels"],
);

const checkInstance: Check = shape(
  {
    id: int(1, 2_147_483_647),
    abstract: int(0, 2_147_483_647),
    overrides: listOf(
      shape({ level: int(0, 8), start: int(0, 2_147_483_647), definition: checkLevel }, ["level"]),
      9,
    ),
    ext: xml,
  },
  ["id", "abstract"],
);

const font = shape({ latin: str(), eastAsia: str(), cs: str() }, ["latin"]);

const checkTheme: Check = shape(
  {
    fonts: shape({ major: font, minor: font }, ["major", "minor"]),
    colors: (v) => {
      if (!isRecord(v)) return "must be an object";
      for (const [key, value] of Object.entries(v)) {
        if (!/^(dk[12]|lt[12]|accent[1-6]|hlink|folHlink)$/.test(key))
          return `unknown color ${key}`;
        const error = color(value);
        if (error) return `${key} ${error}`;
      }
      return undefined;
    },
  },
  ["fonts", "colors"],
);

const checkComment: Check = shape(
  {
    id: int(0, 2_147_483_647),
    author: str(),
    initials: str(9),
    date: date,
    content: (v) => (Array.isArray(v) ? undefined : "must be an array of blocks"),
    parent: int(0, 2_147_483_647),
    done: bool,
    ext: xml,
  },
  ["id", "author", "content"],
);

const checkDefaults: Check = shape(
  { paragraph: paragraphProperties, run: runProperties, ext: xml },
  [],
  true,
);
const checkNumbering: Check = shape(
  { abstracts: listOf(checkAbstract), instances: listOf(checkInstance) },
  ["abstracts", "instances"],
);

/** How each envelope key is checked: whole, and (`entry`) one entry of it, by its path. */
const ENVELOPE_CHECKS: Record<
  string,
  { whole: Check; optional: boolean; entry?: (path: readonly string[]) => Check | undefined }
> = {
  section: { whole: checkSection, optional: false },
  defaults: { whole: checkDefaults, optional: false },
  theme: { whole: checkTheme, optional: true },
  styles: {
    whole: listOf(checkStyle),
    optional: false,
    entry: (path) => (path.length === 1 ? checkStyle : undefined),
  },
  numbering: {
    whole: checkNumbering,
    optional: false,
    entry: (path) =>
      path.length !== 2
        ? undefined
        : path[0] === "abstracts"
          ? checkAbstract
          : path[0] === "instances"
            ? checkInstance
            : undefined,
  },
  resources: {
    whole: checkResources,
    optional: true,
    entry: (path) => (path.length === 1 ? checkResource : undefined),
  },
  controls: {
    whole: checkControls,
    optional: true,
    entry: (path) => (path.length === 1 ? checkControl : undefined),
  },
  settings: {
    whole: checkSettings,
    optional: true,
    entry: (path) =>
      path.length === 1 ? (v) => checkSettings({ [path[0] as string]: v }) : undefined,
  },
};

/**
 * Why `value` cannot be the envelope's `key` (at `path` inside it: one style, one resource…), as
 * `parseDocument` checks it; undefined when it can. An entry may be undefined (removed).
 * @internal
 */
export function envelopeValueError(
  key: string,
  path: readonly string[],
  value: unknown,
): string | undefined {
  const checks = Object.hasOwn(ENVELOPE_CHECKS, key) ? ENVELOPE_CHECKS[key] : undefined;
  if (!checks) return `unknown envelope key ${JSON.stringify(key)}`;
  const check = path.length ? checks.entry?.(path) : checks.whole;
  if (!check) return `no entry ${JSON.stringify(path)} in ${key}`;
  if (value === undefined) return path.length || checks.optional ? undefined : "is required";
  return check(value);
}

/**
 * A story's JSON (`StoryJSON`) as `parseDocument` reads it: its tree, checked by its kind's rules.
 * @internal
 */
export function parseStory(value: unknown, schema: Schema, path: string): Node {
  check(path, value, checkStory);
  const tree = parseContent((value as StoryJSON).content, { path: `${path}.content`, schema });
  storyRules(tree, (value as StoryJSON).kind, `${path}.content`);
  return tree;
}

/**
 * A comment's JSON (`CommentJSON`) as `parseDocument` reads it; throws `FoliDocumentError`.
 * @internal
 */
export function checkCommentJSON(value: unknown, schema: Schema, path: string): void {
  check(path, value, checkComment);
  for (const block of blocks((value as CommentJSON).content, `${path}.content`, schema))
    block.descendants((node) => {
      if (node.type.name === "noteReference")
        fail(`${path}.content`, "a comment cannot hold a note reference");
      return true;
    });
}

// ---------- schema 8 → 9: what `ext` already held (Phase 32) ----------

/** An element's attributes in kept XML, by local name (`w:countBy` → `countBy`). */
function xmlAttributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of source.matchAll(/(?:[\w.-]+:)?([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    out[match[1] as string] = (match[2] ?? match[3] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  return out;
}

const whole = (value: string | undefined) =>
  value !== undefined && /^-?\d+$/.test(value) ? Number(value) : undefined;
const compactJson = (object: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));

/** Kept XML without its tracked change (`w:pPrChange`…): that says what was, not what is. */
const withoutChange = (ext: string, local: "pPrChange" | "sectPrChange" | "rPrChange") =>
  ext.replace(
    local === "pPrChange"
      ? /<(?:[\w.-]+:)?pPrChange\b[\s\S]*?<\/(?:[\w.-]+:)?pPrChange>/g
      : local === "rPrChange"
        ? /<(?:[\w.-]+:)?rPrChange\b[\s\S]*?<\/(?:[\w.-]+:)?rPrChange>/g
        : /<(?:[\w.-]+:)?sectPrChange\b[\s\S]*?<\/(?:[\w.-]+:)?sectPrChange>/g,
    "",
  );

/** `w:suppressLineNumbers` a kept `w:pPr` says, when `properties` (its owner) does not. */
function adoptParagraphProperties(properties: unknown): void {
  if (!isRecord(properties) || properties.suppressLineNumbers != null) return;
  const ext = withoutChange(typeof properties.ext === "string" ? properties.ext : "", "pPrChange");
  const suppress = /<(?:[\w.-]+:)?suppressLineNumbers\b([^>]*?)\/>/.exec(ext);
  if (suppress)
    properties.suppressLineNumbers = !["0", "false", "off"].includes(
      xmlAttributes(suppress[1] ?? "").val ?? "",
    );
}

/** Page borders and line numbers a section's kept `w:sectPr` says, when its parts do not. */
function adoptSection(section: unknown): void {
  if (!isRecord(section)) return;
  if (isRecord(section.change)) adoptSection(section.change.previous);
  const ext = withoutChange(typeof section.ext === "string" ? section.ext : "", "sectPrChange");
  if (!ext) return;
  const numbers = /<(?:[\w.-]+:)?lnNumType\b([^>]*?)\/?>/.exec(ext);
  if (numbers && section.lineNumbers === undefined) {
    const a = xmlAttributes(numbers[1] ?? "");
    const lineNumbers = compactJson({
      countBy: whole(a.countBy),
      start: whole(a.start),
      distance: whole(a.distance),
      restart: a.restart,
    });
    if (lineNumbers.countBy !== undefined && !checkSection({ lineNumbers }))
      section.lineNumbers = lineNumbers;
  }
  const borders =
    /<(?:[\w.-]+:)?pgBorders\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?pgBorders>)/.exec(ext);
  if (borders && section.pageBorders === undefined) {
    const a = xmlAttributes(borders[1] ?? "");
    const sides: Record<string, unknown> = {};
    for (const side of (borders[2] ?? "").matchAll(
      /<(?:[\w.-]+:)?(top|left|bottom|right)\b([^>]*?)\/?>/g,
    )) {
      const s = xmlAttributes(side[2] ?? "");
      sides[side[1] as string] = compactJson({
        style: s.val,
        size: whole(s.sz),
        space: whole(s.space),
        color: s.color,
        themeColor: s.themeColor,
      });
    }
    const pageBorders = compactJson({
      ...sides,
      offsetFrom: a.offsetFrom,
      display: a.display,
      zOrder: a.zOrder,
    });
    if (Object.keys(pageBorders).length && !checkSection({ pageBorders }))
      section.pageBorders = pageBorders;
  }
}

/**
 * A document of schema 8 or earlier with what schema 9 models read from the XML it kept: a
 * section's `w:pgBorders` and `w:lnNumType`, a paragraph's `w:suppressLineNumbers`. Saved by an
 * earlier release, they were kept verbatim in `ext`; adopted, export writes them back as they
 * were instead of reading their absence as removed. (A page color was never in an earlier
 * document: `settings.background` left out keeps the file's.)
 */
function adoptKeptDecoration(doc: FoliDocument): void {
  adoptSection(doc.section);
  const visit = (node: unknown) => {
    if (!isRecord(node)) return;
    const attrs = isRecord(node.attrs) ? node.attrs : undefined;
    if (attrs) {
      adoptSection(attrs.section);
      if (node.type === "paragraph") adoptParagraphProperties(attrs);
    }
    if (Array.isArray(node.content)) for (const child of node.content) visit(child);
  };
  visit(doc.content);
  for (const comment of doc.comments) for (const block of comment.content) visit(block);
  for (const story of Object.values(doc.stories ?? {})) visit(story.content);
  // Styles, the defaults and list levels keep their element (`w:style`, `w:docDefaults`,
  // `w:lvl`) whole in their own `ext`: its `w:pPr` is theirs.
  const owners: { paragraph?: ParagraphPropertiesJSON; ext?: string }[] = [
    ...doc.styles,
    doc.defaults,
    ...doc.numbering.abstracts.flatMap((a) => a.levels),
    ...doc.numbering.instances.flatMap((i) =>
      (i.overrides ?? []).flatMap((o) => (o.definition ? [o.definition] : [])),
    ),
  ];
  for (const owner of owners) {
    if (owner.paragraph?.suppressLineNumbers != null || !owner.ext) continue;
    const pPr = /<(?:[\w.-]+:)?pPr\b[\s\S]*?<\/(?:[\w.-]+:)?pPr>/.exec(
      withoutChange(withoutChange(owner.ext, "pPrChange"), "rPrChange"),
    )?.[0];
    const properties: Record<string, unknown> = { ext: pPr ?? "" };
    adoptParagraphProperties(properties);
    if (typeof properties.suppressLineNumbers === "boolean")
      owner.paragraph = { ...owner.paragraph, suppressLineNumbers: properties.suppressLineNumbers };
  }
  doc.schemaVersion = schemaVersionOf(doc);
}
