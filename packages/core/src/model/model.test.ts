import { describe, expect, it } from "vitest";
import { testSchema as s } from "../testing/index.js";
import {
  FoliDocumentError,
  Fragment,
  Mark,
  type Node,
  type NodeJSON,
  ReplaceError,
  Schema,
  Slice,
} from "./index.js";

const bold = s.mark("bold");
const italic = s.mark("italic");
const code = s.mark("code");
const link = (href: string) => s.mark("link", { href });
const p = (...content: Node[]) => s.node("paragraph", null, content);
const doc = (...content: Node[]) => s.node("doc", null, content);
const quote = (...content: Node[]) => s.node("blockquote", null, content);
const t = (text: string, ...marks: Mark[]) => s.text(text, marks);
const br = () => s.node("hardBreak");

// <p>ab<b>cd</b></p><blockquote><p>ef</p></blockquote>
// positions: 0 <p> 1 a 2 b 3 c 4 d 5 </p> 6 <bq> 7 <p> 8 e 9 f 10 </p> 11 </bq> 12
const sample = doc(p(t("ab"), t("cd", bold)), quote(p(t("ef"))));

describe("Schema", () => {
  it("requires a text type and a top node", () => {
    expect(() => new Schema({ nodes: { doc: { content: "text*" } } })).toThrow(/text/);
    expect(() => new Schema({ nodes: { text: {} } })).toThrow(/top node/);
    expect(
      () => new Schema({ nodes: { root: { content: "text*" }, text: {} }, topNode: "root" }),
    ).not.toThrow();
  });

  it.each([
    ["unknown name", "nope+"],
    ["unclosed choice", "(text | text"],
    ["dangling operator", "*"],
    ["mixed inline and block", "text para"],
  ])("rejects a content expression with %s", (_label, content) => {
    expect(
      () => new Schema({ nodes: { doc: { content }, para: { content: "text*" }, text: {} } }),
    ).toThrow();
  });

  it("rejects unknown marks in `marks` and `excludes`", () => {
    const nodes = { doc: { content: "text*", marks: "nope" }, text: {} };
    expect(() => new Schema({ nodes })).toThrow(/nope/);
    expect(
      () =>
        new Schema({
          nodes: { doc: { content: "text*" }, text: {} },
          marks: { a: { excludes: "b" } },
        }),
    ).toThrow(/b/);
  });

  it("matches sequences, choices and quantifiers", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "title (para | quote)+ note?" },
        title: { content: "text*" },
        para: { content: "text*", group: "body" },
        quote: { content: "para*", group: "body" },
        note: { content: "text*" },
        text: {},
      },
    });
    const n = (name: string) => schema.node(name);
    const valid = (...names: string[]) =>
      schema.nodes.doc?.validContent(Fragment.from(names.map(n)));
    expect(valid("title", "para")).toBe(true);
    expect(valid("title", "quote", "para", "note")).toBe(true);
    expect(valid("title")).toBe(false);
    expect(valid("para")).toBe(false);
    expect(valid("title", "para", "note", "note")).toBe(false);
    expect(String(schema.nodes.doc?.contentMatch)).toBe("title (para | quote)+ note?");
    expect(schema.nodes.quote?.contentMatch.inlineContent).toBe(false);
    expect(schema.nodes.title?.isTextblock).toBe(true);
  });

  it("restricts marks per parent and supports mark groups", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "line+" },
        line: { content: "text*", marks: "style" },
        plain: { content: "text*", marks: "" },
        text: {},
      },
      marks: { b: { group: "style" }, i: { group: "style" }, link: {} },
    });
    const b = schema.mark("b");
    const linkMark = schema.mark("link");
    expect(schema.nodes.line?.allowsMarks([b])).toBe(true);
    expect(schema.nodes.line?.allowsMarks([linkMark])).toBe(false);
    expect(schema.nodes.plain?.allowsMarkType(b.type)).toBe(false);
    expect(() => schema.node("line", null, schema.text("x", [linkMark]))).toThrow(
      FoliDocumentError,
    );
    expect(schema.nodes.doc?.allowsMarks([b])).toBe(false);
  });

  it("creates nodes and marks by name or type, validating attrs and content", () => {
    const heading = s.nodes.heading;
    expect(s.node("heading").attrs).toEqual({ level: 1 });
    expect(heading && s.node(heading, { level: 2 }).attrs).toEqual({ level: 2 });
    expect(() => s.node("heading", { level: 3 })).toThrow(
      "heading.attrs.level: level must be 1 or 2",
    );
    expect(() => s.node("heading", { size: 1 })).toThrow("heading.attrs.size: unknown attribute");
    expect(() => s.node("paragraph", { x: 1 })).toThrow("unknown attribute");
    expect(() => s.mark("link")).toThrow("link.attrs.href: required attribute is missing");
    expect(() => s.mark("nope")).toThrow(RangeError);
    expect(() => s.node("nope")).toThrow(RangeError);
    expect(() => s.node("text")).toThrow(RangeError);
    expect(() => s.text("")).toThrow(RangeError);
    expect(() => s.node("doc")).toThrow(FoliDocumentError);
    expect(() => s.node("rule", null, [t("x")])).toThrow(FoliDocumentError);
    const linkType = s.markType("link");
    expect(linkType && s.mark(linkType, { href: "x" }).attrs).toEqual({ href: "x" });
    expect(s.mark("bold")).toBe(bold);
    expect(s.nodeType("nope")).toBeUndefined();
  });
});

describe("Mark", () => {
  it("keeps sets canonical and applies exclusion", () => {
    expect(bold.addToSet([italic])).toEqual([bold, italic]);
    expect(italic.addToSet([bold])).toEqual([bold, italic]);
    const set = [bold];
    expect(bold.addToSet(set)).toBe(set);
    expect(link("b").addToSet([bold, link("a")])).toEqual([bold, link("b")]);
    expect(code.addToSet([bold, italic])).toEqual([code]);
    expect(bold.addToSet([code])).toEqual([code]);
    expect(bold.removeFromSet([bold, italic])).toEqual([italic]);
    const plain = [italic];
    expect(bold.removeFromSet(plain)).toBe(plain);
    expect(bold.isInSet([italic])).toBe(false);
    expect(Mark.sameSet([bold, italic], [bold, italic])).toBe(true);
    expect(Mark.sameSet([bold], [italic])).toBe(false);
    expect(Mark.setFrom()).toBe(Mark.none);
    expect(Mark.setFrom(bold)).toEqual([bold]);
    expect(Mark.setFrom([italic, bold])).toEqual([bold, italic]);
    expect(bold.type.isInSet([italic, bold])).toBe(bold);
    expect(bold.type.removeFromSet([bold, italic])).toEqual([italic]);
    expect(link("a").eq(link("a"))).toBe(true);
    expect(link("a").toJSON()).toEqual({ type: "link", attrs: { href: "a" } });
  });
});

describe("Fragment and Node", () => {
  it("merges adjacent text with equal marks", () => {
    const merged = Fragment.from([t("a"), t("b"), t("c", bold), t("d", bold)]);
    expect(merged.childCount).toBe(2);
    expect(merged.size).toBe(4);
    expect(Fragment.from(t("a")).childCount).toBe(1);
    expect(Fragment.from(merged)).toBe(merged);
    expect(Fragment.from(null)).toBe(Fragment.empty);
    expect(Fragment.from([t("a")]).append(Fragment.from([t("b")])).childCount).toBe(1);
    expect(merged.append(Fragment.empty)).toBe(merged);
    expect(Fragment.empty.append(merged)).toBe(merged);
  });

  it("navigates children and text", () => {
    expect(sample.childCount).toBe(2);
    expect(sample.firstChild?.type.name).toBe("paragraph");
    expect(sample.lastChild?.type.name).toBe("blockquote");
    expect(sample.maybeChild(5)).toBeNull();
    expect(() => sample.child(5)).toThrow(RangeError);
    expect(Fragment.empty.firstChild).toBeNull();
    expect(Fragment.empty.lastChild).toBeNull();
    expect(sample.textContent).toBe("abcdef");
    expect(sample.textBetween(0, sample.content.size, "|")).toBe("abcd|ef");
    expect(p(t("a"), br(), t("b")).textBetween(0, 4, "", "\n")).toBe("a\nb");
    expect(sample.isBlock && !sample.isInline && !sample.isLeaf && !sample.isText).toBe(true);
    const offsets: number[] = [];
    sample.forEach((_node, offset) => {
      offsets.push(offset);
    });
    expect(offsets).toEqual([0, 6]);
    const seen: string[] = [];
    sample.descendants((node, pos) => {
      seen.push(`${node.type.name}@${pos}`);
      return node.type.name !== "blockquote" ? undefined : false;
    });
    expect(seen).toEqual(["paragraph@0", "text@1", "text@3", "blockquote@6"]);
    expect(String(sample)).toBe('doc(paragraph("ab", bold"cd"), blockquote(paragraph("ef")))');
    expect(String(sample.content)).toContain("blockquote");
  });

  it("finds nodes at positions", () => {
    expect(sample.nodeAt(0)?.type.name).toBe("paragraph");
    expect(sample.nodeAt(2)?.textContent).toBe("ab");
    expect(sample.nodeAt(3)?.textContent).toBe("cd");
    expect(sample.nodeAt(7)?.type.name).toBe("paragraph");
    expect(sample.nodeAt(5)).toBeNull();
    expect(sample.nodeAt(12)).toBeNull();
    expect(() => sample.content.findIndex(13)).toThrow(RangeError);
  });

  it("compares, copies, marks and cuts without needless allocation", () => {
    const same = doc(p(t("ab"), t("cd", bold)), quote(p(t("ef"))));
    expect(sample.eq(same)).toBe(true);
    expect(sample.eq(doc(p(t("ab"))))).toBe(false);
    expect(p(t("a")).eq(p(t("b")))).toBe(false);
    expect(sample.copy(sample.content)).toBe(sample);
    expect(sample.cut(0)).toBe(sample);
    const text = t("abc");
    expect(text.cut()).toBe(text);
    expect(text.cut(1, 2).text).toBe("b");
    expect(text.withText("abc")).toBe(text);
    expect(text.mark(Mark.none)).toBe(text);
    expect(text.mark([bold]).marks).toEqual([bold]);
    const para = p();
    expect(para.mark(Mark.none)).toBe(para);
    expect(para.mark([bold]).marks).toEqual([bold]);
    expect(Fragment.from([t("a")]).replaceChild(0, t("b")).size).toBe(1);
    const frag = sample.content;
    expect(frag.replaceChild(0, frag.child(0))).toBe(frag);
    expect(frag.cut(3, 3)).toBe(Fragment.empty);
  });

  it("serializes with a fixed key order and omits empty parts", () => {
    const heading = s.node("heading", { level: 2 }, [t("x", italic, bold)]);
    expect(JSON.stringify(heading.toJSON())).toBe(
      '{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"x","marks":[{"type":"bold"},{"type":"italic"}]}]}',
    );
    expect(p().toJSON()).toEqual({ type: "paragraph" });
    expect(s.node("hardBreak", null, null, [bold]).toJSON()).toEqual({
      type: "hardBreak",
      marks: [{ type: "bold" }],
    });
  });

  it("check() reports invalid trees built without validation", () => {
    expect(() => sample.check()).not.toThrow();
    expect(() => sample.copy(Fragment.empty).check()).toThrow(FoliDocumentError);
  });
});

describe("ResolvedPos", () => {
  it("resolves inside text, between nodes and in nested blocks", () => {
    const $text = sample.resolve(3);
    expect([$text.depth, $text.parentOffset, $text.textOffset]).toEqual([1, 2, 0]);
    expect($text.nodeBefore?.text).toBe("ab");
    expect($text.nodeAfter?.text).toBe("cd");
    const $mid = sample.resolve(2);
    expect($mid.textOffset).toBe(1);
    expect($mid.nodeBefore?.text).toBe("a");
    expect($mid.nodeAfter?.text).toBe("b");
    expect($mid.indexAfter()).toBe(1);
    expect($mid.indexAfter(0)).toBe(1);
    const $deep = sample.resolve(8);
    expect($deep.depth).toBe(2);
    expect($deep.node(-1).type.name).toBe("blockquote");
    expect($deep.before(-1)).toBe(6);
    expect($deep.after(-1)).toBe(12);
    expect($deep.sharedDepth(9)).toBe(2);
    expect($deep.sharedDepth(1)).toBe(0);
    expect($deep.sameParent(sample.resolve(10))).toBe(true);
    expect($deep.sameParent(sample.resolve(1))).toBe(false);
    expect(String($deep)).toBe("blockquote_1/paragraph_0:0");
    expect(sample.resolve(0).nodeBefore).toBeNull();
    expect(sample.resolve(12).nodeAfter).toBeNull();
  });

  it("rejects bad positions and depths", () => {
    expect(() => sample.resolve(-1)).toThrow(RangeError);
    expect(() => sample.resolve(13)).toThrow(RangeError);
    expect(() => sample.resolve(1.5)).toThrow(RangeError);
    const $pos = sample.resolve(1);
    expect(() => $pos.before(0)).toThrow(RangeError);
    expect(() => $pos.after(0)).toThrow(RangeError);
    expect(() => $pos.node(5)).toThrow(RangeError);
    expect(() => $pos.node(-5)).toThrow(RangeError);
  });
});

describe("Slice and replace", () => {
  it("slices open across blocks and replaces with joining", () => {
    const slice = sample.slice(2, 9);
    expect([slice.openStart, slice.openEnd, slice.size]).toEqual([1, 2, 7]);
    expect(sample.slice(4, 4)).toBe(Slice.empty);
    expect(
      doc(p(t("ab")), p(t("cd")))
        .replace(2, 6, Slice.empty)
        .toString(),
    ).toBe('doc(paragraph("ad"))');
    const inserted = sample.replace(1, 1, new Slice(Fragment.from(t("X")), 0, 0));
    expect(inserted.textContent).toBe("Xabcdef");
    expect(sample.replace(0, 0, new Slice(Fragment.from(p(t("new"))), 0, 0)).childCount).toBe(3);
  });

  it("rejects reversed ranges", () => {
    expect(() => sample.slice(6, 2)).toThrow(RangeError);
    expect(() => sample.replace(6, 2, Slice.empty)).toThrow(RangeError);
  });

  it("throws ReplaceError for replaces the schema forbids", () => {
    const deep = new Slice(Fragment.from(p(t("x"))), 1, 1);
    expect(() => sample.replace(0, 0, deep)).toThrow(ReplaceError); // deeper than position
    expect(() => sample.replace(1, 1, new Slice(Fragment.from(p(t("x"))), 1, 0))).toThrow(
      ReplaceError,
    ); // inconsistent depths
    expect(() => sample.replace(0, 12, Slice.empty)).toThrow(ReplaceError); // empty doc
    expect(() => sample.replace(1, 1, new Slice(Fragment.from(p()), 0, 0))).toThrow(ReplaceError); // block in paragraph
    // A paragraph cannot be joined with a blockquote.
    expect(() => doc(p(t("a")), quote(p(t("b")))).replace(2, 4, Slice.empty)).toThrow(
      "Cannot join blockquote onto paragraph",
    );
  });
});

describe("JSON in", () => {
  const parse = (json: unknown) => s.nodeFromJSON(json, "content");
  const inPara = (inline: unknown) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [inline] }],
  });

  it.each<[string, unknown, string]>([
    ["non-object", 1, "content: expected an object"],
    ["unknown type", { type: "x" }, 'content.type: unknown node type "x"'],
    ["missing type", {}, "content.type: unknown node type undefined"],
    ["prototype key as type", { type: "constructor" }, "unknown node type"],
    ["text with attrs", inPara({ type: "text", text: "a", attrs: {} }), "[0].attrs: text nodes"],
    [
      "text with content",
      inPara({ type: "text", text: "a", content: [] }),
      "[0].content: text nodes",
    ],
    ["text on a block", { type: "paragraph", text: "a" }, "content.text: only text nodes"],
    [
      "content on a leaf",
      { type: "rule", content: [] },
      "content.content: rule cannot have content",
    ],
    ["non-array content", { type: "doc", content: {} }, "content.content: expected an array"],
    ["attrs not an object", { type: "heading", attrs: [] }, "content.attrs: expected an object"],
    [
      "bad attr",
      { type: "heading", attrs: { level: 9 } },
      "content.attrs.level: level must be 1 or 2",
    ],
    [
      "marks not an array",
      inPara({ type: "text", text: "a", marks: {} }),
      "[0].marks: expected an array",
    ],
    [
      "mark attrs on plain mark",
      inPara({ type: "text", text: "a", marks: [{ type: "bold", attrs: {} }] }),
      "marks[0].attrs: bold has no attributes",
    ],
    [
      "mark missing attr",
      inPara({ type: "text", text: "a", marks: [{ type: "link" }] }),
      "marks[0].attrs.href: required",
    ],
    [
      "mark exclusion",
      inPara({ type: "text", text: "a", marks: [{ type: "bold" }, { type: "code" }] }),
      "marks[1]: code cannot be combined with bold",
    ],
    [
      "marks on a block",
      { type: "doc", content: [{ type: "paragraph", marks: [{ type: "bold" }] }] },
      "content.content[0].marks: marks not allowed in doc",
    ],
    [
      "incomplete content",
      { type: "blockquote", content: [] },
      'content.content: blockquote content is incomplete (expected "block+")',
    ],
  ])("rejects %s", (_label, json, message) => {
    expect(() => parse(json)).toThrow(FoliDocumentError);
    expect(() => parse(json)).toThrow(message);
  });

  it("normalizes mark order, adjacent text and empty content", () => {
    const json: NodeJSON = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "italic" }, { type: "bold" }] },
            { type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] },
            { type: "text", text: "c", marks: [] },
          ],
        },
        { type: "paragraph", content: [] },
      ],
    };
    expect(parse(json).toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ab", marks: [{ type: "bold" }, { type: "italic" }] },
            { type: "text", text: "c" },
          ],
        },
        { type: "paragraph" },
      ],
    });
    expect(s.markFromJSON({ type: "link", attrs: { href: "x" } }).eq(link("x"))).toBe(true);
  });

  it("parses slices strictly, allowing incomplete open nodes", () => {
    const open = { content: [{ type: "blockquote" }], openStart: 1, openEnd: 1 };
    expect(s.sliceFromJSON(open).content.firstChild?.type.name).toBe("blockquote");
    expect(s.sliceFromJSON({ content: [], openStart: 0, openEnd: 0 }).eq(Slice.empty)).toBe(true);
    const bad: [unknown, string][] = [
      [[], "$: expected an object"],
      [{ content: [], openStart: 0, openEnd: 0, x: 1 }, "$.x: unknown key"],
      [{ content: [], openStart: -1, openEnd: 0 }, "$.openStart"],
      [{ content: [], openStart: 0, openEnd: 0.5 }, "$.openEnd"],
      [{ content: [], openStart: 1, openEnd: 0 }, "an empty slice cannot be open"],
      [{ content: [{ type: "rule" }], openStart: 1, openEnd: 0 }, "a leaf node cannot be open"],
      [{ content: [{ type: "blockquote" }], openStart: 2, openEnd: 0 }, "open depth exceeds"],
      [{ content: [{ type: "blockquote", content: [] }], openStart: 0, openEnd: 0 }, "incomplete"],
    ];
    for (const [json, message] of bad) expect(() => s.sliceFromJSON(json)).toThrow(message);
  });
});
