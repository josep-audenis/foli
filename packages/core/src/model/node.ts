import { type Attrs, deepEqual, NO_ATTRS } from "./attrs.js";
import { FoliDocumentError } from "./errors.js";
import { Fragment } from "./fragment.js";
import { Mark, type MarkJSON } from "./mark.js";
import { replace } from "./replace.js";
import { ResolvedPos } from "./resolvedpos.js";
import type { NodeType } from "./schema.js";
import { Slice } from "./slice.js";

/** The persisted shape of a node. Keys are emitted in this order by `toJSON`. */
export interface NodeJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NodeJSON[];
  text?: string;
  marks?: MarkJSON[];
}

/**
 * An immutable document node. Edits build new nodes along the changed path and reuse every
 * unchanged node (structural sharing), so `a === b` means "unchanged" and is a free cache key.
 *
 * Positions: entering or leaving a non-leaf node counts 1, each UTF-16 code unit of text counts
 * 1, a leaf node counts 1. Position 0 is the start of this node's content.
 */
export class Node {
  /** Set only on text nodes. */
  declare readonly text?: string;

  /** @internal Use NodeType.create, Schema.node/text or Schema.nodeFromJSON. */
  constructor(
    readonly type: NodeType,
    readonly attrs: Attrs,
    readonly content: Fragment,
    readonly marks: readonly Mark[],
  ) {}

  get nodeSize(): number {
    return this.type.isLeaf ? 1 : 2 + this.content.size;
  }

  get childCount(): number {
    return this.content.childCount;
  }

  get firstChild(): Node | null {
    return this.content.firstChild;
  }

  get lastChild(): Node | null {
    return this.content.lastChild;
  }

  get isText(): boolean {
    return this.type.isText;
  }

  get isInline(): boolean {
    return this.type.isInline;
  }

  get isBlock(): boolean {
    return this.type.isBlock;
  }

  get isTextblock(): boolean {
    return this.type.isTextblock;
  }

  get isLeaf(): boolean {
    return this.type.isLeaf;
  }

  /** All text in this node, concatenated without separators. */
  get textContent(): string {
    return this.content.textBetween(0, this.content.size);
  }

  child(index: number): Node {
    return this.content.child(index);
  }

  maybeChild(index: number): Node | null {
    return this.content.maybeChild(index);
  }

  forEach(f: (node: Node, offset: number, index: number) => void): void {
    this.content.forEach(f);
  }

  /** See Fragment.nodesBetween; positions are relative to this node's content start. */
  nodesBetween(
    from: number,
    to: number,
    f: (node: Node, pos: number, parent: Node | null, index: number) => boolean | undefined,
  ): void {
    this.content.nodesBetween(from, to, f, 0, this);
  }

  /** Calls `f` for every descendant. Return false to skip a node's children. */
  descendants(
    f: (node: Node, pos: number, parent: Node | null, index: number) => boolean | undefined,
  ): void {
    this.nodesBetween(0, this.content.size, f);
  }

  textBetween(from: number, to: number, blockSeparator?: string, leafText?: string): string {
    return this.content.textBetween(from, to, blockSeparator, leafText);
  }

  /** Same type, attrs and marks. */
  sameMarkup(other: Node): boolean {
    return (
      this.type === other.type &&
      deepEqual(this.attrs, other.attrs) &&
      Mark.sameSet(this.marks, other.marks)
    );
  }

  /** Structural equality. */
  eq(other: Node): boolean {
    return this === other || (this.sameMarkup(other) && this.content.eq(other.content));
  }

  /** Same markup, new content. Not validated; see `check`. */
  copy(content: Fragment = Fragment.empty): Node {
    return content === this.content ? this : new Node(this.type, this.attrs, content, this.marks);
  }

  /** Same node with the given (canonical) mark set. */
  mark(marks: readonly Mark[]): Node {
    return Mark.sameSet(marks, this.marks)
      ? this
      : new Node(this.type, this.attrs, this.content, marks);
  }

  /** A copy holding only the content between two offsets. */
  cut(from: number, to = this.content.size): Node {
    return from === 0 && to === this.content.size ? this : this.copy(this.content.cut(from, to));
  }

  /** The content between two positions as a slice, open as deep as the positions are. */
  slice(from: number, to = this.content.size): Slice {
    if (from > to) throw new RangeError(`Invalid range ${from}..${to}`);
    if (from === to) return Slice.empty;
    const $from = this.resolve(from);
    const $to = this.resolve(to);
    const depth = $from.sharedDepth(to);
    const start = $from.start(depth);
    const content = $from.node(depth).content.cut($from.pos - start, $to.pos - start);
    return new Slice(content, $from.depth - depth, $to.depth - depth);
  }

  /**
   * Replaces `from..to` with a slice, joining open nodes at both ends. Throws ReplaceError when
   * the result would break the schema (the original node is untouched either way).
   */
  replace(from: number, to: number, slice: Slice): Node {
    if (from > to) throw new RangeError(`Invalid range ${from}..${to}`);
    return replace(this.resolve(from), this.resolve(to), slice);
  }

  /** The node starting at `pos`, or the text node containing it; null if none. */
  nodeAt(pos: number): Node | null {
    let node: Node = this;
    for (;;) {
      const { index, offset } = node.content.findIndex(pos);
      const child = node.content.maybeChild(index);
      if (!child) return null;
      if (offset === pos || child.isText) return child;
      node = child;
      pos -= offset + 1;
    }
  }

  /** Resolves a position to its tree context. Throws RangeError outside 0..content.size. */
  resolve(pos: number): ResolvedPos {
    return ResolvedPos.resolve(this, pos);
  }

  /** Throws FoliDocumentError if this subtree breaks the schema. */
  check(): void {
    if (!this.type.validContent(this.content)) {
      throw new FoliDocumentError(`Invalid content for node ${this.type.name}: ${this.content}`);
    }
    this.content.forEach((child) => {
      child.check();
    });
  }

  toJSON(): NodeJSON {
    const json: NodeJSON = { type: this.type.name };
    if (this.type.spec.attrs) json.attrs = { ...this.attrs };
    if (this.content.size) json.content = this.content.toJSON();
    if (this.marks.length) json.marks = this.marks.map((mark) => mark.toJSON());
    return json;
  }

  toString(): string {
    return this.content.size
      ? `${this.type.name}(${this.content.content.join(", ")})`
      : this.type.name;
  }
}

export class TextNode extends Node {
  /** @internal Use Schema.text. */
  constructor(
    type: NodeType,
    override readonly text: string,
    marks: readonly Mark[],
  ) {
    super(type, NO_ATTRS, Fragment.empty, marks);
    if (!text) throw new RangeError("Empty text nodes are not allowed");
  }

  override get nodeSize(): number {
    return this.text.length;
  }

  override get textContent(): string {
    return this.text;
  }

  override eq(other: Node): boolean {
    return this === other || (this.sameMarkup(other) && this.text === other.text);
  }

  override mark(marks: readonly Mark[]): TextNode {
    return Mark.sameSet(marks, this.marks) ? this : new TextNode(this.type, this.text, marks);
  }

  override cut(from = 0, to = this.text.length): TextNode {
    return from === 0 && to === this.text.length ? this : this.withText(this.text.slice(from, to));
  }

  withText(text: string): TextNode {
    return text === this.text ? this : new TextNode(this.type, text, this.marks);
  }

  override toJSON(): NodeJSON {
    const json: NodeJSON = { type: this.type.name, text: this.text };
    if (this.marks.length) json.marks = this.marks.map((mark) => mark.toJSON());
    return json;
  }

  override toString(): string {
    const text = JSON.stringify(this.text);
    return this.marks.length ? `${this.marks.map((m) => m.type.name).join("+")}${text}` : text;
  }
}
