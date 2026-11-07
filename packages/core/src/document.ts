import { FoliDocumentError, type Node } from "./model/index.js";
import { type DocJSON, schema } from "./schema.js";

/**
 * Bump when the persisted envelope or content schema changes; add a migration from the previous
 * version to MIGRATIONS. A published version never changes in place: documents saved with it
 * exist (v1: 0.1.0).
 */
export const SCHEMA_VERSION = 2;

type Envelope = Record<string, unknown>;

/**
 * `MIGRATIONS[n]` turns a version-n envelope into version n + 1; `parseDocument` runs them in
 * order, then validates against the current schema. Migrations never drop content.
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

/** The persisted document: a versioned envelope around the content tree. */
export interface FoliDocument {
  schemaVersion: typeof SCHEMA_VERSION;
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

export function createDocument(
  content: DocJSON = { type: "doc", content: [{ type: "paragraph" }] },
  settings: Partial<DocumentSettings> = {},
): FoliDocument {
  return { schemaVersion: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS, ...settings }, content };
}

/**
 * Validates untrusted input (e.g. JSON loaded from storage) against the schema and returns a
 * FoliDocument with content in canonical form (see docs/document-model.md, "Normalization").
 * Throws FoliDocumentError instead of silently dropping invalid content.
 */
export function parseDocument(input: unknown): FoliDocument {
  if (!isRecord(input)) throw new FoliDocumentError("Document must be an object");
  const version = input.schemaVersion;
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new FoliDocumentError(`Unsupported schemaVersion: ${String(version)}`);
  }
  if ((version as number) > SCHEMA_VERSION) {
    throw new FoliDocumentError(
      `Unsupported schemaVersion: ${version} (this version of @folijs/core reads 1 to ` +
        `${SCHEMA_VERSION}; the document was saved by a newer one)`,
    );
  }
  let doc: Envelope = input;
  for (let v = version as number; v < SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new FoliDocumentError(`No migration from schemaVersion ${v}`);
    doc = migrate(doc);
  }
  const settings = parseSettings(doc.settings);
  const content = parseContent(doc.content).toJSON() as DocJSON;
  return { schemaVersion: SCHEMA_VERSION, settings, content };
}

/** Parses untrusted content JSON into a `doc` node of the current schema (v2). */
export function parseContent(value: unknown, path = "content"): Node {
  const doc = schema.nodeFromJSON(value, path);
  if (doc.type !== schema.topNodeType) {
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
