import { describe, expect, it } from "vitest";
import {
  AddMarkStep,
  Fragment,
  Mapping,
  NodeMarkupBatchStep,
  NodeMarkupStep,
  ReplaceStep,
  Slice,
  StepMap,
  Transform,
  TransformError,
} from "../index.js";
import type { MarkType, NodeJSON, NodeType } from "../model/index.js";
import { schema } from "../schema.js";
import { testSchema } from "../testing/index.js";

const text = (t: string, ...marks: string[]): NodeJSON =>
  marks.length
    ? { type: "text", text: t, marks: marks.map((type) => ({ type })) }
    : { type: "text", text: t };
const para = (...content: (string | NodeJSON)[]): NodeJSON => ({
  type: "paragraph",
  ...(content.length ? { content: content.map((c) => (typeof c === "string" ? text(c) : c)) } : {}),
});
const nodeType = (name: string) => schema.nodes[name] as NodeType;
const doc = (...blocks: NodeJSON[]) => schema.nodeFromJSON({ type: "doc", content: blocks });

/** Applies every step's inverse in reverse order and checks the original comes back. */
function expectInvertible(tr: Transform): void {
  let current = tr.doc;
  for (let i = tr.steps.length - 1; i >= 0; i--) {
    const before = tr.docs[i];
    const result = tr.steps[i]?.invert(before as typeof current).apply(current);
    expect(result?.doc?.eq(before as typeof current)).toBe(true);
    current = result?.doc as typeof current;
  }
  expect(current.eq(tr.before)).toBe(true);
}

describe("StepMap", () => {
  const replace = new StepMap([2, 3, 1]); // 3 positions at 2 replaced by 1

  it("maps positions around and inside a replaced range", () => {
    expect(replace.map(1)).toBe(1);
    expect(replace.map(2)).toBe(2);
    expect(replace.map(5)).toBe(3);
    expect(replace.map(8)).toBe(6);
    expect(replace.mapResult(3)).toMatchObject({ pos: 3, deleted: true });
    expect(replace.mapResult(3, -1)).toMatchObject({ pos: 2, deleted: true });
  });

  it("uses association at insertions", () => {
    const insert = new StepMap([2, 0, 4]);
    expect(insert.map(2, -1)).toBe(2);
    expect(insert.map(2, 1)).toBe(6);
  });

  it("inverts", () => {
    for (const pos of [0, 1, 2, 5, 8]) expect(replace.invert().map(replace.map(pos))).toBe(pos);
    expect(replace.invert().map(6)).toBe(8);
  });

  it("recovers positions through mirrored maps", () => {
    const plain = new Mapping([new StepMap([2, 4, 0]), new StepMap([2, 0, 4])]);
    expect(plain.map(4)).toBe(6);
    const mirrored = new Mapping();
    mirrored.appendMap(new StepMap([2, 4, 0]));
    mirrored.appendMap(new StepMap([2, 0, 4]), 0);
    for (const pos of [0, 3, 4, 5, 9]) expect(mirrored.map(pos)).toBe(pos);
  });
});

describe("steps", () => {
  it("replace inserts, maps and inverts", () => {
    const before = doc(para("abc"));
    const step = new ReplaceStep(2, 3, new Slice(Fragment.from(schema.text("XY")), 0, 0));
    const after = step.apply(before).doc;
    expect(after?.toJSON()).toEqual(doc(para("aXYc")).toJSON());
    expect(step.getMap().map(3)).toBe(4);
    expect(
      step
        .invert(before)
        .apply(after as typeof before)
        .doc?.eq(before),
    ).toBe(true);
  });

  it("fails instead of breaking the schema, leaving the transform untouched", () => {
    const tr = new Transform(doc(para("abc")));
    expect(() => tr.insert(0, schema.text("x"))).toThrow(TransformError);
    expect(tr.steps).toHaveLength(0);
    expect(tr.doc.eq(tr.before)).toBe(true);
  });

  it("drops a replace step whose range was deleted by the mapping", () => {
    const step = new ReplaceStep(3, 4, Slice.empty);
    expect(step.map(new StepMap([1, 6, 0]))).toBeNull();
    expect(step.map(new StepMap([0, 0, 2]))).toMatchObject({ from: 5, to: 6 });
  });

  it("node markup keeps inner positions and validates attrs", () => {
    const before = doc(para("abc"));
    const step = new NodeMarkupStep(0, nodeType("heading"), { level: 2 });
    const after = step.apply(before).doc;
    expect(after?.firstChild?.type.name).toBe("heading");
    expect(step.getMap().map(2)).toBe(2);
    expect(
      step
        .invert(before)
        .apply(after as typeof before)
        .doc?.eq(before),
    ).toBe(true);
    expect(new NodeMarkupStep(0, nodeType("heading"), { level: 9 }).apply(before).failed).toMatch(
      /level/,
    );
    expect(new NodeMarkupStep(2, nodeType("heading"), { level: 1 }).apply(before).failed).toMatch(
      /No node/,
    );
  });

  it("mark steps change only inline content and invert", () => {
    const before = doc(para("ab"), para("cd"));
    const step = new AddMarkStep(2, 6, schema.mark("bold"));
    const after = step.apply(before).doc;
    expect(after?.toJSON()).toEqual(
      doc(para("a", text("b", "bold")), para(text("c", "bold"), "d")).toJSON(),
    );
    expect(
      step
        .invert()
        .apply(after as typeof before)
        .doc?.eq(before),
    ).toBe(true);
    expect(new AddMarkStep(3, 3, schema.mark("bold")).apply(before).failed).toBeTruthy();
  });
});

describe("Transform helpers", () => {
  it("addMark skips text that already has the mark, so it inverts exactly", () => {
    const tr = new Transform(doc(para("a", text("b", "bold"), "c")));
    tr.addMark(1, 4, schema.mark("bold"));
    expect(tr.doc.toJSON()).toEqual(doc(para(text("abc", "bold"))).toJSON());
    expect(tr.steps).toHaveLength(2);
    expectInvertible(tr);
  });

  it("addMark removes marks the new mark excludes", () => {
    const start = testSchema.nodeFromJSON({
      type: "doc",
      content: [para(text("ab", "bold", "italic"))],
    });
    const tr = new Transform(start).addMark(1, 3, testSchema.mark("code"));
    expect(tr.doc.toJSON()).toEqual({ type: "doc", content: [para(text("ab", "code"))] });
    expectInvertible(tr);
  });

  it("removeMark by type across nodes", () => {
    const tr = new Transform(doc(para(text("ab", "bold"), text("cd", "bold", "italic"))));
    tr.removeMark(1, 5, schema.marks.bold as MarkType);
    expect(tr.doc.toJSON()).toEqual(doc(para("ab", text("cd", "italic"))).toJSON());
    expectInvertible(tr);
  });

  it("splits and joins textblocks", () => {
    const tr = new Transform(doc(para("abcd"))).split(3);
    expect(tr.doc.toJSON()).toEqual(doc(para("ab"), para("cd")).toJSON());
    tr.join(4);
    expect(tr.doc.toJSON()).toEqual(doc(para("abcd")).toJSON());
    expectInvertible(tr);
  });

  it("split can start a different block type", () => {
    const tr = new Transform(
      schema.nodeFromJSON({
        type: "doc",
        content: [{ type: "heading", attrs: { level: 1 }, content: [text("T")] }],
      }),
    );
    tr.split(2, { type: nodeType("paragraph") });
    expect(tr.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("T")] },
        { type: "paragraph" },
      ],
    });
  });

  it("deletes across textblocks by joining them", () => {
    const tr = new Transform(doc(para("abc"), para("def"))).delete(2, 7);
    expect(tr.doc.toJSON()).toEqual(doc(para("aef")).toJSON());
    expectInvertible(tr);
  });

  it("setBlockType changes every textblock in range", () => {
    const tr = new Transform(doc(para("a"), para("b"), para("c")));
    tr.setBlockType(2, 5, nodeType("heading"), { level: 3 });
    expect(tr.doc.toJSON().content?.map((n) => n.type)).toEqual([
      "heading",
      "heading",
      "paragraph",
    ]);
    expect(tr.mapping.map(5)).toBe(5);
    expectInvertible(tr);
  });
});

describe("review regressions (PR #4)", () => {
  it("merges consecutive typing and deletion steps", () => {
    const typedB = new ReplaceStep(2, 3, Slice.empty); // inverse of typing "b" at 2
    const typedA = new ReplaceStep(1, 2, Slice.empty); // inverse of typing "a" at 1
    expect(typedB.merge(typedA)).toMatchObject({ from: 1, to: 3 });
    const a = new Slice(Fragment.from(schema.text("a")), 0, 0);
    const b = new Slice(Fragment.from(schema.text("b")), 0, 0);
    const merged = new ReplaceStep(1, 1, a).merge(new ReplaceStep(2, 2, b));
    expect(merged?.apply(doc(para("xy"))).doc?.toJSON()).toEqual(doc(para("abxy")).toJSON());
    expect(new ReplaceStep(1, 1, a).merge(new ReplaceStep(5, 5, b))).toBeNull();
  });

  it("drops a node markup step whose node was deleted from its start, including leaf nodes", () => {
    const blocks = new NodeMarkupStep(3, nodeType("paragraph"), null);
    expect(blocks.map(new StepMap([3, 3, 0]))).toBeNull(); // the block at 3 deleted
    expect(blocks.map(new StepMap([4, 1, 0]))).toMatchObject({ pos: 3 }); // only its text changed
    const rule = new NodeMarkupStep(3, testSchema.nodes.rule as NodeType, null);
    expect(rule.map(new StepMap([3, 1, 0]))).toBeNull();
    expect(rule.map(new StepMap([0, 0, 2]))).toMatchObject({ pos: 5 });
  });

  it("recovers a range start edge through mirrored maps", () => {
    const mirrored = new Mapping();
    mirrored.appendMap(new StepMap([1, 1, 0])); // removes [1,2]
    mirrored.appendMap(new StepMap([0, 0, 3])); // unrelated insertion
    mirrored.appendMap(new StepMap([4, 0, 1]), 0); // re-inserts it, shifted by 3
    expect(mirrored.map(1, 1)).toBe(4); // before the re-inserted content, not after it
  });
});

describe("post-merge review of PR #4", () => {
  it("join refuses positions that are not between two textblocks", () => {
    const start = doc(para("abcd"), para("ef"));
    expect(() => new Transform(start).join(3)).toThrow(TransformError); // inside text
    expect(() => new Transform(start).join(0)).toThrow(TransformError); // document edge
    expect(new Transform(start).join(6).doc.toJSON()).toEqual(doc(para("abcdef")).toJSON());
    const withRule = testSchema.nodeFromJSON({
      type: "doc",
      content: [para("a"), { type: "rule" }],
    });
    expect(() => new Transform(withRule).join(3)).toThrow(TransformError); // next to a leaf block
  });

  it("addMark records nothing when an existing mark excludes the new one", () => {
    const start = testSchema.nodeFromJSON({ type: "doc", content: [para(text("ab", "code"))] });
    const tr = new Transform(start).addMark(1, 3, testSchema.mark("bold"));
    expect(tr.steps).toHaveLength(0);
  });

  it("StepMap.side tells which side of the changed range a position is on", () => {
    const map = new StepMap([3, 2, 0]); // deletes 3..5
    expect([map.side(1), map.side(3), map.side(4), map.side(5), map.side(9)]).toEqual([
      -1, -1, 0, 1, 1,
    ]);
    expect(StepMap.empty.side(4)).toBe(0);
  });
});

describe("NodeMarkupBatchStep", () => {
  const quote = (...content: NodeJSON[]): NodeJSON => ({ type: "blockquote", content });
  const tdoc = (...blocks: NodeJSON[]) => testSchema.nodeFromJSON({ type: "doc", content: blocks });
  const heading = testSchema.nodes.heading as NodeType;

  it("setBlockType emits one step that keeps positions and changes nested textblocks", () => {
    const start = tdoc(para("a"), quote(para("b"), para("c")), para("d"));
    const tr = new Transform(start).setBlockType(0, start.content.size, heading, { level: 2 });
    expect(tr.steps).toHaveLength(1);
    expect(tr.steps[0]).toBeInstanceOf(NodeMarkupBatchStep);
    const types: string[] = [];
    tr.doc.descendants((node) => {
      if (node.isTextblock) types.push(node.type.name);
    });
    expect(types).toEqual(["heading", "heading", "heading", "heading"]);
    expect(tr.mapping.map(5)).toBe(5);
    expectInvertible(tr);
  });

  it("fails on positions that are not node starts, unsorted, or break the schema", () => {
    const start = doc(para("ab"), para("c"));
    const p = nodeType("paragraph");
    const batch = (...pos: number[]) =>
      new NodeMarkupBatchStep(pos.map((at) => new NodeMarkupStep(at, p, null)));
    expect(batch(0, 4).apply(start).doc).not.toBeNull();
    expect(batch(2).apply(start).failed).toMatch(/No node/); // inside text
    expect(batch(7).apply(start).failed).toMatch(/No node/); // end of document
    expect(batch(4, 0).apply(start).failed).toMatch(/Unsorted/);
    const level9 = new NodeMarkupBatchStep([
      new NodeMarkupStep(0, nodeType("heading"), { level: 9 }),
    ]);
    expect(level9.apply(start).failed).not.toBeNull();
    const text = new NodeMarkupBatchStep([new NodeMarkupStep(1, p, null)]);
    expect(text.apply(start).failed).not.toBeNull(); // a text node
  });

  it("maps like its single steps, dropping blocks that were deleted", () => {
    const p = nodeType("paragraph");
    const batch = new NodeMarkupBatchStep([
      new NodeMarkupStep(0, p, null),
      new NodeMarkupStep(4, p, null),
    ]);
    expect(batch.map(new StepMap([0, 4, 0]))).toMatchObject({ steps: [{ pos: 0 }] });
    expect(batch.map(new StepMap([0, 0, 2]))).toMatchObject({ steps: [{ pos: 2 }, { pos: 6 }] });
    expect(batch.map(new StepMap([0, 7, 0]))).toBeNull();
  });
});
