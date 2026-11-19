/**
 * Small validators for schema v3's JSON-valued attributes and envelope. A check returns an
 * error message, or undefined when the value is valid. They are the trust boundary for
 * untrusted documents: only own keys are looked up, so `__proto__`, `constructor` and other
 * inherited names are unknown keys, never checks.
 */

export type Check = (value: unknown) => string | undefined;

/** @internal */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @internal */
export const bool: Check = (v) => (typeof v === "boolean" ? undefined : "must be true or false");

/** @internal */
export const int =
  (min: number, max: number): Check =>
  (v) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max
      ? undefined
      : `must be an integer from ${min} to ${max}`;

/**
 * A string of at most `max` characters, empty allowed (Word's ST_String: authors, initials).
 * @internal
 */
export const str =
  (max = 255): Check =>
  (v) =>
    typeof v === "string" && v.length <= max
      ? undefined
      : `must be a string of at most ${max} characters`;

/**
 * A non-empty string: ids and names things are referenced by.
 * @internal
 */
export const text =
  (max = 255): Check =>
  (v) =>
    typeof v === "string" && v.length > 0 && v.length <= max
      ? undefined
      : `must be a non-empty string of at most ${max} characters`;

/** @internal */
export const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    values.includes(v as string) ? undefined : `must be one of ${values.join(", ")}`;

/**
 * A token of one of Word's long enumerations (border styles, number formats…).
 * @internal
 */
export const token: Check = (v) =>
  typeof v === "string" && /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(v)
    ? undefined
    : "must be a Word token";

/**
 * `RRGGBB` (any case, as Word writes it) or `auto`.
 * @internal
 */
export const color: Check = (v) =>
  typeof v === "string" && /^([0-9A-Fa-f]{6}|auto)$/.test(v) ? undefined : "must be RRGGBB or auto";

/**
 * An ISO 8601 date-time, as Word stores revision and comment dates.
 * @internal
 */
export const date: Check = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(v)
    ? undefined
    : "must be an ISO 8601 date-time";

/**
 * Verbatim XML kept for export: never parsed by the engine.
 * @internal
 */
export const xml: Check = (v) =>
  typeof v === "string" && v.length > 0 && v.length <= 16_777_216
    ? undefined
    : "must be an XML string";

/**
 * An element's own attributes Foli does not model, by qualified name (`w14:paraId`).
 * @internal
 */
export const attributes: Check = (v) => {
  if (!isRecord(v)) return "must be an object";
  const entries = Object.entries(v);
  if (entries.length === 0) return "must not be empty (use null)";
  if (entries.length > 64) return "must have at most 64 attributes";
  for (const [name, value] of entries) {
    if (!/^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/.test(name))
      return `${name} is not an attribute name`;
    if (typeof value !== "string" || value.length > 65_535) return `${name} must be a string`;
  }
  return undefined;
};

/** @internal */
export const nullable =
  (check: Check): Check =>
  (v) =>
    v === null ? undefined : check(v);

/** @internal */
export const listOf =
  (check: Check, max = 100_000): Check =>
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
 * An object with only the given keys, each optional unless listed in `required`. Unless
 * `allowEmpty`, at least one key is present (an empty object means "not set": use null).
 * @internal
 */
export const shape =
  (
    fields: Readonly<Record<string, Check>>,
    required: readonly string[] = [],
    allowEmpty = false,
  ): Check =>
  (v) => {
    if (!isRecord(v)) return "must be an object";
    const keys = Object.keys(v);
    if (keys.length === 0 && !allowEmpty) return "must not be empty (use null)";
    for (const key of keys) {
      if (!Object.hasOwn(fields, key)) return `unknown key ${key}`;
      const error = (fields[key] as Check)(v[key]);
      if (error) return `${key} ${error}`;
    }
    for (const key of required) if (!Object.hasOwn(v, key)) return `${key} is required`;
    return undefined;
  };
