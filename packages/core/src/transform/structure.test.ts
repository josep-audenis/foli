import { describe, expect, it } from "vitest";
import {
  canJoin,
  canSplit,
  EditorState,
  Fragment,
  findWrapping,
  liftTarget,
  marksAt,
  type Node,
  type NodeJSON,
  NodeSelection,
  type NodeType,
  ReplaceAroundStep,
  ReplaceStep,
  Selection,
  Slice,
  TextSelection,
  Transform,
  TransformError,
} from "../index.js";
import { testSchema } from "../testing/index.js";

const p = (...text: string[]): NodeJSON => ({
  type: "paragraph",
  ...(text.length ? { content: text.map((t) => ({ type: "text", text: t })) } : {}),
});
const item = (...content: NodeJSON[]): NodeJSON => ({ type: "listItem", content });
const list = (...items: NodeJSON[]): NodeJSON => ({ type: "bulletList", content: items });
const quote = (...content: NodeJSON[]): NodeJSON => ({ type: "blockquote", content });
const rule: NodeJSON = { type: "rule" };
const doc = (...content: NodeJSON[]) => testSchema.nodeFromJSON({ type: "doc", content });
const type = (name: string) => testSchema.nodes[name] as NodeType;
const range = (d: Node, from: number, to = from) => {
  const r = d.resolve(from).blockRange(d.resolve(to));
  if (!r) throw new Error("no block range");
  return r;
};

/** The doc after undoing every step of `tr` through its inverses. */
function undone(tr: Transform): Node {
  let current = tr.doc;
  for (let i = tr.steps.length - 1; i >= 0; i--) {
    const result = tr.steps[i]?.invert(tr.docs[i] as Node).apply(current);
    if (!result?.doc) throw new Error(`step ${i} did not invert: ${result?.failed}`);
    current = result.doc;
  }
  return current;
}

describe("findWrapping and wrap", () => {
  it("wraps paragraphs in a list: the list and an item around each run of blocks", () => {
    const start = doc(p("ab"), p("cd"));
    const r = range(start, 2, 6);
    const wrappers = findWrapping(r, type("bulletList"));
    expect(wrappers?.map((w) => w.type.name)).toEqual(["bulletList", "listItem"]);
    const tr = new Transform(start).wrap(r, wrappers ?? []);
    expect(tr.doc.eq(doc(list(item(p("ab"), p("cd")))))).toBe(true);
    // The wrapped content moved, not re-created: a position inside it maps two tokens on.
    expect(tr.mapping.map(2)).toBe(4);
    expect(tr.steps[0]).toBeInstanceOf(ReplaceAroundStep);
    expect(undone(tr).eq(start)).toBe(true);
  });

  it("wraps in a blockquote directly, and finds no wrapping that the parent forbids", () => {
    const start = doc(p("ab"));
    expect(findWrapping(range(start, 1), type("blockquote"))?.map((w) => w.type.name)).toEqual([
      "blockquote",
    ]);
    // A list item's first child must be a paragraph: a rule cannot be wrapped into a list.
    const withRule = doc(rule, p("x"));
    expect(findWrapping(range(withRule, 0, 1), type("bulletList"))).toBeNull();
  });
});

describe("liftTarget and lift", () => {
  it("lifts the only item's paragraph out of a list, removing the emptied list", () => {
    const start = doc(list(item(p("ab"))));
    const r = range(start, 3);
    const target = liftTarget(r);
    expect(target).not.toBeNull();
    // From the paragraph out of the item: the item is not a valid place for nothing, so the
    // nearest valid target holds a paragraph without the item (the list cannot: the document).
    const tr = new Transform(start).lift(r, target as number);
    expect(tr.doc.check()).toBeUndefined();
    expect(undone(tr).eq(start)).toBe(true);
  });

  it("lifts a middle block out of a blockquote, splitting it around the block", () => {
    const start = doc(quote(p("a"), p("b"), p("c")));
    const r = range(start, 5); // inside "b"
    expect(liftTarget(r)).toBe(0);
    const tr = new Transform(start).lift(r, 0);
    expect(tr.doc.eq(doc(quote(p("a")), p("b"), quote(p("c"))))).toBe(true);
    expect(undone(tr).eq(start)).toBe(true);
  });

  it("lifts a nested block out of a list item whose first child stays (undo exact)", () => {
    // The inverse inserts the block back into the item cut open by the lift: the open item is
    // completed by the document, so it must not be validated on its own.
    const start = doc(list(item(p(), quote({ type: "heading" }, p()))));
    const r = range(start, 4, 5);
    const target = liftTarget(r);
    expect(target).toBe(0);
    const tr = new Transform(start).lift(r, target as number);
    expect(tr.doc.eq(doc(list(item(p())), quote({ type: "heading" }, p())))).toBe(true);
    expect(undone(tr).eq(start)).toBe(true);
  });

  it("has no target at the top level", () => {
    const start = doc(p("ab"));
    expect(liftTarget(range(start, 1))).toBeNull();
  });
});

describe("split and join at depth", () => {
  it("splits a list item (depth 2) and joins it back", () => {
    const start = doc(list(item(p("abcd"))));
    expect(canSplit(start, 5, 2)).toBe(true);
    const tr = new Transform(start).split(5, 2);
    expect(tr.doc.eq(doc(list(item(p("ab")), item(p("cd")))))).toBe(true);
    // Between the two items: join them (depth 2 joins the items and their paragraphs).
    expect(canJoin(tr.doc, 7)).toBe(true);
    tr.join(7, 2);
    expect(tr.doc.eq(start)).toBe(true);
  });

  it("gives the new nodes the types after the split, and refuses types the parent forbids", () => {
    const start = doc(quote(p("ab")));
    const heading = { type: type("heading"), attrs: { level: 2 } };
    expect(canSplit(start, 3, 1, [heading])).toBe(true);
    const tr = new Transform(start).split(3, 1, [heading]);
    expect(
      tr.doc.eq(
        doc(
          quote(p("a"), {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "b" }],
          }),
        ),
      ),
    ).toBe(true);
    // A list item must start with a paragraph: a heading in its place is refused.
    const inList = doc(list(item(p("ab"))));
    expect(canSplit(inList, 4, 2, [null, heading])).toBe(false);
    expect(() => new Transform(inList).split(4, 2, [null, heading])).toThrow(TransformError);
  });

  it("rejects splits deeper than the position or that leave invalid content", () => {
    const start = doc(list(item(p("ab"))));
    expect(canSplit(start, 3, 3)).toBe(true); // the list itself: an empty first list is valid
    expect(canSplit(start, 3, 4)).toBe(false); // deeper than the position
    expect(() => new Transform(start).split(3, 9)).toThrow(TransformError);
    // A rule cannot be split, nor can a split leave text directly in a list.
    expect(canSplit(doc(rule, p("x")), 1, 1)).toBe(false);
  });

  it("joins two adjacent lists and refuses leaves and text", () => {
    const start = doc(list(item(p("a"))), list(item(p("b"))));
    expect(canJoin(start, 7)).toBe(true);
    expect(new Transform(start).join(7).doc.eq(doc(list(item(p("a")), item(p("b")))))).toBe(true);
    const withRule = doc(p("a"), rule);
    expect(canJoin(withRule, 3)).toBe(false);
    expect(() => new Transform(withRule).join(3)).toThrow(TransformError);
    expect(canJoin(start, 4)).toBe(false); // inside text
  });

  it("marks split and join steps as structure steps, which never delete content", () => {
    const start = doc(p("ab"), p("cd"));
    const tr = new Transform(start).join(4);
    const step = tr.steps[0] as ReplaceStep;
    expect(step.structure).toBe(true);
    // Mapped onto a document where text now sits in its range, it fails instead of deleting it.
    const other = doc(p("ab"), p("xy"), p("cd"));
    expect(new ReplaceStep(4, 8, Slice.empty, true).apply(other).failed).toMatch(/overwrite/);
  });
});

describe("ReplaceAroundStep", () => {
  const start = doc(p("ab"), p("cd"));
  const wrapper = new Slice(Fragment.from(type("blockquote").createOpen()), 0, 0);

  it("maps positions in the gap through, and outside it around the inserted tokens", () => {
    const step = new ReplaceAroundStep(0, 8, 0, 8, wrapper, 1, true);
    const map = step.getMap();
    expect([map.map(0, -1), map.map(1), map.map(8, -1), map.map(8, 1)]).toEqual([0, 2, 9, 10]);
  });

  it("fails on a gap that is not flat, content that does not fit, and overwritten content", () => {
    expect(new ReplaceAroundStep(0, 8, 1, 8, wrapper, 1).apply(start).failed).toMatch(/flat/);
    // A closed list cannot hold a paragraph: the gap does not fit.
    const listWrapper = new Slice(Fragment.from(type("bulletList").createOpen()), 0, 0);
    expect(new ReplaceAroundStep(0, 4, 0, 4, listWrapper, 1).apply(start).failed).toMatch(/fit/);
    // Structure: replacing 0..1 (a paragraph's opening token plus text) would overwrite text.
    expect(new ReplaceAroundStep(0, 8, 1, 7, wrapper, 1, true).apply(start).failed).toMatch(
      /overwrite|flat/,
    );
    expect(new ReplaceAroundStep(5, 3, 3, 3, wrapper, 1).apply(start).failed).toMatch(/Invalid/);
  });

  it("is dropped when mapped through a deletion around its whole range", () => {
    const three = doc(p("ab"), p("cd"), p("ef"));
    const step = new ReplaceAroundStep(4, 8, 4, 8, wrapper, 1, true); // wraps the middle one
    const deleted = new Transform(three).delete(2, 10);
    expect(step.map(deleted.mapping)).toBeNull();
  });
});

describe("NodeSelection", () => {
  const start = doc(p("a"), rule, p("b"));

  it("selects a selectable node and survives mapping, JSON and edits around it", () => {
    const sel = NodeSelection.create(start, 3);
    expect([sel.from, sel.to, sel.node.type.name]).toEqual([3, 4, "rule"]);
    const json = sel.toJSON();
    expect(json).toEqual({ type: "node", anchor: 3, head: 4 });
    expect(Selection.fromJSON(start, json).eq(sel)).toBe(true);
    const tr = new Transform(start).insertText("xy", 1);
    const mapped = sel.map(tr.doc, tr.mapping);
    expect(mapped).toBeInstanceOf(NodeSelection);
    expect(mapped.from).toBe(5);
  });

  it("becomes a text selection when its node is deleted, and refuses text", () => {
    const sel = NodeSelection.create(start, 3);
    const tr = new Transform(start).delete(3, 4);
    expect(sel.map(tr.doc, tr.mapping)).toBeInstanceOf(TextSelection);
    expect(() => NodeSelection.create(start, 1)).toThrow(RangeError);
    expect(Selection.fromJSON(start, { type: "node", anchor: 1, head: 2 })).toBeInstanceOf(
      TextSelection,
    );
  });

  it("deletes its node; an only child is replaced by an empty paragraph", () => {
    let state = EditorState.create({ doc: start });
    state = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, 3)).deleteSelection(),
    );
    expect(state.doc.eq(doc(p("a"), p("b")))).toBe(true);
    const lone = doc(quote(rule));
    let only = EditorState.create({ doc: lone });
    only = only.apply(only.tr.setSelection(NodeSelection.create(lone, 1)).deleteSelection());
    expect(only.doc.eq(doc(quote(p())))).toBe(true);
    expect(only.selection).toBeInstanceOf(TextSelection);
  });
});

describe("inclusive marks", () => {
  const link = { type: "link", attrs: { href: "x" } };
  const linked = doc({
    type: "paragraph",
    content: [
      { type: "text", text: "go", marks: [link] },
      { type: "text", text: " on" },
    ],
  });

  it("does not extend a non-inclusive mark at its end or start, but keeps it inside", () => {
    const names = (pos: number) => marksAt(linked.resolve(pos)).map((m) => m.type.name);
    expect(names(2)).toEqual(["link"]); // inside the link text
    expect(names(3)).toEqual([]); // right after it
    expect(names(1)).toEqual([]); // block start, before it
    // An inclusive mark (bold) at its end continues as before.
    const bold = doc({
      type: "paragraph",
      content: [{ type: "text", text: "b", marks: [{ type: "bold" }] }],
    });
    expect(marksAt(bold.resolve(2)).map((m) => m.type.name)).toEqual(["bold"]);
  });

  it("keeps a non-inclusive mark between two pieces that both have it", () => {
    const both = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "a", marks: [link] },
        { type: "hardBreak", marks: [link] },
        { type: "text", text: "b", marks: [link] },
      ],
    });
    expect(marksAt(both.resolve(2)).map((m) => m.type.name)).toEqual(["link"]);
  });
});

describe("review regressions (PR #33)", () => {
  it("a node selection does not move onto a child when its node's content is lifted out", () => {
    const start = doc(quote(p("ab"), p("cd")), p("z"));
    const sel = NodeSelection.create(start, 0);
    const tr = new Transform(start);
    const r = range(start, 3, 7);
    tr.lift(r, liftTarget(r) as number);
    expect(sel.map(tr.doc, tr.mapping)).toBeInstanceOf(TextSelection);
    // Content inserted inside a selected container keeps the selection on the container.
    const typed = new Transform(start).insertText("x", 3);
    const kept = sel.map(typed.doc, typed.mapping);
    expect(kept).toBeInstanceOf(NodeSelection);
    expect((kept as NodeSelection).node.type.name).toBe("blockquote");
  });

  it("canSplit refuses invalid attributes, and split throws a TransformError for them", () => {
    const start = doc(p("ab"));
    const bad = [{ type: type("heading"), attrs: { level: 5 } }];
    expect(canSplit(start, 2, 1, bad)).toBe(false);
    expect(() => new Transform(start).split(2, 1, bad)).toThrow(TransformError);
  });

  it("canSplit and split read typesAfter the same way (entry 0 is the outermost)", () => {
    const start = doc(list(item(p("ab"))));
    const asItem = [{ type: type("listItem") }];
    expect(canSplit(start, 4, 2, asItem)).toBe(true);
    expect(
      new Transform(start).split(4, 2, asItem).doc.eq(doc(list(item(p("a")), item(p("b"))))),
    ).toBe(true);
    const innerHeading = [null, { type: type("heading"), attrs: { level: 1 } }];
    expect(canSplit(start, 4, 2, innerHeading)).toBe(false);
    expect(() => new Transform(start).split(4, 2, innerHeading)).toThrow(TransformError);
  });

  it("drops a lift whose moved content was deleted, instead of splitting around nothing", () => {
    const start = doc(quote(p("ab"), p("cd"), p("ef")));
    const r = range(start, 6); // inside "cd"
    const lift = new Transform(start).lift(r, 0).steps[0] as ReplaceAroundStep;
    const deleted = new Transform(start).delete(5, 9); // the "cd" paragraph
    expect(lift.map(deleted.mapping)).toBeNull();
  });

  it("deleting the only item of a list does not apply (a list item is not a paragraph)", () => {
    const start = doc(list(item(p("a"))), p("z"));
    const state = EditorState.create({ doc: start });
    const tr = state.tr.setSelection(NodeSelection.create(start, 1));
    expect(() => tr.deleteSelection()).toThrow(TransformError);
  });
});
