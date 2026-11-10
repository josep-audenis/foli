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
  text,
  token,
  xml,
} from "./check.js";
import { migrateToV3 } from "./migrate.js";
import {
  checkSection,
  checkMarks as marks,
  checkParagraphProperties as paragraphProperties,
  schemaV3,
} from "./schema.js";

/** The schema version of documents in the Word model (ADR-0005). */
export const SCHEMA_VERSION_V3 = 3;

/** Page setup of a section, in twips (1/1440 inch). */
export interface SectionJSON {
  pageSize: { width: number; height: number; orientation?: "portrait" | "landscape" };
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    header?: number;
    footer?: number;
    gutter?: number;
  };
  type?: "nextPage" | "continuous" | "evenPage" | "oddPage" | "nextColumn";
  titlePage?: boolean;
  /** Relationship ids of the header and footer parts (their content stays in the package until Phase 11). */
  headers?: { default?: string; first?: string; even?: string };
  footers?: { default?: string; first?: string; even?: string };
  ext?: string;
}

/** Paragraph properties as a style, a numbering level or the defaults give them: paragraph attributes. */
export type ParagraphPropertiesJSON = Record<string, unknown>;

export interface StyleJSON {
  /** `w:styleId`, what paragraphs and runs reference. */
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
  /** Unknown children of `w:style` (table properties, UI priority…), verbatim. */
  ext?: string;
}

export interface NumberingLevelJSON {
  level: number;
  start?: number;
  /** `w:numFmt`: decimal, bullet, lowerLetter, upperRoman, none… */
  format: string;
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
  /** The comment this one replies to. */
  parent?: number;
  /** Resolved. */
  done?: boolean;
  ext?: string;
}

/** A document in the Word model: the content tree and what Word keeps beside it. */
export interface FoliDocumentV3 {
  schemaVersion: typeof SCHEMA_VERSION_V3;
  /** The last section's page setup (`w:body/w:sectPr`); earlier sections end at paragraphs. */
  section: SectionJSON;
  /** Document defaults (`w:docDefaults`). */
  defaults: { paragraph?: ParagraphPropertiesJSON; run?: MarkJSON[] };
  styles: StyleJSON[];
  numbering: { abstracts: AbstractNumberingJSON[]; instances: NumberingInstanceJSON[] };
  theme?: ThemeJSON;
  comments: CommentJSON[];
  content: NodeJSON;
}

/**
 * Validates untrusted input against schema v3 and returns it in canonical form. Documents of
 * schema 1 and 2 are validated as such and migrated (`migrateToV3`). Throws FoliDocumentError
 * instead of dropping anything.
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
  check("defaults", input.defaults, shape({ paragraph: paragraphProperties, run: marks }), true);
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
  const numbering = input.numbering as FoliDocumentV3["numbering"];
  const comments = input.comments as CommentJSON[];
  checkStyleGraph(styles);
  unique(
    "numbering.abstracts",
    numbering.abstracts.map((a) => a.id),
  );
  unique(
    "numbering.instances",
    numbering.instances.map((n) => n.id),
  );
  const abstracts = new Set(numbering.abstracts.map((a) => a.id));
  numbering.instances.forEach((n, i) => {
    if (!abstracts.has(n.abstract))
      fail(`numbering.instances[${i}].abstract`, `no abstract numbering ${n.abstract}`);
  });
  unique(
    "comments",
    comments.map((c) => c.id),
  );
  const ids = new Set(comments.map((c) => c.id));
  comments.forEach((c, i) => {
    if (c.parent !== undefined && (!ids.has(c.parent) || c.parent === c.id)) {
      fail(`comments[${i}].parent`, `no other comment ${c.parent}`);
    }
  });

  const content = parseContentV3(input.content);
  return {
    schemaVersion: SCHEMA_VERSION_V3,
    section: input.section as SectionJSON,
    defaults: input.defaults as FoliDocumentV3["defaults"],
    styles,
    numbering,
    ...(input.theme === undefined ? {} : { theme: input.theme as ThemeJSON }),
    comments: comments.map((c, i) => ({
      ...c,
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

function check(path: string, value: unknown, checker: Check, emptyAllowed = false): void {
  if (emptyAllowed && isRecord(value) && Object.keys(value).length === 0) return;
  const error = checker(value);
  if (error) fail(path, error);
}

function unique(path: string, ids: readonly unknown[]): void {
  const seen = new Set<unknown>();
  ids.forEach((id, i) => {
    if (seen.has(id)) fail(`${path}[${i}].id`, `duplicate id ${String(id)}`);
    seen.add(id);
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
    name: text(),
    basedOn: text(),
    next: text(),
    link: text(),
    isDefault: bool,
    paragraph: paragraphProperties,
    run: marks,
    ext: xml,
  },
  ["id", "type"],
);

/** Unique style ids, and no style based on itself through its chain (resolution would not end). */
function checkStyleGraph(styles: readonly StyleJSON[]): void {
  unique(
    "styles",
    styles.map((s) => s.id),
  );
  const byId = new Map(styles.map((s) => [s.id, s]));
  styles.forEach((style, i) => {
    const seen = new Set<string>([style.id]);
    for (let next = style.basedOn; next !== undefined; next = byId.get(next)?.basedOn) {
      if (seen.has(next)) fail(`styles[${i}].basedOn`, `${style.id} is based on itself`);
      seen.add(next);
    }
  });
}

const checkLevel: Check = shape(
  {
    level: int(0, 8),
    start: int(0, 2_147_483_647),
    format: token,
    text: (v) => (typeof v === "string" && v.length <= 255 ? undefined : "must be a string"),
    justification: oneOf(["left", "center", "right", "start", "end"]),
    restart: int(0, 9),
    legal: bool,
    suffix: oneOf(["tab", "space", "nothing"]),
    style: text(),
    paragraph: paragraphProperties,
    run: marks,
    ext: xml,
  },
  ["level", "format"],
);

const checkAbstract: Check = (v) => {
  const error = shape(
    {
      id: int(0, 2_147_483_647),
      multiLevelType: oneOf(["singleLevel", "multilevel", "hybridMultilevel"]),
      levels: listOf(checkLevel, 9),
      styleLink: text(),
      numStyleLink: text(),
      ext: xml,
    },
    ["id", "levels"],
  )(v);
  if (error) return error;
  return distinctLevels((v as AbstractNumberingJSON).levels.map((l) => l.level));
};

const checkInstance: Check = (v) => {
  const error = shape(
    {
      id: int(1, 2_147_483_647),
      abstract: int(0, 2_147_483_647),
      overrides: listOf(
        shape({ level: int(0, 8), start: int(0, 2_147_483_647), definition: checkLevel }, [
          "level",
        ]),
        9,
      ),
      ext: xml,
    },
    ["id", "abstract"],
  )(v);
  if (error) return error;
  return distinctLevels(((v as NumberingInstanceJSON).overrides ?? []).map((o) => o.level));
};

function distinctLevels(levels: readonly number[]): string | undefined {
  return new Set(levels).size === levels.length ? undefined : "levels must be distinct";
}

const font = shape(
  {
    latin: (v) => (typeof v === "string" ? undefined : "must be a string"),
    eastAsia: (v) => (typeof v === "string" ? undefined : "must be a string"),
    cs: (v) => (typeof v === "string" ? undefined : "must be a string"),
  },
  ["latin"],
);

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
    author: text(),
    initials: text(9),
    date: date,
    content: (v) => (Array.isArray(v) ? undefined : "must be an array of blocks"),
    parent: int(0, 2_147_483_647),
    done: bool,
    ext: xml,
  },
  ["id", "author", "content"],
);
