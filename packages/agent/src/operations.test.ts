import {
  acceptAllChanges,
  createEditor,
  rejectAllChanges,
  trackedChanges,
  undo,
} from "@folijs/core";
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
const text = (session: Session) => {
  const result = session.read();
  if (!result.ok) throw new Error(result.message);
  return result.text;
};
const starting = (all: readonly Block[], start: string) => {
  const block = all.find((b) => b.text.startsWith(start));
  if (!block) throw new Error(`no block starts with ${start}`);
  return block;
};
/** Every change is the agent's and tracked: rejecting them gives the first read back, handles too. */
const expectTracked = (session: Session, original: readonly Block[]) => {
  const changes = trackedChanges(session.editor.state.doc);
  expect(changes.length).toBeGreaterThan(0);
  expect(changes.every((c) => c.author === "Agent")).toBe(true);
  session.editor.run(rejectAllChanges("Agent"));
  expect(blocks(session)).toEqual(original);
};

describe("replaceText", () => {
  it("replaces text in a block as a tracked change and returns the block", async () => {
    const session = await open();
    const original = blocks(session);
    const term = starting(original, "This Agreement continues");
    const result = session.replaceText(term.handle, "three (3) years", "five (5) years");
    expect(result).toMatchObject({ ok: true, replaced: 1 });
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ handle: term.handle, changed: true });
    expect(result.blocks[0]?.text).toContain("for a period of five (5) years from its date");
    expect(result.text).toMatch(new RegExp(`^\\[${term.handle}\\] Clause, 3\\.1, changed: `));
    expectTracked(session, original);
  });

  it("refuses when the text is not there, with the block's text", async () => {
    const session = await open();
    const title = blocks(session)[0] as Block;
    const result = session.replaceText(title.handle, "mutual", "MUTUAL");
    expect(result).toMatchObject({ ok: false, code: "no-match" });
    expect(!result.ok && result.message).toContain("MUTUAL NON-DISCLOSURE AGREEMENT");
    // Text of another block is not this block's.
    expect(session.replaceText(title.handle, "Northwind", "X")).toMatchObject({ code: "no-match" });
    expect(trackedChanges(session.editor.state.doc)).toHaveLength(0);
  });

  it("refuses several matches unless all is asked for", async () => {
    const session = await open();
    const original = blocks(session);
    const parties = starting(original, "each a");
    const several = session.replaceText(parties.handle, "Part", "Sid");
    expect(several).toMatchObject({ ok: false, code: "several-matches" });
    expect(!several.ok && several.message).toContain("2 times");
    const all = session.replaceText(parties.handle, "Part", "Sid", { all: true });
    expect(all).toMatchObject({ ok: true, replaced: 2 });
    expect(all.ok && all.blocks[0]?.text).toBe('each a "Sidy" and together the "Sidies".');
    expectTracked(session, original);
  });

  it("takes ↵ and \\n as a line break, in find too", async () => {
    const session = await open();
    const title = blocks(session)[0] as Block;
    const broken = session.replaceText(title.handle, "MUTUAL ", "MUTUAL↵");
    expect(broken.ok && broken.blocks[0]?.text).toBe("MUTUAL\nNON-DISCLOSURE AGREEMENT");
    expect(broken.ok && broken.text).toContain("MUTUAL↵NON-DISCLOSURE");
    const back = session.replaceText(title.handle, "MUTUAL↵NON", "MUTUAL NON");
    expect(back.ok && back.blocks[0]?.text).toBe("MUTUAL NON-DISCLOSURE AGREEMENT");
  });

  it("does not find text deleted before, and replaces its own insertion", async () => {
    const session = await open();
    const title = blocks(session)[0] as Block;
    session.replaceText(title.handle, "MUTUAL", "BILATERAL");
    expect(session.replaceText(title.handle, "MUTUAL", "X")).toMatchObject({ code: "no-match" });
    const again = session.replaceText(title.handle, "BILATERAL", "RECIPROCAL");
    expect(again.ok && again.blocks[0]?.text).toBe("RECIPROCAL NON-DISCLOSURE AGREEMENT");
  });

  it("refuses a table, an unknown handle and an empty find", async () => {
    const session = await open("06-price-schedule");
    const all = blocks(session);
    const table = all.find((b) => b.kind === "table") as Block;
    expect(session.replaceText(table.handle, "a", "b")).toMatchObject({ code: "not-a-paragraph" });
    expect(session.replaceText("b9999", "a", "b")).toMatchObject({ code: "unknown-handle" });
    expect(session.replaceText((all[0] as Block).handle, "", "b")).toMatchObject({
      code: "invalid",
    });
  });

  it("replaces in a table's cell", async () => {
    const session = await open("06-price-schedule");
    const original = blocks(session);
    const cell = starting(original, "Hardware item 1");
    const result = session.replaceText(cell.handle, "item 1", "item A");
    expect(result.ok && result.text).toBe(
      `[${cell.handle}]   r2 c2, Normal, changed: Hardware item A`,
    );
    expectTracked(session, original);
  });
});

describe("insertAfter and insertBefore", () => {
  it("inserts paragraphs formatted as the block they go next to", async () => {
    const session = await open();
    const original = blocks(session);
    const clause = starting(original, "Clause headings do not affect");
    const result = session.insertAfter(clause.handle, [
      "A reference to a statute includes its amendments.",
      "Writing includes email.",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks.map((b) => [b.style, b.number, b.text, b.changed])).toEqual([
      ["Clause", "1.3", "A reference to a statute includes its amendments.", true],
      ["Clause", "1.4", "Writing includes email.", true],
    ]);
    const now = blocks(session);
    const at = now.findIndex((b) => b.handle === clause.handle);
    expect(now.slice(at + 1, at + 3).map((b) => b.handle)).toEqual(
      result.blocks.map((b) => b.handle),
    );
    // The blocks around keep their handles.
    expect(
      now.filter((b) => !result.blocks.some((n) => n.handle === b.handle)).map((b) => b.handle),
    ).toEqual(original.map((b) => b.handle));
    expectTracked(session, original);
  });

  it("inserts before a block, which keeps its handle", async () => {
    const session = await open();
    const original = blocks(session);
    const heading = starting(original, "Definitions and interpretation");
    const result = session.insertBefore(heading.handle, [{ text: "Recitals", style: "heading 1" }]);
    expect(result.ok && result.blocks[0]).toMatchObject({
      style: "heading 1",
      number: "1.",
      text: "Recitals",
    });
    const now = blocks(session);
    const at = now.findIndex((b) => b.handle === heading.handle);
    expect(now[at]).toMatchObject({ text: "Definitions and interpretation", number: "2." });
    expect(now[at - 1]?.text).toBe("Recitals");
    expectTracked(session, original);
  });

  it("puts a paragraph in a named style, by name or id, whatever its capitals", async () => {
    const session = await open();
    const original = blocks(session);
    const first = original[1] as Block;
    const result = session.insertAfter(first.handle, [
      { text: "By name", style: "sub-clause" },
      { text: "Plain", style: "Normal" },
      "As the block",
    ]);
    expect(result.ok && result.blocks.map((b) => b.style)).toEqual([
      "Sub-clause",
      "Normal",
      "Normal",
    ]);
  });

  it("adds a built-in heading style the document does not have yet", () => {
    // A document without Heading 2: Word's headings are offered all the same.
    const blank = createEditor().getDocument();
    const document = { ...blank, styles: blank.styles.filter((s) => s.id !== "Heading2") };
    const session = openSession(document, { author: "Agent" });
    const first = blocks(session)[0] as Block;
    expect(session.editor.getDocument().styles.map((s) => s.id)).not.toContain("Heading2");
    const result = session.insertAfter(first.handle, [{ text: "Summary", style: "Heading 2" }]);
    expect(result.ok && result.blocks[0]).toMatchObject({ text: "Summary", changed: true });
    expect(session.editor.getDocument().styles.map((s) => s.id)).toContain("Heading2");
    expect(result.ok && result.blocks[0]?.style?.toLowerCase()).toBe("heading 2");
  });

  it("refuses an unknown style with the styles there are, and inserts nothing", async () => {
    const session = await open();
    const first = blocks(session)[0] as Block;
    const before = text(session);
    const result = session.insertAfter(first.handle, ["Fine", { text: "x", style: "Fancy" }]);
    expect(result).toMatchObject({ ok: false, code: "unknown-style" });
    expect(!result.ok && result.message).toContain("Sub-clause");
    expect(text(session)).toBe(before);
    expect(session.insertAfter(first.handle, [])).toMatchObject({ code: "invalid" });
    expect(session.insertBefore("b9999", ["x"])).toMatchObject({ code: "unknown-handle" });
  });

  it("inserts in a cell, after a table, and line breaks and tabs in the text", async () => {
    const session = await open("06-price-schedule");
    const original = blocks(session);
    const cell = starting(original, "Hardware item 1");
    const inCell = session.insertAfter(cell.handle, ["Second line\tof\nthe cell"]);
    expect(inCell.ok && inCell.blocks[0]).toMatchObject({
      text: "Second line\tof\nthe cell",
      cell: cell.cell,
    });
    const table = original.find((b) => b.kind === "table") as Block;
    const after = session.insertAfter(table.handle, ["After the table."]);
    expect(after.ok && after.blocks[0]?.cell).toBeUndefined();
    const before = session.insertBefore(table.handle, ["Before the table."]);
    const now = blocks(session);
    const at = now.findIndex((b) => b.handle === table.handle);
    expect(now[at - 1]?.text).toBe("Before the table.");
    expect(before.ok).toBe(true);
    expectTracked(session, original);
  });

  it("is one undo step back to where it was", async () => {
    const session = await open();
    const before = text(session);
    const first = blocks(session)[0] as Block;
    session.insertAfter(first.handle, ["One", "Two"]);
    session.editor.run(undo);
    expect(text(session)).toBe(before);
  });
});

describe("deleteBlock", () => {
  it("deletes a paragraph as a tracked change: it is no longer read", async () => {
    const session = await open();
    const original = blocks(session);
    const clause = starting(original, "Clause headings do not affect");
    const result = session.deleteBlock(clause.handle);
    expect(result).toMatchObject({
      ok: true,
      text: `Deleted block ${clause.handle}, as a tracked deletion.`,
    });
    const now = blocks(session);
    expect(now).toHaveLength(original.length - 1);
    expect(now.some((b) => b.handle === clause.handle)).toBe(false);
    expect(session.deleteBlock(clause.handle)).toMatchObject({ ok: false, code: "gone" });
    expect(session.replaceText(clause.handle, "a", "b")).toMatchObject({ ok: false, code: "gone" });
    expectTracked(session, original);
  });

  it("deletes a table with its cells", async () => {
    const session = await open("06-price-schedule");
    const original = blocks(session);
    const nested = original.filter((b) => b.kind === "table")[1] as Block;
    const inside = original.filter((b) => b.cell?.table === nested.handle);
    expect(inside.length).toBeGreaterThan(0);
    expect(session.deleteBlock(nested.handle)).toMatchObject({ ok: true });
    const now = blocks(session);
    expect(now).toHaveLength(original.length - 1 - inside.length);
    expect(now.some((b) => b.handle === nested.handle)).toBe(false);
    expectTracked(session, original);
  });

  it("empties the last paragraph of a cell or of the document, and says it stays", async () => {
    const session = await open("06-price-schedule");
    const original = blocks(session);
    const cell = starting(original, "Hardware item 1");
    const result = session.deleteBlock(cell.handle);
    expect(result.ok && result.text).toContain("was emptied but stays");
    expect(session.block(cell.handle)).toMatchObject({ block: { text: "", cell: cell.cell } });
    expect(session.deleteBlock(cell.handle)).toMatchObject({ ok: false, code: "refused" });
    expectTracked(session, original);
  });

  it("deletes what it inserted, leaving no change", async () => {
    const session = await open();
    const original = blocks(session);
    const made = session.insertAfter((original[3] as Block).handle, ["Temporary."]);
    if (!made.ok) throw new Error(made.message);
    expect(session.deleteBlock((made.blocks[0] as Block).handle)).toMatchObject({ ok: true });
    expect(blocks(session).map((b) => b.text)).toEqual(original.map((b) => b.text));
  });
});

describe("what the review of #140 found", () => {
  it("deletes the table asked for when its first cell starts with another table", async () => {
    const { document } = await corpus("06-price-schedule");
    const moved = structuredClone(document);
    type Json = { type: string; content?: Json[] };
    const outer = (moved.content.content as Json[]).find((b) => b.type === "table") as Json;
    const cells = (outer.content as Json[]).flatMap((row) => row.content as Json[]);
    const holder = cells.find((c) => c.content?.some((b) => b.type === "table")) as Json;
    const nested = holder.content?.find((b) => b.type === "table") as Json;
    holder.content = holder.content?.filter((b) => b !== nested) as Json[];
    (cells[0] as Json).content?.unshift(nested);
    const session = openSession(moved, { author: "Agent" });
    const original = blocks(session);
    const tables = original.filter((b) => b.kind === "table");
    expect(tables[1]?.cell).toMatchObject({ table: tables[0]?.handle, row: 1, column: 1 });

    expect(session.deleteBlock(tables[0]?.handle as string)).toMatchObject({
      ok: true,
      text: `Deleted table ${tables[0]?.handle} with its cells.`,
    });
    // Both tables and every cell are gone from the read; the paragraphs around stay.
    expect(blocks(session)).toEqual(original.filter((b) => b.depth === 0 && b.kind !== "table"));
    expectTracked(session, original);
  });

  it("refuses to insert into, and to delete, what a locked content control holds", async () => {
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
    const before = text(session);
    expect(session.insertAfter(benefits.handle, ["x"])).toMatchObject({ code: "read-only" });
    expect(session.insertBefore(benefits.handle, ["x"])).toMatchObject({ code: "read-only" });
    expect(session.deleteBlock(benefits.handle)).toMatchObject({ code: "read-only" });
    // A paragraph with a locked control in its line: full of text, and not "already empty".
    const remote = all.find((b) => b.text.includes("Remote working")) as Block;
    const refused = session.deleteBlock(remote.handle);
    expect(refused).toMatchObject({ ok: false, code: "read-only" });
    expect(!refused.ok && refused.message).toContain("Remote");
    expect(text(session)).toBe(before);
    // Next to it, outside the control, a paragraph goes in.
    expect(session.insertAfter(remote.handle, ["After."])).toMatchObject({ ok: true });
  });

  it("empties a paragraph before a table and says why: accepting would leave it too", async () => {
    const session = await open("06-price-schedule");
    const original = blocks(session);
    const lead = original[1] as Block;
    expect(original[2]?.kind).toBe("table");
    const result = session.deleteBlock(lead.handle);
    expect(result.ok && result.text).toContain(
      "was emptied but stays: the block after it is not a paragraph it can join",
    );
    session.editor.run(acceptAllChanges());
    expect(session.block(lead.handle)).toMatchObject({ block: { text: "" } });
  });

  it("deletes a paragraph that holds an empty control, placeholder and all", async () => {
    const session = await open("03-offer-letter-template");
    const original = blocks(session);
    const date = starting(original, "Date: [empty: Offer date]");
    expect(session.deleteBlock(date.handle)).toMatchObject({
      ok: true,
      text: `Deleted block ${date.handle}, as a tracked deletion.`,
    });
    expect(blocks(session).some((b) => b.handle === date.handle)).toBe(false);
    expectTracked(session, original);
  });

  it("keeps a section break: the paragraph that ends a section is not deleted", async () => {
    const { document } = await corpus("08-newsletter");
    const session = openSession(document, { author: "Agent" });
    const sections = () => {
      let count = 1;
      session.editor.state.doc.forEach((node) => {
        if (node.attrs.section) count++;
      });
      return count;
    };
    const before = sections();
    expect(before).toBeGreaterThan(1);
    // The body's blocks and what is read at depth 0 are the same list, in the same order.
    let index = -1;
    session.editor.state.doc.forEach((node, _offset, i) => {
      if (index < 0 && node.attrs.section) index = i;
    });
    const breaker = blocks(session).filter((b) => b.depth === 0)[index] as Block;
    const result = session.deleteBlock(breaker.handle);
    expect(result.ok ? result.text : result.message).toContain("it ends a section");
    session.editor.run(acceptAllChanges());
    expect(sections()).toBe(before);
  });

  it("removes its own paragraph at the document's end for real", async () => {
    const session = await open();
    const original = blocks(session);
    const last = original.at(-1) as Block;
    const made = session.insertAfter(last.handle, ["Appendix."]);
    if (!made.ok) throw new Error(made.message);
    expect(session.deleteBlock(made.blocks[0]?.handle as string)).toMatchObject({
      ok: true,
      text: `Deleted block ${made.blocks[0]?.handle}: your own insertion, removed.`,
    });
    expect(blocks(session)).toEqual(original);
    expect(trackedChanges(session.editor.state.doc)).toHaveLength(0);
  });

  it("after a heading inserts body text, as Enter does, not another heading", async () => {
    const session = await open();
    const original = blocks(session);
    const heading = starting(original, "Definitions and interpretation");
    const result = session.insertAfter(heading.handle, ["In this clause:"]);
    expect(result.ok && result.blocks[0]?.style).not.toBe("heading 1");
    expect(result.ok && result.blocks[0]?.number).toBeUndefined();
    // The headings after it keep their numbers.
    expect(starting(blocks(session), "Obligations of confidentiality").number).toBe("2.");
    // Before a heading: as the heading, which is what Enter at its start gives.
    const before = session.insertBefore(heading.handle, ["Recitals"]);
    expect(before.ok && before.blocks[0]?.style).toBe("heading 1");
    expectTracked(session, original);
  });

  it("takes one paragraph given bare, and refuses what is not text instead of throwing", async () => {
    const session = await open();
    const first = blocks(session)[0] as Block;
    const never = null as never;
    expect(session.insertAfter(first.handle, "One paragraph.")).toMatchObject({
      ok: true,
      blocks: [{ text: "One paragraph." }],
    });
    expect(session.insertAfter(first.handle, [never])).toMatchObject({ code: "invalid" });
    expect(session.insertAfter(first.handle, [{ text: 5 as never }])).toMatchObject({
      code: "invalid",
    });
    expect(session.insertAfter(first.handle, [{ text: "x", style: 5 as never }])).toMatchObject({
      code: "invalid",
    });
    expect(session.replaceText(first.handle, undefined as never, "x")).toMatchObject({
      code: "invalid",
    });
    expect(session.replaceText(first.handle, "MUTUAL", undefined as never)).toMatchObject({
      code: "invalid",
    });
    expect(session.replaceText(7 as never, "a", "b")).toMatchObject({ code: "invalid" });
    expect(session.deleteBlock(undefined as never)).toMatchObject({ code: "invalid" });
    // null where an options object may be left out, as a tool call may send it.
    expect(session.read(null as never)).toMatchObject({ ok: true });
    expect(session.replaceText(first.handle, "A", "a", null as never)).toMatchObject({
      code: "several-matches",
    });
  });

  it("records nothing when the replacement is the text there", async () => {
    const session = await open();
    const first = blocks(session)[0] as Block;
    expect(session.replaceText(first.handle, "MUTUAL", "MUTUAL")).toMatchObject({
      ok: true,
      replaced: 0,
      blocks: [{ changed: false }],
    });
    expect(trackedChanges(session.editor.state.doc)).toHaveLength(0);
  });

  it("says that what read shows in brackets is not text to find", async () => {
    const session = await open("03-offer-letter-template");
    const date = starting(blocks(session), "Date: [empty: Offer date]");
    const result = session.replaceText(date.handle, "[empty: Offer date]", "1 May");
    expect(result).toMatchObject({ ok: false, code: "no-match" });
    expect(!result.ok && result.message).toContain("in brackets");
  });
});
