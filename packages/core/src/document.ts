import { type DocJSON, FoliDocumentError, validateContent } from "./schema.js";

/**
 * Bump when the persisted envelope or content schema changes incompatibly; add a migration.
 * Nothing is published yet, so v1 may still change until the first release.
 */
export const SCHEMA_VERSION = 1;

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
 * Validates untrusted input (e.g. JSON loaded from storage) and returns a FoliDocument.
 * Throws FoliDocumentError instead of silently dropping invalid content.
 */
export function parseDocument(input: unknown): FoliDocument {
  if (!isRecord(input)) throw new FoliDocumentError("Document must be an object");
  if (input.schemaVersion !== SCHEMA_VERSION) {
    throw new FoliDocumentError(`Unsupported schemaVersion: ${String(input.schemaVersion)}`);
  }
  const settings = parseSettings(input.settings);
  const content = validateContent(input.content);
  return { schemaVersion: SCHEMA_VERSION, settings, content };
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
