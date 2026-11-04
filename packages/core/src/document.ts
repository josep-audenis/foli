import { type AnyExtension, getSchema, type JSONContent } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { createExtensions } from "./extensions.js";

/** Bump when the persisted envelope or content schema changes incompatibly; add a migration. */
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

/** The persisted document: a versioned envelope around ProseMirror-compatible JSON. */
export interface FoliDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  settings: DocumentSettings;
  content: JSONContent;
}

export const PAGE_SIZES = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
} as const satisfies Record<string, PageSize>;

export const DEFAULT_SETTINGS: DocumentSettings = {
  pageSize: PAGE_SIZES.A4,
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
};

export class FoliDocumentError extends Error {
  override name = "FoliDocumentError";
}

export function createDocument(
  content: JSONContent = { type: "doc", content: [{ type: "paragraph" }] },
  settings: Partial<DocumentSettings> = {},
): FoliDocument {
  return { schemaVersion: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS, ...settings }, content };
}

/**
 * Validates untrusted input (e.g. JSON loaded from storage) and returns a FoliDocument.
 * Throws FoliDocumentError instead of silently dropping invalid content.
 */
export function parseDocument(
  input: unknown,
  extensions: AnyExtension[] = createExtensions(),
): FoliDocument {
  if (!isRecord(input)) throw new FoliDocumentError("Document must be an object");
  if (input.schemaVersion !== SCHEMA_VERSION) {
    throw new FoliDocumentError(`Unsupported schemaVersion: ${String(input.schemaVersion)}`);
  }
  const settings = parseSettings(input.settings);
  if (!isRecord(input.content) || input.content.type !== "doc") {
    throw new FoliDocumentError('content must be a ProseMirror JSON node of type "doc"');
  }
  try {
    Node.fromJSON(getSchema(extensions), input.content).check();
  } catch (cause) {
    throw new FoliDocumentError("content does not match the editor schema", { cause });
  }
  return { schemaVersion: SCHEMA_VERSION, settings, content: input.content as JSONContent };
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
