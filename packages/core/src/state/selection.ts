import { Mark, type Node, type ResolvedPos } from "../model/index.js";
import type { Mappable } from "../transform/stepmap.js";

export interface SelectionJSON {
  /** `cell`: a `CellSelection` (anchor and head are the positions before two cells). */
  type: "text" | "node" | "all" | "cell";
  anchor: number;
  head: number;
}

/** A selection: an anchor (where it started) and a head (where it ends, the caret). */
export abstract class Selection {
  constructor(
    readonly $anchor: ResolvedPos,
    readonly $head: ResolvedPos,
  ) {}

  get anchor(): number {
    return this.$anchor.pos;
  }

  get head(): number {
    return this.$head.pos;
  }

  get $from(): ResolvedPos {
    return this.anchor <= this.head ? this.$anchor : this.$head;
  }

  get $to(): ResolvedPos {
    return this.anchor <= this.head ? this.$head : this.$anchor;
  }

  get from(): number {
    return this.$from.pos;
  }

  get to(): number {
    return this.$to.pos;
  }

  get empty(): boolean {
    return this.from === this.to;
  }

  /**
   * The ranges the selection covers, in document order: `from..to`, or one per selected cell
   * for a cell selection (so commands that act on a range leave the cells outside it alone).
   */
  get ranges(): readonly { from: number; to: number }[] {
    return [{ from: this.from, to: this.to }];
  }

  /** This selection moved into `doc` through `mapping`. */
  abstract map(doc: Node, mapping: Mappable): Selection;

  abstract toJSON(): SelectionJSON;

  eq(other: Selection): boolean {
    return (
      other.constructor === this.constructor &&
      other.anchor === this.anchor &&
      other.head === this.head
    );
  }

  /**
   * A text selection at `$pos` if it is in inline content, else at the nearest textblock in the
   * direction of `bias` (then the other way); an AllSelection if the document has no textblock.
   */
  static near($pos: ResolvedPos, bias = 1): Selection {
    if ($pos.parent.inlineContent) return new TextSelection($pos, $pos);
    const { doc } = $pos;
    const found = textPosFrom(doc, $pos.pos, bias) ?? textPosFrom(doc, $pos.pos, -bias);
    return found === null ? new AllSelection(doc) : TextSelection.create(doc, found);
  }

  static atStart(doc: Node): Selection {
    return Selection.near(doc.resolve(0), 1);
  }

  static atEnd(doc: Node): Selection {
    return Selection.near(doc.resolve(doc.content.size), -1);
  }

  /** Selection kinds defined elsewhere (`cell`: tables), by their JSON `type`. */
  static readonly kinds = new Map<string, (doc: Node, json: SelectionJSON) => Selection>();

  /** Restores a selection, clamping positions into the document. */
  static fromJSON(doc: Node, json: SelectionJSON): Selection {
    if (json.type === "all") return new AllSelection(doc);
    const kind = Selection.kinds.get(json.type);
    if (kind) return kind(doc, json);
    const clamp = (pos: number) => Math.max(0, Math.min(pos, doc.content.size));
    if (json.type === "node") {
      const $pos = doc.resolve(clamp(json.anchor));
      const node = $pos.nodeAfter;
      return node && !$pos.textOffset && NodeSelection.isSelectable(node)
        ? new NodeSelection($pos)
        : Selection.near($pos);
    }
    return TextSelection.between(doc.resolve(clamp(json.anchor)), doc.resolve(clamp(json.head)));
  }
}

/**
 * The closest position inside a textblock from `pos` in direction `dir` (the start of the first
 * textblock starting at or after it, or the end of the last one ending at or before it), or null.
 */
function textPosFrom(doc: Node, pos: number, dir: number): number | null {
  let found: number | null = null;
  const [from, to] = dir > 0 ? [pos, doc.content.size] : [0, pos];
  doc.nodesBetween(from, to, (node, at) => {
    if (dir > 0 && found !== null) return false;
    if (!node.isTextblock) return true;
    const start = at + 1;
    const end = start + node.content.size;
    if (dir > 0 ? start >= pos : end <= pos) found = dir > 0 ? start : end;
    return false;
  });
  return found;
}

/**
 * Moves a position that falls between the two halves of a surrogate pair to before the pair.
 * shortcut: does not snap to full grapheme clusters (combining marks, ZWJ sequences); the view
 * places carets at cluster boundaries (Phase 4).
 */
function outOfSurrogatePair($pos: ResolvedPos): ResolvedPos {
  if (!$pos.textOffset) return $pos;
  const text = $pos.parent.child($pos.index()).text ?? "";
  const before = text.charCodeAt($pos.textOffset - 1);
  const after = text.charCodeAt($pos.textOffset);
  const split = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  return split ? $pos.doc.resolve($pos.pos - 1) : $pos;
}

/** A caret or range whose ends both sit in inline content. */
export class TextSelection extends Selection {
  static create(doc: Node, anchor: number, head = anchor): Selection {
    return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
  }

  /** Like `create`, but snaps ends that are not in inline content to the nearest valid position. */
  static between($anchor: ResolvedPos, $head: ResolvedPos): Selection {
    const dir = $head.pos < $anchor.pos ? -1 : 1;
    // Each end not in inline content moves to text: the head onwards, the anchor back towards it.
    const inText = ($pos: ResolvedPos, towards: number) =>
      $pos.parent.inlineContent ? $pos : Selection.near($pos, towards).$head;
    const head = inText($head, dir);
    const anchor = inText($anchor, -dir);
    if (head.parent.inlineContent && anchor.parent.inlineContent) {
      return new TextSelection(outOfSurrogatePair(anchor), outOfSurrogatePair(head));
    }
    return Selection.near($head, dir);
  }

  map(doc: Node, mapping: Mappable): Selection {
    const $head = doc.resolve(mapping.map(this.head));
    if (!$head.parent.inlineContent) return Selection.near($head);
    // An anchor that lands outside text collapses the selection onto the head.
    const $anchor = doc.resolve(mapping.map(this.anchor));
    return new TextSelection($anchor.parent.inlineContent ? $anchor : $head, $head);
  }

  toJSON(): SelectionJSON {
    return { type: "text", anchor: this.anchor, head: this.head };
  }
}

/**
 * One node selected as a unit (a horizontal rule, later an image): `from` is the position
 * before it, `to` the position after it. Only selectable nodes (not text) can be selected.
 */
export class NodeSelection extends Selection {
  readonly node: Node;

  constructor($pos: ResolvedPos) {
    const node = $pos.textOffset ? null : $pos.nodeAfter;
    if (!node || !NodeSelection.isSelectable(node)) {
      throw new RangeError(`No selectable node at position ${$pos.pos}`);
    }
    super($pos, $pos.doc.resolve($pos.pos + node.nodeSize));
    this.node = node;
  }

  static create(doc: Node, from: number): NodeSelection {
    return new NodeSelection(doc.resolve(from));
  }

  static isSelectable(node: Node): boolean {
    return !node.isText && node.type.spec.selectable !== false;
  }

  /** Still the same node when it survives the mapping; a text selection near it otherwise. */
  map(doc: Node, mapping: Mappable): Selection {
    const start = mapping.mapResult(this.anchor, 1);
    const end = mapping.mapResult(this.head, -1);
    const $start = doc.resolve(start.pos);
    if (start.deleted || end.deleted) return Selection.near($start);
    // Still the same node only if the node now at the start ends at the mapped end: a lift, for
    // one, maps the node's edges onto those of a child it moved out.
    const node = $start.textOffset ? null : $start.nodeAfter;
    const same = node !== null && start.pos + node.nodeSize === end.pos;
    return same && NodeSelection.isSelectable(node)
      ? new NodeSelection($start)
      : Selection.near($start);
  }

  toJSON(): SelectionJSON {
    return { type: "node", anchor: this.anchor, head: this.head };
  }
}

/** The whole document. */
export class AllSelection extends Selection {
  constructor(doc: Node) {
    super(doc.resolve(0), doc.resolve(doc.content.size));
  }

  map(doc: Node): Selection {
    return new AllSelection(doc);
  }

  toJSON(): SelectionJSON {
    return { type: "all", anchor: this.anchor, head: this.head };
  }
}

/**
 * Marks that text typed at `$pos` should get: those of the text before it (or after, at a block
 * start). A mark that is not inclusive (a link) continues only where the text after has it too.
 */
export function marksAt($pos: ResolvedPos): readonly Mark[] {
  if (!$pos.parent.inlineContent) return Mark.none;
  if ($pos.textOffset) return $pos.parent.child($pos.index()).marks;
  const { nodeBefore, nodeAfter } = $pos;
  // Typing continues the text before the caret; at the start of a block, the text after it.
  const source = nodeBefore ?? nodeAfter;
  if (!source) return Mark.none;
  const across = nodeBefore ? nodeAfter : null;
  const kept = source.marks.filter(
    (mark) => mark.type.inclusive || (across !== null && mark.isInSet(across.marks)),
  );
  return kept.length === source.marks.length ? source.marks : kept;
}
