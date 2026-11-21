import {
  acceptAllChanges,
  deleteSelection,
  findAll,
  insertText,
  joinBackward,
  rejectAllChanges,
  splitBlock,
  undo,
  untracked,
} from "@folijs/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Block, openSession, type Session } from "./index.js";
import { corpus } from "./testing/corpus.js";

const open = async (name: string) =>
  openSession((await corpus(name)).document, { author: "Agent" });
const read = (session: Session, options?: Parameters<Session["read"]>[0]) => {
  const result = session.read(options);
  if (!result.ok) throw new Error(result.message);
  return result;
};
const byText = (blocks: readonly Block[], start: string) => {
  const block = blocks.find((b) => b.text.startsWith(start));
  if (!block) throw new Error(`no block starts with ${start}`);
  return block;
};
/** Where `handle`'s block starts, by the session's own editor. */
const start = (session: Session, block: Block) => {
  let found = -1;
  session.editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock && found < 0 && node.textContent.includes(block.text) && block.text)
      found = pos;
    return found < 0;
  });
  return found;
};

describe("read", () => {
  it("gives the body a block per line: handle, style, list number, text", async () => {
    const session = await open("01-mutual-nda");
    const { text, blocks, next } = read(session);
    const lines = text.split("\n");
    expect(lines[0]).toBe("[b1] Title: MUTUAL NON-DISCLOSURE AGREEMENT");
    expect(lines[5]).toBe("[b6] heading 1, 1.: Definitions and interpretation");
    expect(lines[6]).toBe("[b7] Clause, 1.1: In this Agreement the following definitions apply:");
    expect(lines[7]).toMatch(/^\[b8\] Sub-clause, \(a\): "Confidential Information" means/);
    expect(lines).toHaveLength(blocks.length);
    expect(next).toBeNull();
    expect(blocks[5]).toEqual({
      handle: "b6",
      kind: "paragraph",
      style: "heading 1",
      number: "1.",
      text: "Definitions and interpretation",
      depth: 0,
      changed: false,
      comments: 0,
    });
  });

  it("reads the text as it would be accepted, and says where changes and comments are", async () => {
    const session = await open("02-services-agreement-redlined");
    const { blocks, text } = read(session);
    const fees = byText(blocks, "The Customer shall pay the fees");
    expect(fees.changed).toBe(true);
    expect(fees.comments).toBe(2);
    // Word's redline replaced thirty (30) days: the deleted words are not read.
    expect(fees.text).toContain("forty-five (45) days");
    expect(fees.text).not.toContain("thirty (30)");
    expect(text).toContain(`[${fees.handle}] Clause, 2.1, changed, 2 comments: The Customer`);
    expect(byText(blocks, "design and implementation").number).toBe("•");
  });

  it("reads a table's cells under it, and a nested table under its cell", async () => {
    const session = await open("06-price-schedule");
    const { blocks, text } = read(session, { limit: 25 });
    const table = blocks[2] as Block;
    expect(table).toMatchObject({ kind: "table", rows: 41, columns: 5 });
    expect(blocks[3]).toMatchObject({
      text: "Category",
      cell: { table: table.handle, row: 1, column: 1 },
    });
    const lines = text.split("\n");
    expect(lines[2]).toBe("[b3] table, 41 rows, 5 columns");
    expect(lines[3]).toBe("[b4]   r1 c1, Normal: Category");
    expect(lines[15]).toBe("[b16]   r3 c2, table, 2 rows, 2 columns");
    expect(lines[16]).toBe("[b17]     r1 c1, Normal: 1-9");
  });

  it("reads in parts: limit, next, from", async () => {
    const session = await open("01-mutual-nda");
    const all = read(session);
    const first = read(session, { limit: 10 });
    expect(first.blocks).toHaveLength(10);
    expect(first.next).toBe("b11");
    const rest = read(session, { from: first.next as string });
    expect(`${first.text}\n${rest.text}`).toBe(all.text);
    expect(rest.next).toBeNull();
  });

  it("reads a part that starts inside a nested table as the whole read has it", async () => {
    const session = await open("06-price-schedule");
    const all = read(session);
    const first = read(session, { limit: 17 });
    const rest = read(session, { from: first.next as string });
    expect(rest.text.split("\n")[0]).toBe("[b18]     r1 c2, Normal: 37.50");
    expect(`${first.text}\n${rest.text}`).toBe(all.text);
    expect(session.block("b18")).toMatchObject({
      text: "[b18]     r1 c2, Normal: 37.50",
      block: { depth: 2 },
    });
  });

  it("shows what is not text in brackets, where find stops too", async () => {
    const session = await open("01-mutual-nda");
    const { editor } = session;
    const title = read(session).blocks[0] as Block;
    expect(findAll(editor, "MUTUAL NON-DISCLOSURE", { matchCase: true })).toHaveLength(1);
    const { schema } = editor.state;
    editor.dispatch(editor.state.tr.insert(8, schema.node("pageBreak")).setMeta(untracked, true));
    expect(session.block(title.handle)).toMatchObject({
      block: { text: "MUTUAL [page break]NON-DISCLOSURE AGREEMENT" },
    });
    // The text either side is found; text across the break is not, and does not read as one.
    expect(findAll(editor, "MUTUAL NON-DISCLOSURE", { matchCase: true })).toHaveLength(0);
    expect(findAll(editor, "NON-DISCLOSURE AGREEMENT", { matchCase: true })).toHaveLength(1);

    const template = await open("03-offer-letter-template");
    const lines = read(template).text.split("\n");
    expect(lines[1]).toBe("[b2] Normal: Date: [empty: Offer date]");
    expect(lines[4]).toBe("[b5] Normal: Position: [empty: Position]");
  });

  it("reads content Foli does not model as a block that is not editable", async () => {
    const session = await open("01-mutual-nda");
    const before = read(session).blocks;
    const { editor } = session;
    const { schema } = editor.state;
    const at = start(session, before[2] as Block);
    const other = schema.node("opaqueBlock", { xml: "<w:customXml/>", label: "w:customXml" });
    editor.dispatch(editor.state.tr.insert(at, other).setMeta(untracked, true));
    const after = read(session);
    expect(after.blocks[2]).toMatchObject({ kind: "other", text: "w:customXml", depth: 0 });
    const handle = (after.blocks[2] as Block).handle;
    expect(after.text.split("\n")[2]).toBe(`[${handle}] not editable: w:customXml`);
    // Its neighbours keep their handles; it keeps its own when they go, and goes alone.
    expect(after.blocks[1]?.handle).toBe(before[1]?.handle);
    expect(after.blocks[3]?.handle).toBe(before[2]?.handle);
    const next = start(session, before[2] as Block);
    const size = editor.state.doc.nodeAt(next)?.nodeSize ?? 0;
    editor.dispatch(editor.state.tr.delete(next, next + size).setMeta(untracked, true));
    expect(session.block(handle)).toMatchObject({ ok: true, block: { kind: "other" } });
    expect(session.block((before[2] as Block).handle)).toMatchObject({ code: "gone" });
    editor.dispatch(editor.state.tr.delete(next - 1, next).setMeta(untracked, true));
    expect(session.block(handle)).toMatchObject({ ok: false, code: "gone" });
    expect(read(session).blocks.map((b) => b.handle)).toEqual(
      before.filter((_, i) => i !== 2).map((b) => b.handle),
    );
  });

  it("gives one block, and the same handles on a second read", async () => {
    const session = await open("01-mutual-nda");
    const first = read(session);
    expect(read(session).text).toBe(first.text);
    const one = session.block("b6");
    expect(one).toMatchObject({
      ok: true,
      text: "[b6] heading 1, 1.: Definitions and interpretation",
    });
  });

  it("refuses a handle it never gave, a bad limit, and says so", async () => {
    const session = await open("01-mutual-nda");
    expect(session.block("b1")).toMatchObject({ ok: false, code: "unknown-handle" });
    read(session);
    expect(session.block("b9999")).toMatchObject({ ok: false, code: "unknown-handle" });
    expect(session.block("paragraph 3")).toMatchObject({ ok: false, code: "unknown-handle" });
    expect(session.read({ from: "b9999" })).toMatchObject({ ok: false, code: "unknown-handle" });
    expect(session.read({ limit: 0 })).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("handles", () => {
  it("follow their blocks through edits before, in and after them", async () => {
    const session = await open("01-mutual-nda");
    const before = read(session).blocks;
    const purpose = byText(before, '"Purpose" means');
    const { editor } = session;

    // Text typed into the title, a paragraph split above, text typed in the block itself.
    editor.select(3);
    editor.run(insertText("DRAFT "));
    editor.select(start(session, byText(before, "each a")) + 6);
    editor.run(splitBlock);
    editor.select(start(session, purpose) + 4);
    editor.run(insertText("the "));

    const after = read(session).blocks;
    const again = after.find((b) => b.handle === purpose.handle) as Block;
    expect(again.text).toContain("means the evaluation of a possible supply");
    expect(again.changed).toBe(true);
    // The split made one more block, with a handle no block had: the text before the caret.
    // The paragraph's own mark, and so its handle, stay with what comes after.
    expect(after).toHaveLength(before.length + 1);
    const made = after.filter((b) => !before.some((o) => o.handle === b.handle));
    expect(made).toHaveLength(1);
    expect(made[0]?.text).toBe("each ");
    expect(after.find((b) => b.handle === byText(before, "each a").handle)?.text).toBe(
      'a "Party" and together the "Parties".',
    );
    // Every other block is still under its handle, in the same order.
    expect(after.filter((b) => b !== made[0]).map((b) => b.handle)).toEqual(
      before.map((b) => b.handle),
    );
  });

  it("stay on their blocks when one is put right before them, and when their attributes change", async () => {
    const session = await open("01-mutual-nda");
    const before = read(session).blocks;
    const { editor } = session;
    const target = before[6] as Block;
    const at = start(session, target);
    const { schema } = editor.state;
    editor.dispatch(
      editor.state.tr.insert(at, schema.node("paragraph", null, schema.text("New clause."))),
    );
    const node = editor.state.doc.nodeAt(start(session, target));
    if (!node) throw new Error("the block is gone");
    editor.dispatch(
      editor.state.tr.setNodeMarkup(start(session, target), node.type, {
        ...node.attrs,
        keepNext: true,
      }),
    );

    const after = read(session).blocks;
    expect(after[6]).toMatchObject({ text: "New clause.", changed: true });
    expect(after[6]?.handle).not.toBe(target.handle);
    expect(after[7]).toMatchObject({ handle: target.handle, text: target.text });
    expect(after.slice(8).map((b) => b.handle)).toEqual(before.slice(7).map((b) => b.handle));
  });

  it("stay with the text when Enter is pressed at a paragraph's start", async () => {
    const session = await open("01-mutual-nda");
    const before = read(session).blocks;
    const { editor } = session;
    const target = before[6] as Block;
    editor.select(start(session, target) + 1);
    editor.run(splitBlock);
    const after = read(session).blocks;
    expect(after[6]).toMatchObject({ text: "" });
    expect(after[6]?.handle).not.toBe(target.handle);
    expect(after[7]).toMatchObject({ handle: target.handle, text: target.text });
    editor.run(rejectAllChanges("Agent"));
    expect(read(session).blocks).toEqual(before);
  });

  it("go with a block that is removed, or joined with the one after", async () => {
    const session = await open("01-mutual-nda");
    const blocks = read(session).blocks;
    const { editor } = session;
    const removed = blocks[4] as Block;
    const joined = blocks[9] as Block;

    // Removed for real (not tracked), as accepting a deletion does.
    const at = start(session, removed);
    const size = (editor.state.doc.nodeAt(at) as { nodeSize: number }).nodeSize;
    editor.dispatch(editor.state.tr.delete(at, at + size).setMeta(untracked, true));
    expect(session.block(removed.handle)).toMatchObject({ ok: false, code: "gone" });
    expect(session.block((blocks[5] as Block).handle)).toMatchObject({
      ok: true,
      block: { text: (blocks[5] as Block).text },
    });

    // Two paragraphs joined: the first one's mark goes, the joined paragraph ends with the
    // second one's.
    const first = blocks[8] as Block;
    const joinAt = start(session, joined);
    editor.dispatch(editor.state.tr.delete(joinAt - 1, joinAt + 1).setMeta(untracked, true));
    expect(session.block(first.handle)).toMatchObject({ ok: false, code: "gone" });
    expect(session.read({ from: first.handle })).toMatchObject({ ok: false, code: "gone" });
    const merged = session.block(joined.handle);
    expect(merged.ok && merged.block.text).toBe(first.text + joined.text);
  });

  it("stay on the blocks around a deleted paragraph when the deletion is accepted", async () => {
    for (const how of ["node", "selection"]) {
      const session = await open("01-mutual-nda");
      const blocks = read(session).blocks;
      const { editor } = session;
      const clause = byText(blocks, "Clause headings do not affect");
      const heading = byText(blocks, "Obligations of confidentiality");
      const at = start(session, clause);
      if (how === "node") {
        const size = editor.state.doc.nodeAt(at)?.nodeSize ?? 0;
        editor.dispatch(editor.state.tr.delete(at, at + size));
      } else {
        editor.select(at + 1, start(session, heading) + 1);
        editor.run(deleteSelection);
      }
      const tracked = read(session).blocks;
      expect(tracked.map((b) => b.handle)).toEqual(
        blocks.filter((b) => b !== clause).map((b) => b.handle),
      );
      expect(editor.run(acceptAllChanges())).toBe(true);
      // Accepting changes nothing of what was read: same blocks, same handles, same numbers.
      expect(read(session).blocks).toEqual(tracked);
      expect(session.block(clause.handle)).toMatchObject({ ok: false, code: "gone" });
      expect(session.block(heading.handle)).toMatchObject({
        block: { text: "Obligations of confidentiality", style: "heading 1", number: "2." },
      });
    }
  });

  it("number what follows a deleted paragraph mark as the joined text will be", async () => {
    const session = await open("01-mutual-nda");
    const blocks = read(session).blocks;
    const { editor } = session;
    const heading = byText(blocks, "Obligations of confidentiality");
    const next = byText(blocks, "Each Party shall keep");
    expect(next.number).toBe("2.1");
    // The end of clause 1.2 and its mark deleted: the heading will run on in clause 1.2.
    const at = start(session, heading);
    editor.select(at - 8, at + 1);
    editor.run(deleteSelection);
    const tracked = read(session).blocks;
    expect(tracked.find((b) => b.handle === heading.handle)?.number).toBeUndefined();
    expect(tracked.find((b) => b.handle === next.handle)?.number).toBe("1.3");
    editor.run(acceptAllChanges());
    expect(session.block(next.handle)).toMatchObject({ block: { number: "1.3" } });
  });

  it("are forgotten when the editor is given another document", async () => {
    const session = await open("01-mutual-nda");
    const blocks = read(session).blocks;
    session.editor.setDocument((await corpus("05-business-letter")).document);
    expect(session.block("b1")).toMatchObject({ ok: false, code: "gone" });
    const letter = read(session).blocks;
    expect(letter.some((b) => blocks.some((o) => o.handle === b.handle))).toBe(false);
    expect(letter[0]?.handle).toBe(`b${blocks.length + 1}`);
  });

  it("a block deleted as a tracked change is not read; rejecting brings it back under its handle", async () => {
    const session = await open("01-mutual-nda");
    const blocks = read(session).blocks;
    const { editor } = session;
    const gone = blocks[10] as Block;
    const at = start(session, gone);
    const next = start(session, blocks[11] as Block);
    editor.select(at + 1, next + 1);
    expect(editor.run(deleteSelection)).toBe(true);
    expect(read(session).blocks.some((b) => b.handle === gone.handle)).toBe(false);
    expect(session.block(gone.handle)).toMatchObject({ ok: false, code: "gone" });

    expect(editor.run(rejectAllChanges("Agent"))).toBe(true);
    expect(read(session).blocks).toEqual(blocks);
  });

  it("after any tracked edits, rejecting gives every block back under its handle, and accepting leaves each handle on its text", async () => {
    const { document } = await corpus("01-mutual-nda");
    const fraction = fc.double({ min: 0, max: 0.999, noNaN: true });
    const edit = fc.record({
      kind: fc.constantFrom("type", "delete", "split", "join", "undo", "read"),
      block: fraction,
      at: fraction,
      to: fraction,
    });
    const edits = fc.array(edit, { minLength: 1, maxLength: 25 });
    fc.assert(
      fc.property(edits, fc.boolean(), (edits, accept) => {
        const session = openSession(document, { author: "Agent" });
        const { editor } = session;
        const original = read(session).blocks;
        for (const { kind, block, at, to } of edits) {
          const paragraphs: { pos: number; size: number }[] = [];
          editor.state.doc.descendants((node, pos) => {
            if (node.isTextblock) paragraphs.push({ pos, size: node.content.size });
            return !node.isTextblock;
          });
          const pick = (f: number) =>
            paragraphs[Math.floor(f * paragraphs.length)] as { pos: number; size: number };
          const a = pick(block);
          const inA = a.pos + 1 + Math.floor(at * (a.size + 1));
          if (kind === "type") {
            editor.select(inA);
            editor.run(insertText("xy"));
          } else if (kind === "delete") {
            const b = pick(to);
            editor.select(inA, b.pos + 1 + Math.floor(at * (b.size + 1)));
            editor.run(deleteSelection);
          } else if (kind === "split") {
            editor.select(inA);
            editor.run(splitBlock);
          } else if (kind === "join") {
            editor.select(a.pos + 1);
            editor.run(joinBackward);
          } else if (kind === "undo") editor.run(undo);
          else read(session);

          // Never two handles on one block, and none out of order.
          const now = read(session).blocks.map((b) => b.handle);
          expect(new Set(now).size).toBe(now.length);
          const first = new Set(original.map((b) => b.handle));
          const kept = now.filter((h) => first.has(h));
          expect(kept).toEqual(original.map((b) => b.handle).filter((h) => kept.includes(h)));
        }
        if (!accept) {
          editor.run(rejectAllChanges("Agent"));
          expect(read(session).blocks).toEqual(original);
          return;
        }
        // Accepting joins paragraphs whose marks were deleted and changes nothing else that is
        // read: the same text in all, each block that is left under a handle it had, holding
        // what that handle's block held (after what joined it).
        const tracked = read(session).blocks;
        editor.run(acceptAllChanges());
        const accepted = read(session).blocks;
        expect(accepted.map((b) => b.text).join("")).toBe(tracked.map((b) => b.text).join(""));
        for (const block of accepted) {
          const was = tracked.find((b) => b.handle === block.handle);
          expect(was && block.text.endsWith(was.text)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  }, 60_000);
});
