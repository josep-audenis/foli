/**
 * Small validators for schema v3's JSON-valued attributes and envelope. A check returns an
 * error message, or undefined when the value is valid.
 */

export type Check = (value: unknown) => string | undefined;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const bool: Check = (v) => (typeof v === "boolean" ? undefined : "must be true or false");

export const int =
  (min: number, max: number): Check =>
  (v) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max
      ? undefined
      : `must be an integer from ${min} to ${max}`;

/** A Word identifier-like string: style ids, font names, relationship ids, authors. */
export const text =
  (max = 255): Check =>
  (v) =>
    typeof v === "string" && v.length > 0 && v.length <= max
      ? undefined
      : `must be a non-empty string of at most ${max} characters`;

export const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    values.includes(v as string) ? undefined : `must be one of ${values.join(", ")}`;

/** A token of one of Word's long enumerations (border styles, number formats…). */
export const token: Check = (v) =>
  typeof v === "string" && /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(v)
    ? undefined
    : "must be a Word token";

/** `RRGGBB` (any case, as Word writes it) or `auto`. */
export const color: Check = (v) =>
  typeof v === "string" && /^([0-9A-Fa-f]{6}|auto)$/.test(v) ? undefined : "must be RRGGBB or auto";

/** An ISO 8601 date-time, as Word stores revision and comment dates. */
export const date: Check = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(v)
    ? undefined
    : "must be an ISO 8601 date-time";

/** Verbatim XML kept for export (unknown properties, opaque content): never parsed by Foli. */
export const xml: Check = (v) =>
  typeof v === "string" && v.length > 0 && v.length <= 16_777_216
    ? undefined
    : "must be an XML string";

export const nullable =
  (check: Check): Check =>
  (v) =>
    v === null ? undefined : check(v);

export const listOf =
  (check: Check, max = 10_000): Check =>
  (v) => {
    if (!Array.isArray(v)) return "must be an array";
    if (v.length > max) return `must have at most ${max} items`;
    for (let i = 0; i < v.length; i++) {
      const error = check(v[i]);
      if (error) return `[${i}] ${error}`;
    }
    return undefined;
  };

/**
 * An object with only the given keys, each optional unless listed in `required`, and at least
 * one present (an empty object means "not set": use null).
 */
export const shape =
  (fields: Readonly<Record<string, Check>>, required: readonly string[] = []): Check =>
  (v) => {
    if (!isRecord(v)) return "must be an object";
    const keys = Object.keys(v);
    if (keys.length === 0) return "must not be empty (use null)";
    for (const key of keys) {
      const check = fields[key];
      if (!check) return `unknown key ${key}`;
      const error = check(v[key]);
      if (error) return `${key} ${error}`;
    }
    for (const key of required) if (!(key in v)) return `${key} is required`;
    return undefined;
  };

export const both =
  (...checks: Check[]): Check =>
  (v) => {
    for (const check of checks) {
      const error = check(v);
      if (error) return error;
    }
    return undefined;
  };
