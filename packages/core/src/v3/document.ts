import { parseDocument } from "../document.js";
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
  checkSection,
  checkParagraphProperties as paragraphProperties,
  checkRunProperties as runProperties,
  schemaV3,
} from "./schema.js";

/** The schema version of documents in the Word model (ADR-0005). */
export const SCHEMA_VERSION_V3 = 3;

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

export interface StyleJSON {
  /** `w:styleId`, what paragraphs and runs reference. With duplicates, the first wins, as in Word. */
  id: string;
  type: "paragraph" | "character" | "table" | "numbering";
  name?: string;
  basedOn?: string;
  next?: string;
  link?: string;
  /** The default style of its type (Normal, Default Paragraph Font…). */
  isDefault?: boolean;
  paragraph?: ParagraphPropertiesJSON;
  run?: MarkJSON[];
  /** The `w:style` this was read from, verbatim (table properties, UI priority…). */
  ext?: string;
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
export interface FoliDocumentV3 {
  schemaVersion: typeof SCHEMA_VERSION_V3;
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
  content: NodeJSON;
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
export function parseDocumentV3(input: unknown): FoliDocumentV3 {
  if (!isRecord(input)) throw new FoliDocumentError("Document must be an object");
  const version = input.schemaVersion;
  if (version === 1 || version === 2) return parseDocumentV3(migrateToV3(parseDocument(input)));
  if (version !== SCHEMA_VERSION_V3) {
    throw new FoliDocumentError(`Unsupported schemaVersion: ${String(version)} (expected 1 to 3)`);
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

  const content = parseContentV3(input.content);
  // A copy: the validated document must not change when the caller's input does.
  const envelope = structuredClone({
    section: input.section,
    defaults: input.defaults,
    styles,
    numbering: input.numbering,
    theme: input.theme,
  }) as Pick<FoliDocumentV3, "section" | "defaults" | "styles" | "numbering" | "theme">;
  return {
    schemaVersion: SCHEMA_VERSION_V3,
    section: envelope.section,
    defaults: envelope.defaults,
    styles: envelope.styles,
    numbering: envelope.numbering,
    ...(envelope.theme === undefined ? {} : { theme: envelope.theme }),
    comments: comments.map((c, i) => ({
      ...structuredClone({ ...c, content: [] }),
      content: blocks(c.content, `comments[${i}].content`).map((block) => block.toJSON()),
    })),
    content: content.toJSON(),
  };
}

/** Parses untrusted schema v3 content into a `doc` node. */
export function parseContentV3(value: unknown, path = "content"): Node {
  const doc = schemaV3.nodeFromJSON(value, path);
  if (doc.type !== schemaV3.topNodeType) fail(path, 'root node must be of type "doc"');
  if (doc.marks.length) fail(`${path}.marks`, "doc cannot have marks");
  return doc;
}

const ENVELOPE_KEYS = [
  "schemaVersion",
  "section",
  "defaults",
  "styles",
  "numbering",
  "theme",
  "comments",
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
  const doc = parseContentV3({ type: "doc", content }, path);
  const list: Node[] = [];
  doc.forEach((block) => {
    list.push(block);
  });
  return list;
}

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
    ext: xml,
  },
  ["id", "type"],
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
