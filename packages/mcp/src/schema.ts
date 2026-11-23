/** The schemas as the server publishes them; the schemas and their check are `@folijs/agent`'s. */
import type { JsonSchema, JsonSchemaOrAny } from "@folijs/agent";

export type { JsonSchema, JsonSchemaOrAny } from "@folijs/agent";

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
