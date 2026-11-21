/**
 * Custom nodes and marks (ADR-0008): extensions add namespaced inline or block leaves and marks
 * to the Word schema. A namespaced type the schema does not have is never dropped: it is read as
 * a foreign node or mark holding its type and attributes, and written back as it was.
 */
import type { Attrs, MarkJSON, MarkSpec, NodeJSON, NodeSpec } from "../model/index.js";
import { FoliDocumentError, Schema } from "../model/index.js";
import type { Plugin } from "../state/state.js";
import { isRecord } from "./check.js";
import { CUSTOM_TYPE, schema as wordSchema } from "./schema.js";

/** A custom node type: an inline leaf (`inline: true`) or a block leaf. */
export interface ExtensionNodeSpec extends Omit<NodeSpec, "content" | "text"> {
  /** The text it stands for in plain text, find, the clipboard and `.docx`. */
  text: (attrs: Attrs) => string;
}

/**
 * What an app adds to the editor: custom node and mark types, named `<namespace>:<name>`
 * (lowercase letters, digits and `-`), and plugins. Given to `createEditor` and `parseDocument`.
 */
export interface Extension {
  name: string;
  nodes?: Readonly<Record<string, ExtensionNodeSpec>>;
  marks?: Readonly<Record<string, MarkSpec>>;
  plugins?: readonly Plugin[];
}

/** Options of `parseDocument`. */
export interface ParseOptions {
  /** The custom types the document may hold as themselves; others are kept as foreign. */
  extensions?: readonly Extension[];
}

/** Options of `parseContent`. */
export interface ContentOptions extends ParseOptions {
  /** Where the content is, for error messages (default `content`). */
  path?: string;
  /** Content to paste, which a table may end. */
  fragment?: boolean;
  /**
   * The schema to parse with (an editor's `state.schema`), in place of `extensions`.
   * @internal
   */
  schema?: Schema;
}

/** Schemas by extension list: an array given again gets the same schema (do not mutate it). */
const schemas = new WeakMap<readonly Extension[], Schema>();

/**
 * The Word schema with `extensions`' types (the Word schema itself when there are none). Throws
 * a `RangeError` on a name that is not namespaced or is taken twice, or a node that is not a leaf.
 * @internal
 */
export function schemaWith(extensions: readonly Extension[] | undefined): Schema {
  if (!extensions?.length) return wordSchema;
  const known = schemas.get(extensions);
  if (known) return known;
  const nodes: Record<string, NodeSpec> = { ...wordSchema.spec.nodes };
  const marks: Record<string, MarkSpec> = { ...wordSchema.spec.marks };
  const add = (into: Record<string, unknown>, name: string, from: string) => {
    if (!CUSTOM_TYPE.test(name))
      throw new RangeError(`${from}: ${name} is not a namespaced type (<namespace>:<name>)`);
    if (Object.hasOwn(nodes, name) || Object.hasOwn(marks, name))
      throw new RangeError(`${from}: ${name} is declared twice`);
    return into;
  };
  for (const extension of extensions) {
    for (const [name, spec] of Object.entries(extension.nodes ?? {})) {
      const group = spec.inline ? "inline" : "block";
      if ((spec as NodeSpec).content || (spec.group !== undefined && spec.group !== group))
        throw new RangeError(`${extension.name}: ${name} must be a leaf in the ${group} group`);
      if (typeof spec.text !== "function")
        throw new RangeError(`${extension.name}: ${name} needs text(attrs)`);
      add(nodes, name, extension.name)[name] = { ...spec, group };
    }
    for (const [name, spec] of Object.entries(extension.marks ?? {}))
      add(marks, name, extension.name)[name] = spec;
  }
  const schema = new Schema({ nodes, marks });
  schemas.set(extensions, schema);
  return schema;
}

/** What a foreign node's JSON carries in memory: the text its `.docx` control showed. */
const FOREIGN_TEXT = Symbol.for("foli.foreignText");

/**
 * The text a custom node's JSON carries in memory (read from a `.docx` control), if any.
 */
export const foreignTextOf = (json: NodeJSON): string | undefined =>
  (json as { [FOREIGN_TEXT]?: string })[FOREIGN_TEXT];

/**
 * `json` carrying `text` in memory: never saved (`JSON.stringify` and copies leave it out).
 */
export function withForeignText<T extends NodeJSON>(json: T, text: string): T {
  Object.defineProperty(json, FOREIGN_TEXT, { value: text, configurable: true });
  return json;
}

const FOREIGN = new Set(["foreignInline", "foreignBlock"]);
/** The deepest JSON walked; deeper input is left to the schema, which refuses it. */
const MAX_DEPTH = 302;

function resolveMarks(marks: unknown, schema: Schema): unknown {
  if (!Array.isArray(marks)) return marks;
  let out: unknown[] | undefined;
  marks.forEach((mark, i) => {
    let next = mark;
    if (isRecord(mark) && typeof mark.type === "string") {
      const attrs = isRecord(mark.attrs) ? mark.attrs : undefined;
      if (CUSTOM_TYPE.test(mark.type) && !schema.marks[mark.type])
        next = { type: "foreign", attrs: { type: mark.type, attrs: mark.attrs ?? null } };
      else if (
        mark.type === "foreign" &&
        typeof attrs?.type === "string" &&
        CUSTOM_TYPE.test(attrs.type) &&
        schema.marks[attrs.type]
      )
        next = { type: attrs.type, ...(isRecord(attrs.attrs) ? { attrs: attrs.attrs } : {}) };
    }
    if (next === mark) return;
    out ??= marks.slice();
    out[i] = next;
  });
  return out ?? marks;
}

/**
 * Untrusted content JSON with custom types `schema` lacks as foreign nodes and marks, and foreign
 * ones whose type it has as themselves. Returns `value` itself when nothing changes; never
 * changes it.
 * @internal
 */
export function resolveCustom(value: unknown, schema: Schema, inline = false, depth = 0): unknown {
  if (!isRecord(value) || depth > MAX_DEPTH) return value;
  const type = value.type;
  const marks = resolveMarks(value.marks, schema);
  if (typeof type === "string" && CUSTOM_TYPE.test(type) && !schema.nodes[type]) {
    // A custom type is a leaf (1.x): content on one would be lost, so it is refused.
    if (value.content !== undefined || value.text !== undefined)
      throw new FoliDocumentError(`${type}: a custom node holds no content or text`);
    const text = foreignTextOf(value as unknown as NodeJSON);
    return {
      type: inline ? "foreignInline" : "foreignBlock",
      attrs: { type, attrs: value.attrs ?? null, ...(text === undefined ? {} : { text }) },
      ...(marks === undefined ? {} : { marks }),
    };
  }
  if (typeof type === "string" && FOREIGN.has(type) && isRecord(value.attrs)) {
    const custom = value.attrs.type;
    if (typeof custom === "string" && CUSTOM_TYPE.test(custom) && schema.nodes[custom]) {
      const attrs = value.attrs.attrs;
      return {
        type: custom,
        ...(isRecord(attrs) ? { attrs } : {}),
        ...(marks === undefined ? {} : { marks }),
      };
    }
  }
  let content = value.content;
  if (Array.isArray(content)) {
    const items: unknown[] = content;
    const parent = typeof type === "string" ? schema.nodes[type] : undefined;
    const inner = parent ? parent.inlineContent : false;
    let out: unknown[] | undefined;
    items.forEach((child, i) => {
      const next = resolveCustom(child, schema, inner, depth + 1);
      if (next === child) return;
      out ??= items.slice();
      out[i] = next;
    });
    content = out ?? items;
  }
  return content === value.content && marks === value.marks ? value : { ...value, content, marks };
}

/** A foreign mark's JSON as the custom mark it stands for. */
const markOut = (mark: MarkJSON): MarkJSON =>
  mark.type === "foreign" && mark.attrs
    ? {
        type: String(mark.attrs.type),
        ...(isRecord(mark.attrs.attrs) ? { attrs: mark.attrs.attrs } : {}),
      }
    : mark;

/**
 * Content JSON with foreign nodes and marks written back as the custom types they stand for (a
 * foreign node's text carried in memory: `foreignTextOf`). Changes `json` in place.
 * @internal
 */
export function writeCustom(json: NodeJSON): NodeJSON {
  if (json.marks?.some((m) => m.type === "foreign")) json.marks = json.marks.map(markOut);
  if (FOREIGN.has(json.type) && json.attrs) {
    const { type, attrs, text } = json.attrs as { type: string; attrs?: unknown; text?: unknown };
    const out: NodeJSON = { type, ...(isRecord(attrs) ? { attrs } : {}) };
    if (json.marks) out.marks = json.marks;
    return typeof text === "string" ? withForeignText(out, text) : out;
  }
  if (json.content) json.content = json.content.map(writeCustom);
  return json;
}
