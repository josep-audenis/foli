import { Mark, type Node, type ResolvedPos } from "../model/index.js";
import type { Mappable } from "../transform/stepmap.js";

export interface SelectionJSON {
  type: "text" | "node" | "all";
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
    const doc = $pos.doc;
    const pos = findTextPos(doc, $pos.pos, bias) ?? findTextPos(doc, $pos.pos, -bias);
    return pos === null ? new AllSelection(doc) : TextSelection.create(doc, pos);
  }

  static atStart(doc: Node): Selection {
    return Selection.near(doc.resolve(0), 1);
  }

  static atEnd(doc: Node): Selection {
    return Selection.near(doc.resolve(doc.content.size), -1);
  }

  /** Restores a selection, clamping positions into the document. */
  static fromJSON(doc: Node, json: SelectionJSON): Selection {
    if (json.type === "all") return new AllSelection(doc);
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
 * Nearest position inside a textblock from `pos` in direction `dir`, or null.
 * shortcut: scans the whole document; fine for headless use, revisit if it shows in profiles (Phase 4).
 */
function findTextPos(doc: Node, pos: number, dir: number): number | null {
  let found: number | null = null;
  doc.descendants((node, p) => {
    if (!node.isTextblock) return true;
    const start = p + 1;
    const end = start + node.content.size;
    if (dir > 0 && start >= pos && found === null) found = start;
    if (dir < 0 && end <= pos) found = end;
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
    const dir = $head.pos >= $anchor.pos ? 1 : -1;
    const head = $head.parent.inlineContent ? $head : Selection.near($head, dir).$head;
    const anchor = $anchor.parent.inlineContent ? $anchor : Selection.near($anchor, -dir).$head;
    if (!head.parent.inlineContent || !anchor.parent.inlineContent)
      return Selection.near($head, dir);
    return new TextSelection(outOfSurrogatePair(anchor), outOfSurrogatePair(head));
  }

  map(doc: Node, mapping: Mappable): Selection {
    const $head = doc.resolve(mapping.map(this.head));
    if (!$head.parent.inlineContent) return Selection.near($head);
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
    const node = $pos.nodeAfter;
    if (!node || $pos.textOffset || !NodeSelection.isSelectable(node)) {
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
    const from = mapping.mapResult(this.anchor, 1);
    const to = mapping.mapResult(this.head, -1);
    const $pos = doc.resolve(from.pos);
    const node = $pos.nodeAfter;
    // The node now at the start must still end at the mapped end: otherwise it was deleted
    // (both ends collapse) or its content moved out (a lift maps its edges onto a child's).
    if (
      from.deleted ||
      to.deleted ||
      !node ||
      $pos.textOffset ||
      from.pos + node.nodeSize !== to.pos
    ) {
      return Selection.near($pos);
    }
    return NodeSelection.isSelectable(node) ? new NodeSelection($pos) : Selection.near($pos);
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
  const before = $pos.nodeBefore;
  const after = $pos.nodeAfter;
  const main = before ?? after;
  const other = before ? after : null;
  let marks = main?.marks ?? Mark.none;
  for (const mark of marks) {
    if (!mark.type.inclusive && !(other && mark.isInSet(other.marks))) {
      marks = mark.removeFromSet(marks);
    }
  }
  return marks;
}
