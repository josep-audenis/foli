/**
 * The part of JSON Schema the tools' arguments use, and its check. Small on purpose: the
 * arguments are flat objects of strings, numbers, booleans and short lists.
 */
export interface JsonSchema {
  type: "object" | "string" | "integer" | "number" | "boolean" | "array" | "null";
  description?: string;
  /** An object's properties; nothing else is allowed in it. */
  properties?: Record<string, JsonSchemaOrAny>;
  required?: readonly string[];
  additionalProperties?: boolean;
  /** An array's items. */
  items?: JsonSchemaOrAny;
  enum?: readonly (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
}

/** A schema, or one of several (`anyOf`): a value that fits any of them fits. */
export type JsonSchemaOrAny = JsonSchema | { anyOf: readonly JsonSchema[]; description?: string };

const kind = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

/** @internal Why `value` does not fit `schema`, in words for a model, or null when it fits. */
export function invalid(
  value: unknown,
  schema: JsonSchemaOrAny,
  path = "arguments",
): string | null {
  if ("anyOf" in schema) {
    const reasons = schema.anyOf.map((option) => invalid(value, option, path));
    return reasons.includes(null)
      ? null
      : `${path} must be ${schema.anyOf.map((o) => o.type).join(" or ")}`;
  }
  const is = kind(value);
  const fits =
    schema.type === "integer"
      ? Number.isInteger(value)
      : schema.type === "number"
        ? is === "number" && Number.isFinite(value)
        : is === schema.type;
  if (!fits)
    return `${path} must be ${schema.type === "array" ? "a list" : schema.type}, not ${is}`;
  if (schema.enum && !schema.enum.includes(value as string))
    return `${path} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`;
  if (schema.minimum !== undefined && (value as number) < schema.minimum)
    return `${path} must be at least ${schema.minimum}`;
  if (schema.maximum !== undefined && (value as number) > schema.maximum)
    return `${path} must be at most ${schema.maximum}`;
  if (schema.type === "array" && schema.items)
    for (const [index, item] of (value as unknown[]).entries()) {
      const wrong = invalid(item, schema.items, `${path}[${index}]`);
      if (wrong) return wrong;
    }
  if (schema.type === "object") {
    const object = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(object, key)) return `${path}.${key} is missing`;
    for (const key of Object.keys(object)) {
      const property = Object.hasOwn(properties, key) ? properties[key] : undefined;
      if (!property) {
        if (schema.additionalProperties) continue;
        const known = Object.keys(properties);
        return `${path}.${key} is not an argument${known.length ? ` (there are: ${known.join(", ")})` : ""}`;
      }
      const wrong = invalid(object[key], property, `${path}.${key}`);
      if (wrong) return wrong;
    }
  }
  return null;
}

/**
 * @internal A schema as a client is told it: saying of every object what `invalid` holds it to,
 * that it takes no property it does not name (unless it says it takes any).
 */
export function published<T extends JsonSchemaOrAny>(schema: T): T {
  if ("anyOf" in schema) return { ...schema, anyOf: schema.anyOf.map(published) };
  const out: JsonSchema = { ...schema };
  if (out.properties)
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([key, value]) => [key, published(value)]),
    );
  if (out.items) out.items = published(out.items);
  if (out.type === "object" && out.additionalProperties !== true) out.additionalProperties = false;
  return out as T;
}
