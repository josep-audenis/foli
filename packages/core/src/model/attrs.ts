import { fail } from "./errors.js";

export type Attrs = Readonly<Record<string, unknown>>;

export interface AttributeSpec {
  /** Used when the attribute is missing. Without a default the attribute is required. */
  default?: unknown;
  /** Returns an error message for an invalid value, or undefined when it is valid. */
  validate?: (value: unknown) => string | undefined;
}

export type AttributeSpecs = Readonly<Record<string, AttributeSpec>>;

export const NO_ATTRS: Attrs = Object.freeze({});

/** Fills defaults and validates. Unknown or missing required attributes are errors. */
export function computeAttrs(
  specs: AttributeSpecs | undefined,
  given: Attrs | undefined,
  path: string,
): Attrs {
  for (const key of Object.keys(given ?? NO_ATTRS)) {
    if (!specs || !Object.hasOwn(specs, key)) fail(`${path}.${key}`, "unknown attribute");
  }
  if (!specs) return NO_ATTRS;
  const attrs: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs)) {
    let value = given?.[name];
    if (value === undefined) {
      if (!("default" in spec)) fail(`${path}.${name}`, "required attribute is missing");
      value = spec.default;
    }
    const error = spec.validate?.(value);
    if (error !== undefined) fail(`${path}.${name}`, error);
    attrs[name] = value;
  }
  return attrs;
}

/**
 * The persisted form of `attrs`: only attributes that differ from their default (required ones
 * always). Undefined when none remain, so a paragraph with default alignment has no `attrs`.
 */
export function attrsToJSON(
  specs: AttributeSpecs | undefined,
  attrs: Attrs,
): Record<string, unknown> | undefined {
  if (!specs) return undefined;
  let json: Record<string, unknown> | undefined;
  for (const [name, spec] of Object.entries(specs)) {
    const value = attrs[name];
    if ("default" in spec && deepEqual(value, spec.default)) continue;
    json ??= {};
    json[name] = value;
  }
  return json;
}

/** Structural equality for JSON-like attribute values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
