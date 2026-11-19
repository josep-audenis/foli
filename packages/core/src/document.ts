import { FoliDocumentError, type Node } from "./model/index.js";
import { type DocJSON, schemaV2 } from "./schema.js";

/**
 * Schema v2 (0.2.0) and v1 (0.1.0): kept to read documents saved with them, which
 * `parseDocument` migrates to the current schema (v3). A published version never changes in
 * place: documents saved with it exist.
 */
const VERSION = 2;

type Envelope = Record<string, unknown>;

/**
 * `MIGRATIONS[n]` turns a version-n envelope into version n + 1; `parseDocumentV2` runs them in
 * order, then validates against schema v2. Migrations never drop content.
 */
const MIGRATIONS: Readonly<Record<number, (doc: Envelope) => Envelope>> = {
  // v2 adds lists, horizontal rules, links, text color, highlight and alignment. Every v1
  // document is a valid v2 document: only the version changes.
  1: (doc) => ({ ...doc, schemaVersion: 2 }),
};

/** All page geometry is in millimetres. See docs/document-model.md for unit conversions. */
export interface PageSize {
  width: number;
  height: number;
}

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DocumentSettings {
  pageSize: PageSize;
  margins: PageMargins;
}

/** A document saved by 0.2.0 (schema v2): what `parseDocument` reads and migrates. */
export interface FoliDocumentV2 {
  schemaVersion: 2;
  settings: DocumentSettings;
  content: DocJSON;
}

export const PAGE_SIZES = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
} as const satisfies Record<string, PageSize>;

export const DEFAULT_SETTINGS: DocumentSettings = {
  pageSize: PAGE_SIZES.A4,
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
};

/**
 * A schema v2 document, for tests of migration and of editing migrated documents.
 * @internal
 */
export function createDocumentV2(
  content: DocJSON = { type: "doc", content: [{ type: "paragraph" }] },
  settings: Partial<DocumentSettings> = {},
): FoliDocumentV2 {
  return { schemaVersion: VERSION, settings: { ...DEFAULT_SETTINGS, ...settings }, content };
}

/**
 * Validates a schema v1 or v2 document against schema v2 and returns it as v2, content in
 * canonical form. Throws FoliDocumentError instead of silently dropping invalid content.
 * @internal
 */
export function parseDocumentV2(input: unknown): FoliDocumentV2 {
  if (!isRecord(input)) throw new FoliDocumentError("Document must be an object");
  const version = input.schemaVersion;
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new FoliDocumentError(`Unsupported schemaVersion: ${String(version)}`);
  }
  if ((version as number) > VERSION) {
    throw new FoliDocumentError(
      `Unsupported schemaVersion: ${version} (this version of @folijs/core reads 1 to ` +
        `${VERSION}; the document was saved by a newer one)`,
    );
  }
  let doc: Envelope = input;
  for (let v = version as number; v < VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new FoliDocumentError(`No migration from schemaVersion ${v}`);
    doc = migrate(doc);
  }
  const settings = parseSettings(doc.settings);
  const content = parseContentV2(doc.content).toJSON() as DocJSON;
  return { schemaVersion: VERSION, settings, content };
}

/** Parses untrusted content JSON into a `doc` node of schema v2. */
export function parseContentV2(value: unknown, path = "content"): Node {
  const doc = schemaV2.nodeFromJSON(value, path);
  if (doc.type !== schemaV2.topNodeType) {
    throw new FoliDocumentError(`${path}: root node must be of type "doc"`);
  }
  // The root has no parent to check its marks against.
  if (doc.marks.length) throw new FoliDocumentError(`${path}.marks: doc cannot have marks`);
  return doc;
}

function parseSettings(input: unknown): DocumentSettings {
  if (!isRecord(input) || !isRecord(input.pageSize) || !isRecord(input.margins)) {
    throw new FoliDocumentError("settings.pageSize and settings.margins are required");
  }
  const { width, height } = input.pageSize;
  const { top, right, bottom, left } = input.margins;
  if (!isPositive(width) || !isPositive(height)) {
    throw new FoliDocumentError("pageSize width/height must be positive numbers (mm)");
  }
  if (![top, right, bottom, left].every(isNonNegative)) {
    throw new FoliDocumentError("margins must be non-negative numbers (mm)");
  }
  const margins = { top, right, bottom, left } as PageMargins;
  if (margins.left + margins.right >= width || margins.top + margins.bottom >= height) {
    throw new FoliDocumentError("margins leave no content area on the page");
  }
  return { pageSize: { width, height }, margins };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
