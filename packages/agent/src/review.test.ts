import { rejectAllChanges, trackedChanges } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { type Block, openSession, type Session } from "./index.js";
import { corpus } from "./testing/corpus.js";

const open = async (name = "01-mutual-nda") =>
  openSession((await corpus(name)).document, { author: "Agent" });
const blocks = (session: Session) => {
  const result = session.read();
  if (!result.ok) throw new Error(result.message);
  return result.blocks;
};
const starting = (all: readonly Block[], start: string) => {
  const block = all.find((b) => b.text.startsWith(start));
  if (!block) throw new Error(`no block starts with ${start}`);
  return block;
};

describe("styles and setStyle", () => {
  it("lists the paragraph styles by the names read shows", async () => {
    const session = await open();
    const styles = session.styles();
    expect(styles).toEqual(expect.arrayContaining(["Normal", "heading 1", "Clause", "Sub-clause"]));
    for (const block of blocks(session))
      if (block.kind === "paragraph") expect(styles).toContain(block.style);
  });

  it("puts a paragraph in a style as a tracked formatting change", async () => {
    const session = await open();
    const original = blocks(session);
    const parties = starting(original, "each a");
    const result = session.setStyle(parties.handle, "clause");
    expect(result.ok && result.blocks[0]).toMatchObject({
      handle: parties.handle,
      style: "Clause",
      number: "1.1",
      changed: true,
    });
    expect(result.ok && result.text).toBe(
      `[${parties.handle}] Clause, 1.1, changed: each a "Party" and together the "Parties".`,
    );
    const changes = trackedChanges(session.editor.state.doc);
    expect(changes).toMatchObject([{ kind: "paragraphFormatting", author: "Agent" }]);
    session.editor.run(rejectAllChanges("Agent"));
    expect(blocks(session)).toEqual(original);
  });

  it("changes nothing when the paragraph is in the style already", async () => {
    const session = await open();
    const title = blocks(session)[0] as Block;
    expect(session.setStyle(title.handle, "Title")).toMatchObject({
      ok: true,
      blocks: [{ style: "Title", changed: false }],
    });
    expect(trackedChanges(session.editor.state.doc)).toHaveLength(0);
  });

  it("restyles in a table's cell, and refuses a table, an unknown style and a block that is gone", async () => {
    const session = await open("06-price-schedule");
    const all = blocks(session);
    const cell = starting(all, "Category");
    expect(session.setStyle(cell.handle, "Heading 3")).toMatchObject({
      ok: true,
      blocks: [{ style: "heading 3", cell: cell.cell }],
    });
    const table = all.find((b) => b.kind === "table") as Block;
    expect(session.setStyle(table.handle, "Normal")).toMatchObject({ code: "not-a-paragraph" });
    const unknown = session.setStyle(cell.handle, "Fancy");
    expect(unknown).toMatchObject({ ok: false, code: "unknown-style" });
    expect(!unknown.ok && unknown.message).toContain("heading 1");
    expect(session.setStyle("b9999", "Normal")).toMatchObject({ code: "unknown-handle" });
    session.deleteBlock(all[0]?.handle as string);
    expect(session.setStyle(all[0]?.handle as string, "Normal")).toMatchObject({ code: "gone" });
  });
});

describe("setStyle and the document's rules", () => {
  it("refuses a paragraph in a locked content control, and restyles one that only holds one", async () => {
    const { document } = await corpus("03-offer-letter-template");
    const controls = Object.fromEntries(
      Object.entries(document.controls ?? {}).map(([id, control]) => [
        id,
        { ...control, lock: "sdtContentLocked" as const },
      ]),
    );
    const session = openSession({ ...document, controls }, { author: "Agent" });
    const all = blocks(session);
    const benefits = starting(all, "Private health insurance");
    const refused = session.setStyle(benefits.handle, "Heading 1");
    expect(refused).toMatchObject({ ok: false, code: "read-only" });
    expect(!refused.ok && refused.message).toContain("Benefits");
    expect(session.block(benefits.handle)).toMatchObject({
      block: { style: "Normal", changed: false },
    });
    const remote = all.find((b) => b.text.includes("Remote working")) as Block;
    expect(session.setStyle(remote.handle, "Heading 1")).toMatchObject({
      ok: true,
      blocks: [{ style: "heading 1", changed: true }],
    });
  });

  it("adds a built-in heading the document does not have", async () => {
    const { document } = await corpus("01-mutual-nda");
    const styles = document.styles.filter((s) => !/^Heading[2-9]$/.test(s.id));
    const session = openSession({ ...document, styles }, { author: "Agent" });
    const original = blocks(session);
    expect(session.styles().map((s) => s.toLowerCase())).toContain("heading 3");
    const parties = starting(original, "each a");
    const result = session.setStyle(parties.handle, "Heading 3");
    expect(result.ok && result.blocks[0]?.changed).toBe(true);
    expect(result.ok && result.blocks[0]?.style?.toLowerCase()).toBe("heading 3");
    expect(session.editor.getDocument().styles.some((s) => s.id === "Heading3")).toBe(true);
    session.editor.run(rejectAllChanges("Agent"));
    expect(blocks(session)).toEqual(original);
  });
});

describe("comment", () => {
  it("comments a whole block in the author's name", async () => {
    const session = await open();
    const original = blocks(session);
    const term = starting(original, "This Agreement continues");
    const result = session.comment(term.handle, "Three years is short.\nAsk for five.");
    expect(result).toMatchObject({ ok: true, blocks: [{ handle: term.handle, comments: 1 }] });
    if (!result.ok) return;
    expect(result.text).toContain("Clause, 3.1, 1 comment: This Agreement continues");
    const made = session.editor.getDocument().comments.find((c) => c.id === result.comment);
    expect(made).toMatchObject({ author: "Agent", initials: "A" });
    expect(JSON.stringify(made?.content)).toContain("Three years is short.");
    expect(made?.content).toHaveLength(2);
    // Not a tracked change: the text is as it was, and rejecting leaves the comment.
    expect(trackedChanges(session.editor.state.doc)).toHaveLength(0);
    expect(result.blocks[0]?.changed).toBe(false);
    expect(result.blocks[0]?.text).toBe(term.text);
  });

  it("anchors a comment to text of the block", async () => {
    const session = await open();
    const term = starting(blocks(session), "This Agreement continues");
    const result = session.comment(term.handle, "Why three?", { on: "three (3) years" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = session.editor.state.doc;
    let from = -1;
    let to = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "commentStart" && node.attrs.id === result.comment) from = pos + 1;
      if (node.type.name === "commentEnd" && node.attrs.id === result.comment) to = pos;
    });
    expect(doc.textBetween(from, to)).toBe("three (3) years");
  });

  it("refuses text that is not there or there twice, an empty comment, and what is not a paragraph", async () => {
    const session = await open("06-price-schedule");
    const all = blocks(session);
    const first = all[1] as Block;
    expect(session.comment(first.handle, "x", { on: "nowhere" })).toMatchObject({
      code: "no-match",
    });
    expect(session.comment(first.handle, "x", { on: "e" })).toMatchObject({
      code: "several-matches",
    });
    expect(session.comment(first.handle, "  ")).toMatchObject({ code: "invalid" });
    expect(session.comment(first.handle, 5 as never)).toMatchObject({ code: "invalid" });
    expect(session.comment(first.handle, "x", { on: 5 as never })).toMatchObject({
      code: "invalid",
    });
    expect(session.comment(first.handle, "x", null as never)).toMatchObject({ ok: true });
    session.editor.commands.deleteAllComments();
    expect(session.setStyle(first.handle, 5 as never)).toMatchObject({ code: "invalid" });
    const table = all.find((b) => b.kind === "table") as Block;
    expect(session.comment(table.handle, "x")).toMatchObject({ code: "not-a-paragraph" });
    expect(session.comment("b9999", "x")).toMatchObject({ code: "unknown-handle" });
    expect(session.editor.getDocument().comments).toHaveLength(0);
  });

  it("comments an empty paragraph, a cell, and a block twice", async () => {
    const session = await open("06-price-schedule");
    const all = blocks(session);
    const empty = all.find((b) => b.kind === "paragraph" && !b.text) as Block;
    expect(session.comment(empty.handle, "Why empty?")).toMatchObject({ ok: true });
    const cell = starting(all, "Hardware item 1");
    const one = session.comment(cell.handle, "First.");
    const two = session.comment(cell.handle, "Second.", { on: "item 1" });
    expect(two).toMatchObject({ ok: true, blocks: [{ comments: 2 }] });
    expect(one.ok && two.ok && one.comment !== two.comment).toBe(true);
    expect(session.editor.getDocument().comments).toHaveLength(3);
  });
});
