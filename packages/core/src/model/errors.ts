/** Invalid document content: unknown types, bad attributes, content that breaks the schema. */
export class FoliDocumentError extends Error {
  override name = "FoliDocumentError";
}

/** A replace that would produce content the schema does not allow. */
export class ReplaceError extends Error {
  override name = "ReplaceError";
}

/** Throws a FoliDocumentError whose message starts with a JSON path. */
export function fail(path: string, message: string): never {
  throw new FoliDocumentError(`${path}: ${message}`);
}
