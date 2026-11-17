import { DEFAULT_SETTINGS, parseDocumentV2 } from "../document.js";
import { FoliDocumentError, type MarkJSON, type Node, type NodeJSON } from "../model/index.js";
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
import { migrateToV3 } from "./migrate.js";
import {
  checkCellProperties,
  checkRowProperties,
  checkSection,
  checkTableProperties,
  checkParagraphProperties as paragraphProperties,
  checkRunProperties as runProperties,
  schema,
} from "./schema.js";

/** The schema version of documents in the Word model (ADR-0005; v4 adds tables and pictures, ADR-0006). */
export const SCHEMA_VERSION = 4;

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
  /** The `w:sectPr` this was read from, verbatim. */
  ext?: string;
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

/** A document in the Word model: the content tree and what Word keeps beside it. */
export interface FoliDocument {
  schemaVersion: typeof SCHEMA_VERSION;
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
  content: NodeJSON;
}

/** A document of schema v3 (no tables or pictures in the model), as `migrateToV3` gives it. */
export type FoliDocumentV3 = Omit<FoliDocument, "schemaVersion" | "resources"> & {
  schemaVersion: 3;
};

/** Schema v3 → v4: the version only (a table kept opaque stays so until imported again). */
export function migrateToV4(doc: FoliDocumentV3): FoliDocument {
  return { ...doc, schemaVersion: SCHEMA_VERSION };
}

/**
 * A new document: `content` (schema v4; default: one empty paragraph) on A4 with 25.4 mm
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
  const blank = migrateToV4(
    migrateToV3({ schemaVersion: 2, settings: DEFAULT_SETTINGS, content: empty as never }),
  );
  const base = blank.section;
  return {
    ...blank,
    // The default (A4) section has only pageSize and margins: each merged part by part.
    section: {
      ...section,
      pageSize: { ...base.pageSize, ...section?.pageSize },
      margins: { ...base.margins, ...section?.margins },
    },
    content,
  };
}

/**
 * Validates untrusted input against schema v3. Returns a copy that shares nothing with the
 * input, with the content and the comments' content in canonical form. Documents of schema 1
 * and 2 are validated as such and migrated (`migrateToV3`). Throws FoliDocumentError instead
 * of dropping anything.
 *
 * What Word opens is accepted: duplicate ids (the first wins), a numbering instance or a reply
 * whose target is missing, references to styles that do not exist. Rejected is only what the
 * engine cannot work with: wrong types, out-of-range values, and cycles (a style based on
 * itself, comments replying to each other) that would never end when followed.
 */
export function parseDocument(input: unknown): FoliDocument {
  if (!isRecord(input)) throw new FoliDocumentError("Document must be an object");
  const version = input.schemaVersion;
  if (version === 1 || version === 2) {
    return parseDocument(migrateToV4(migrateToV3(parseDocumentV2(input))));
  }
  if (version === 3) {
    if (Object.hasOwn(input, "resources")) fail("resources", "unknown key (schema 4 and later)");
    const doc = parseDocument({ ...input, schemaVersion: SCHEMA_VERSION });
    // Tables and pictures are schema 4's: a schema 3 document holding one is not one.
    for (const [path, content] of [
      ["content", doc.content],
      ...doc.comments.map((c, i) => [`comments[${i}].content`, { content: c.content }] as const),
    ] as const) {
      const found = nodeOfV4(content);
      if (found) fail(path, `${found} is a schema 4 node (the document says schema 3)`);
    }
    doc.styles.forEach((style, i) => {
      for (const key of ["table", "row", "cell", "conditions"]) {
        if (Object.hasOwn(style, key))
          fail(`styles[${i}]`, `unknown key ${key} (schema 4 and later)`);
      }
    });
    return doc;
  }
  if (version !== SCHEMA_VERSION) {
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
  const styles = input.styles as StyleJSON[];
  const comments = input.comments as CommentJSON[];
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

  const content = parseContent(input.content);
  // A copy: the validated document must not change when the caller's input does.
  const envelope = structuredClone({
    section: input.section,
    defaults: input.defaults,
    styles,
    numbering: input.numbering,
    theme: input.theme,
    resources: input.resources,
  }) as Pick<FoliDocument, "section" | "defaults" | "styles" | "numbering" | "theme" | "resources">;
  return {
    schemaVersion: SCHEMA_VERSION,
    section: envelope.section,
    defaults: envelope.defaults,
    styles: envelope.styles,
    numbering: envelope.numbering,
    ...(envelope.theme === undefined ? {} : { theme: envelope.theme }),
    comments: comments.map((c, i) => ({
      ...structuredClone({ ...c, content: [] }),
      content: blocks(c.content, `comments[${i}].content`).map((block) => block.toJSON()),
    })),
    ...(envelope.resources === undefined ? {} : { resources: envelope.resources }),
    content: content.toJSON(),
  };
}

/**
 * Parses untrusted schema v4 content into a `doc` node, with Word's rules the content
 * expressions do not say (`fragment`: content to paste, which a table may end): a table is never
 * followed by a table (Word would merge them) nor ends
 * the document, and a paragraph in a cell ends no section and holds no page or column break.
 */
export function parseContent(value: unknown, path = "content", fragment = false): Node {
  const doc = schema.nodeFromJSON(value, path);
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
      if (next?.type.name === "table") {
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

const V4_NODES = new Set(["table", "tableRow", "tableCell", "picture"]);

/** The first schema 4 node type in validated content JSON, if any. */
function nodeOfV4(content: NodeJSON | { content: NodeJSON[] }): string | undefined {
  const stack: unknown[] = [content];
  while (stack.length) {
    const node = stack.pop();
    if (!isRecord(node)) continue;
    if (V4_NODES.has(node.type as string)) return node.type as string;
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
  "content",
];

function fail(path: string, message: string): never {
  throw new FoliDocumentError(`${path}: ${message}`);
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

function blocks(content: NodeJSON[], path: string): Node[] {
  const doc = parseContent({ type: "doc", content }, path);
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

const checkResources: Check = (v) => {
  if (!isRecord(v)) return "must be an object";
  const entries = Object.entries(v);
  if (entries.length > 100_000) return "must have at most 100000 resources";
  for (const [key, value] of entries) {
    // An own `__proto__` key would read as the prototype wherever a missing key is looked up.
    const keyError = key === "__proto__" ? "is not a resource key" : text()(key);
    if (keyError) return `${key.slice(0, 64)} ${keyError}`;
    const error = checkResource(value);
    if (error) return `${key} ${error}`;
  }
  return undefined;
};

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
