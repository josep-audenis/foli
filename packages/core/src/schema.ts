/**
 * Schema v1: the node and mark types a Foli document may contain, as JSON types plus a
 * validator. Deliberately minimal; Phase 2 replaces this with a full Schema/Node model
 * (see docs/roadmap.md). The JSON shape ({type, attrs, content, text, marks}) is permanent.
 */

export const MARK_TYPES = ["bold", "italic", "underline", "strike"] as const;
export type MarkType = (typeof MARK_TYPES)[number];

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export interface MarkJSON {
  type: MarkType;
}

export interface TextJSON {
  type: "text";
  text: string;
  marks?: MarkJSON[];
}

export interface HardBreakJSON {
  type: "hardBreak";
}

export type InlineJSON = TextJSON | HardBreakJSON;

export interface ParagraphJSON {
  type: "paragraph";
  content?: InlineJSON[];
}

export interface HeadingJSON {
  type: "heading";
  attrs: { level: HeadingLevel };
  content?: InlineJSON[];
}

export type BlockJSON = ParagraphJSON | HeadingJSON;

export interface DocJSON {
  type: "doc";
  content: BlockJSON[];
}

export class FoliDocumentError extends Error {
  override name = "FoliDocumentError";
}

/**
 * Validates untrusted content. Unknown node types, marks, attributes or keys are errors,
 * never silently dropped. Messages carry a JSON path to the offending value.
 */
export function validateContent(value: unknown, path = "content"): DocJSON {
  const doc = expectNode(value, path, ["type", "content"]);
  if (doc.type !== "doc") fail(path, 'root node must be of type "doc"');
  const blocks = expectArray(doc.content, `${path}.content`);
  if (blocks.length === 0) fail(`${path}.content`, "doc must contain at least one block");
  blocks.forEach((block, i) => {
    validateBlock(block, `${path}.content[${i}]`);
  });
  return value as DocJSON;
}

function validateBlock(value: unknown, path: string): void {
  const node = expectNode(value, path, ["type", "attrs", "content"]);
  if (node.type === "paragraph") {
    if (node.attrs !== undefined) fail(`${path}.attrs`, "paragraph has no attributes");
  } else if (node.type === "heading") {
    const attrs = expectNode(node.attrs, `${path}.attrs`, ["level"]);
    if (!HEADING_LEVELS.includes(attrs.level as HeadingLevel)) {
      fail(`${path}.attrs.level`, "heading level must be an integer from 1 to 6");
    }
  } else {
    fail(`${path}.type`, `unknown block type ${JSON.stringify(node.type)}`);
  }
  if (node.content === undefined) return;
  expectArray(node.content, `${path}.content`).forEach((inline, i) => {
    validateInline(inline, `${path}.content[${i}]`);
  });
}

function validateInline(value: unknown, path: string): void {
  const node = expectNode(value, path, ["type", "text", "marks"]);
  if (node.type === "hardBreak") {
    if (node.text !== undefined || node.marks !== undefined)
      fail(path, "hardBreak takes no text or marks");
    return;
  }
  if (node.type !== "text")
    fail(`${path}.type`, `unknown inline type ${JSON.stringify(node.type)}`);
  if (typeof node.text !== "string" || node.text === "") {
    fail(`${path}.text`, "text must be a non-empty string");
  }
  if (node.marks === undefined) return;
  const seen = new Set<unknown>();
  expectArray(node.marks, `${path}.marks`).forEach((value, i) => {
    const mark = expectNode(value, `${path}.marks[${i}]`, ["type"]);
    if (!MARK_TYPES.includes(mark.type as MarkType)) {
      fail(`${path}.marks[${i}].type`, `unknown mark type ${JSON.stringify(mark.type)}`);
    }
    if (seen.has(mark.type)) fail(`${path}.marks[${i}]`, "duplicate mark");
    seen.add(mark.type);
  });
}

function expectNode(value: unknown, path: string, allowedKeys: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) fail(`${path}.${key}`, "unknown key");
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

function fail(path: string, message: string): never {
  throw new FoliDocumentError(`${path}: ${message}`);
}
