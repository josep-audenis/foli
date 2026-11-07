import { type AttributeSpecs, type Attrs, computeAttrs, NO_ATTRS } from "./attrs.js";
import { ContentMatch } from "./content.js";
import { fail } from "./errors.js";
import { Fragment } from "./fragment.js";
import { Mark } from "./mark.js";
import { Node, TextNode } from "./node.js";
import { Slice } from "./slice.js";

export interface NodeSpec {
  /** Content expression, e.g. `block+` or `inline*` (see content.ts). Empty or absent = leaf. */
  content?: string;
  /** Space-separated groups this type belongs to, usable in content expressions. */
  group?: string;
  /** Inline node (placed in textblocks). The `text` type is always inline. */
  inline?: boolean;
  /**
   * Marks allowed on this node's children: space-separated mark names or groups, `_` for all,
   * `""` for none. Defaults to all for nodes with inline content, none otherwise.
   */
  marks?: string;
  attrs?: AttributeSpecs;
  /**
   * Edited as one unit: the caret never enters it. Leaf nodes are atoms whatever this says;
   * set it on a non-leaf node whose content is managed by code.
   */
  atom?: boolean;
  /** Whether a NodeSelection may select this node (default true; text is never selectable). */
  selectable?: boolean;
}

export interface MarkSpec {
  attrs?: AttributeSpecs;
  /** Space-separated groups this mark belongs to. */
  group?: string;
  /**
   * Marks that cannot coexist with this one: names or groups, `_` for all, `""` for none.
   * Defaults to the mark itself (at most one mark of a type per node).
   */
  excludes?: string;
  /**
   * Whether text typed at the end of this mark gets it too (default true). A link is not
   * inclusive: typing right after it continues as plain text.
   */
  inclusive?: boolean;
}

export interface SchemaSpec {
  /** Node types in order; earlier types win when an expression offers several. */
  nodes: Readonly<Record<string, NodeSpec>>;
  /** Mark types; their order is the canonical order of mark sets. */
  marks?: Readonly<Record<string, MarkSpec>>;
  /** Root node type. Defaults to `doc`. */
  topNode?: string;
}

const NODE_KEYS = ["type", "attrs", "content", "text", "marks"];
const MARK_KEYS = ["type", "attrs"];
const SLICE_KEYS = ["content", "openStart", "openEnd"];

export class NodeType {
  readonly groups: readonly string[];
  readonly isText: boolean;
  readonly isInline: boolean;
  readonly isBlock: boolean;
  readonly isLeaf: boolean;
  /** Matches this type's content expression; set once all types exist. */
  contentMatch!: ContentMatch;
  /** Allowed child marks; null means all. */
  markSet!: readonly MarkType[] | null;

  /** @internal Created by Schema. */
  constructor(
    readonly name: string,
    readonly schema: Schema,
    readonly spec: NodeSpec,
  ) {
    this.groups = spec.group ? spec.group.split(" ") : [];
    this.isText = name === "text";
    this.isInline = this.isText || !!spec.inline;
    this.isBlock = !this.isInline;
    this.isLeaf = !spec.content;
  }

  get inlineContent(): boolean {
    return this.contentMatch.inlineContent;
  }

  get isTextblock(): boolean {
    return this.isBlock && this.inlineContent;
  }

  /** Edited as one unit (leaf nodes, and nodes whose spec says `atom`). */
  get isAtom(): boolean {
    return this.isLeaf || !!this.spec.atom;
  }

  /** True when some attribute has no default (the type cannot be created without attrs). */
  hasRequiredAttrs(): boolean {
    return Object.values(this.spec.attrs ?? {}).some((spec) => !("default" in spec));
  }

  /** Creates a validated node. Throws FoliDocumentError on bad attrs or content. */
  create(
    attrs?: Attrs | null,
    content?: Fragment | Node | readonly Node[] | null,
    marks?: readonly Mark[],
  ): Node {
    if (this.isText) throw new RangeError("Use Schema.text to create text nodes");
    const fragment = Fragment.from(content);
    if (!this.validContent(fragment)) fail(this.name, `invalid content ${fragment}`);
    return new Node(
      this,
      computeAttrs(this.spec.attrs, attrs ?? undefined, `${this.name}.attrs`),
      fragment,
      Mark.setFrom(marks),
    );
  }

  /**
   * Creates a node without checking its content. Attributes are still validated.
   * @internal For transforms whose node ends up complete: a wrapper the wrapped blocks fill
   * (validated when they are inserted) or the open half of a split (validated when the replace
   * joins it). Steps do not validate closed nodes inside a slice: a node left incomplete here
   * would make an invalid document.
   */
  createOpen(attrs?: Attrs | null, content?: Fragment | Node | readonly Node[] | null): Node {
    if (this.isText) throw new RangeError("Use Schema.text to create text nodes");
    return new Node(
      this,
      computeAttrs(this.spec.attrs, attrs ?? undefined, `${this.name}.attrs`),
      Fragment.from(content),
      Mark.none,
    );
  }

  /** True if `content` matches the content expression and only carries allowed marks. */
  validContent(content: Fragment): boolean {
    if (!this.contentMatch.matchFragment(content)?.validEnd) return false;
    return content.content.every((child) => this.allowsMarks(child.marks));
  }

  allowsMarkType(type: MarkType): boolean {
    return this.markSet === null || this.markSet.includes(type);
  }

  allowsMarks(marks: readonly Mark[]): boolean {
    return this.markSet === null || marks.every((mark) => this.allowsMarkType(mark.type));
  }

  /** Whether content of `other` may be joined into a node of this type (validated after). */
  compatibleContent(other: NodeType): boolean {
    return (
      this === other ||
      (!this.isLeaf && !other.isLeaf && this.inlineContent === other.inlineContent)
    );
  }

  /** Like validContent, but throws with the JSON path of the first offending child. */
  checkContent(children: readonly Node[], path: string): void {
    let match = this.contentMatch;
    children.forEach((child, i) => {
      const next = match.matchType(child.type);
      if (!next) {
        fail(`${path}.content[${i}]`, `${child.type.name} is not allowed here in ${this.name}`);
      }
      if (!this.allowsMarks(child.marks)) {
        fail(`${path}.content[${i}].marks`, `marks not allowed in ${this.name}`);
      }
      match = next;
    });
    if (!match.validEnd) {
      fail(`${path}.content`, `${this.name} content is incomplete (expected "${match}")`);
    }
  }
}

export class MarkType {
  /** Mark types this one cannot coexist with; set once all types exist. */
  excluded!: readonly MarkType[];
  readonly groups: readonly string[];
  private readonly instance: Mark | null;

  /** @internal Created by Schema. */
  constructor(
    readonly name: string,
    readonly schema: Schema,
    readonly spec: MarkSpec,
    /** Position in the canonical mark order. */
    readonly rank: number,
  ) {
    this.groups = spec.group ? spec.group.split(" ") : [];
    this.instance = spec.attrs ? null : new Mark(this, NO_ATTRS);
  }

  /** Creates a mark; marks without attributes are shared instances. */
  create(attrs?: Attrs | null): Mark {
    if (this.instance && !(attrs && Object.keys(attrs).length)) return this.instance;
    return new Mark(this, computeAttrs(this.spec.attrs, attrs ?? undefined, `${this.name}.attrs`));
  }

  get inclusive(): boolean {
    return this.spec.inclusive ?? true;
  }

  excludes(other: MarkType): boolean {
    return this.excluded.includes(other);
  }

  isInSet(set: readonly Mark[]): Mark | undefined {
    return set.find((mark) => mark.type === this);
  }

  removeFromSet(set: readonly Mark[]): readonly Mark[] {
    return this.isInSet(set) ? set.filter((mark) => mark.type !== this) : set;
  }
}

/**
 * The set of node and mark types a document may contain, built from specs. Built-in schemas
 * use the same spec API as third-party extensions.
 */
export class Schema {
  readonly nodes: Readonly<Record<string, NodeType>>;
  readonly marks: Readonly<Record<string, MarkType>>;
  readonly topNodeType: NodeType;

  constructor(readonly spec: SchemaSpec) {
    const nodes: Record<string, NodeType> = Object.create(null);
    const marks: Record<string, MarkType> = Object.create(null);
    for (const [name, nodeSpec] of Object.entries(spec.nodes)) {
      nodes[name] = new NodeType(name, this, nodeSpec);
    }
    Object.entries(spec.marks ?? {}).forEach(([name, markSpec], rank) => {
      marks[name] = new MarkType(name, this, markSpec, rank);
    });
    this.nodes = nodes;
    this.marks = marks;

    const text = nodes.text;
    if (!text || text.spec.attrs || text.spec.content) {
      throw new Error("A schema needs a `text` node type without attrs or content");
    }
    const top = nodes[spec.topNode ?? "doc"];
    if (!top) throw new Error(`Schema has no top node type "${spec.topNode ?? "doc"}"`);
    this.topNodeType = top;

    const nodeList = Object.values(nodes);
    const markList = Object.values(marks);
    for (const type of nodeList) {
      type.contentMatch = ContentMatch.compile(type.spec.content ?? "", nodeList);
      const allowed = type.spec.marks ?? (type.inlineContent ? "_" : "");
      type.markSet = allowed === "_" ? null : gatherMarks(markList, allowed);
    }
    for (const type of markList) {
      const excludes = type.spec.excludes ?? type.name;
      type.excluded = excludes === "_" ? markList : gatherMarks(markList, excludes);
    }
  }

  nodeType(name: string): NodeType | undefined {
    return this.nodes[name];
  }

  markType(name: string): MarkType | undefined {
    return this.marks[name];
  }

  /** Creates a validated node of the named type. */
  node(
    type: string | NodeType,
    attrs?: Attrs | null,
    content?: Fragment | Node | readonly Node[] | null,
    marks?: readonly Mark[],
  ): Node {
    return this.resolveNodeType(type).create(attrs, content, marks);
  }

  /** Creates a text node. Text must be non-empty. */
  text(text: string, marks?: readonly Mark[]): TextNode {
    return new TextNode(this.resolveNodeType("text"), text, Mark.setFrom(marks));
  }

  mark(type: string | MarkType, attrs?: Attrs | null): Mark {
    if (typeof type !== "string") return type.create(attrs);
    const markType = this.marks[type];
    if (!markType) throw new RangeError(`Unknown mark type "${type}"`);
    return markType.create(attrs);
  }

  /**
   * Parses untrusted JSON into a node. Strict: unknown types, keys, attributes and invalid
   * content throw FoliDocumentError with the JSON path. Normalizes: adjacent text with equal
   * marks is merged and mark sets are put in canonical order.
   */
  nodeFromJSON(value: unknown, path = "$"): Node {
    return this.parseNode(value, path, 0, 0);
  }

  markFromJSON(value: unknown, path = "$"): Mark {
    const json = expectObject(value, path, MARK_KEYS);
    const type = typeof json.type === "string" ? this.marks[json.type] : undefined;
    if (!type) return fail(`${path}.type`, `unknown mark type ${JSON.stringify(json.type)}`);
    if (!type.spec.attrs) {
      if (json.attrs !== undefined) fail(`${path}.attrs`, `${type.name} has no attributes`);
      return type.create();
    }
    const attrs = json.attrs === undefined ? undefined : expectObject(json.attrs, `${path}.attrs`);
    return new Mark(type, computeAttrs(type.spec.attrs, attrs, `${path}.attrs`));
  }

  /** Parses a slice. Open nodes may hold incomplete content; everything else is strict. */
  sliceFromJSON(value: unknown, path = "$"): Slice {
    const json = expectObject(value, path, SLICE_KEYS);
    const items = expectArray(json.content, `${path}.content`);
    const { openStart, openEnd } = json;
    if (!isDepth(openStart)) fail(`${path}.openStart`, "expected a non-negative integer");
    if (!isDepth(openEnd)) fail(`${path}.openEnd`, "expected a non-negative integer");
    if (!items.length && (openStart || openEnd)) {
      fail(path, "an empty slice cannot be open");
    }
    const children = items.map((item, i) =>
      this.parseNode(
        item,
        `${path}.content[${i}]`,
        i === 0 ? openStart : 0,
        i === items.length - 1 ? openEnd : 0,
      ),
    );
    return new Slice(Fragment.fromArray(children), openStart, openEnd);
  }

  /** `openStart`/`openEnd`: how many levels, starting with this node, are cut open. */
  private parseNode(value: unknown, path: string, openStart: number, openEnd: number): Node {
    const json = expectObject(value, path, NODE_KEYS);
    const type = typeof json.type === "string" ? this.nodes[json.type] : undefined;
    if (!type) return fail(`${path}.type`, `unknown node type ${JSON.stringify(json.type)}`);
    const marks =
      json.marks === undefined ? Mark.none : this.marksFromJSON(json.marks, `${path}.marks`);
    if ((openStart || openEnd) && type.isLeaf) fail(path, "a leaf node cannot be open");

    if (type.isText) {
      if (json.attrs !== undefined) fail(`${path}.attrs`, "text nodes have no attributes");
      if (json.content !== undefined) fail(`${path}.content`, "text nodes have no content");
      if (typeof json.text !== "string" || !json.text) {
        fail(`${path}.text`, "text must be a non-empty string");
      }
      return new TextNode(type, json.text, marks);
    }
    if (json.text !== undefined) fail(`${path}.text`, "only text nodes have text");
    if (json.attrs !== undefined && !type.spec.attrs) {
      fail(`${path}.attrs`, `${type.name} has no attributes`);
    }
    const attrs = computeAttrs(
      type.spec.attrs,
      json.attrs === undefined ? undefined : expectObject(json.attrs, `${path}.attrs`),
      `${path}.attrs`,
    );

    let children: Node[] = [];
    if (json.content !== undefined) {
      if (type.isLeaf) fail(`${path}.content`, `${type.name} cannot have content`);
      const items = expectArray(json.content, `${path}.content`);
      children = items.map((item, i) =>
        this.parseNode(
          item,
          `${path}.content[${i}]`,
          i === 0 ? Math.max(openStart - 1, 0) : 0,
          i === items.length - 1 ? Math.max(openEnd - 1, 0) : 0,
        ),
      );
    }
    if (openStart || openEnd) {
      if (!children.length && (openStart > 1 || openEnd > 1)) {
        fail(`${path}.content`, "open depth exceeds the content");
      }
    } else {
      type.checkContent(children, path);
    }
    return new Node(type, attrs, Fragment.fromArray(children), marks);
  }

  private marksFromJSON(value: unknown, path: string): readonly Mark[] {
    let set = Mark.none;
    expectArray(value, path).forEach((item, i) => {
      const mark = this.markFromJSON(item, `${path}[${i}]`);
      const clash = set.find((m) => m.type.excludes(mark.type) || mark.type.excludes(m.type));
      if (clash) {
        fail(
          `${path}[${i}]`,
          clash.type === mark.type
            ? "duplicate mark"
            : `${mark.type.name} cannot be combined with ${clash.type.name}`,
        );
      }
      set = mark.addToSet(set);
    });
    return set;
  }

  private resolveNodeType(type: string | NodeType): NodeType {
    if (typeof type !== "string") return type;
    const nodeType = this.nodes[type];
    if (!nodeType) throw new RangeError(`Unknown node type "${type}"`);
    return nodeType;
  }
}

function gatherMarks(marks: readonly MarkType[], names: string): MarkType[] {
  const found: MarkType[] = [];
  for (const name of names.split(" ").filter(Boolean)) {
    const matched = marks.filter((m) => m.name === name || m.groups.includes(name));
    if (!matched.length) throw new Error(`Unknown mark type or group "${name}"`);
    for (const mark of matched) if (!found.includes(mark)) found.push(mark);
  }
  return found;
}

function expectObject(
  value: unknown,
  path: string,
  keys?: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  if (keys) {
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(`${path}.${key}`, "unknown key");
    }
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

function isDepth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
