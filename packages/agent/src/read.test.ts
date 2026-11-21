import {
  deleteSelection,
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
    // The split made one more block, with a handle no block had.
    expect(after).toHaveLength(before.length + 1);
    const made = after.filter((b) => !before.some((o) => o.handle === b.handle));
    expect(made).toHaveLength(1);
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

  it("go with a block that is removed or joined into the one before", async () => {
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

    const joinAt = start(session, joined);
    editor.dispatch(editor.state.tr.delete(joinAt - 1, joinAt + 1).setMeta(untracked, true));
    expect(session.block(joined.handle)).toMatchObject({ ok: false, code: "gone" });
    expect(session.read({ from: joined.handle })).toMatchObject({ ok: false, code: "gone" });
    const merged = session.block((blocks[8] as Block).handle);
    expect(merged.ok && merged.block.text).toBe((blocks[8] as Block).text + joined.text);
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

  it("after any tracked edits, rejecting them gives every block back under its handle", async () => {
    const { document } = await corpus("01-mutual-nda");
    const fraction = fc.double({ min: 0, max: 0.999, noNaN: true });
    const edit = fc.record({
      kind: fc.constantFrom("type", "delete", "split", "join", "undo", "read"),
      block: fraction,
      at: fraction,
      to: fraction,
    });
    fc.assert(
      fc.property(fc.array(edit, { minLength: 1, maxLength: 25 }), (edits) => {
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
        editor.run(rejectAllChanges("Agent"));
        expect(read(session).blocks).toEqual(original);
      }),
      { numRuns: 40 },
    );
  }, 60_000);
});
