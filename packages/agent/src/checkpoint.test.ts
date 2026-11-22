import { redo, redoDepth, undo, undoDepth } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { openSession } from "./session.js";
import { corpus } from "./testing/corpus.js";

describe("checkpoint", () => {
  it.each(["01-mutual-nda", "03-offer-letter-template", "04-board-report"])(
    "rollback gives %s back: document, handles, nothing tracked",
    async (name) => {
      const { document } = await corpus(name);
      const session = openSession(document, { author: "Agent" });
      const read = () => {
        const r = session.read();
        if (!r.ok) throw new Error(r.message);
        return r;
      };
      const first = read();
      // An edit before the checkpoint stays.
      const b = first.blocks.find((x) => x.text.length > 20 && !x.cell);
      expect(session.insertAfter(b?.handle as string, "Kept.").ok).toBe(true);
      const before = JSON.stringify(session.document());
      const lines = read().text;

      const point = session.checkpoint();
      const blocks = read().blocks;
      let edits = 0;
      for (const block of blocks.slice(0, 40)) {
        const word = /[A-Za-z]{4,}/.exec(block.text)?.[0];
        if (word && session.replaceText(block.handle, word, "CHANGED").ok) edits++;
      }
      const target = blocks[Math.min(5, blocks.length - 1)]?.handle as string;
      session.insertAfter(target, ["New one.", { text: "New two.", style: "Heading 2" }]);
      session.comment(target, "A note.");
      session.setStyle(target, "Heading 1");
      session.deleteBlock(blocks[Math.min(8, blocks.length - 1)]?.handle as string);
      for (const control of session.controls())
        session.fillControl(control.id, control.kind === "checkbox" ? true : "2026-12-01");
      session.updateFields({ data: { CandidateFirstName: "Ada" }, contents: true });
      expect(edits).toBeGreaterThan(3);
      expect(JSON.stringify(session.document())).not.toBe(before);

      point.rollback();
      expect(JSON.stringify(session.document())).toBe(before);
      expect(read().text).toBe(lines);
      // The session goes on working.
      expect(session.replaceText(b?.handle as string, b?.text.slice(0, 8) as string, "X").ok).toBe(
        true,
      );
    },
  );

  it("release keeps the edits", async () => {
    const { document } = await corpus("01-mutual-nda");
    const session = openSession(document, { author: "Agent" });
    const point = session.checkpoint();
    const r = session.read({ limit: 1 });
    expect(r.ok && session.insertAfter(r.blocks[0]?.handle as string, "Kept.").ok).toBe(true);
    point.release();
    const after = session.read({ limit: 2 });
    expect(after.ok && after.text).toContain("Kept.");
  });
});

describe("checkpoint: what the review of #165 found", () => {
  it("leaves undo as it was: what was taken back is neither undone nor redone", async () => {
    const { document } = await corpus("01-mutual-nda");
    const session = openSession(document, { author: "Agent" });
    const { editor } = session;
    const read = session.read({ limit: 3 });
    const handle = (read.ok ? read.blocks[2]?.handle : "") as string;
    const original = JSON.stringify(session.document());
    expect(session.insertAfter(handle, "First.").ok).toBe(true);
    expect(session.insertAfter(handle, "Second.").ok).toBe(true);
    const depth = undoDepth(editor.state);
    const edited = JSON.stringify(session.document());

    const point = session.checkpoint();
    for (let i = 0; i < 150; i++) session.insertAfter(handle, `Run ${i}.`);
    session.comment(handle, "A note.");
    point.rollback();
    expect(JSON.stringify(session.document())).toBe(edited);
    expect(undoDepth(editor.state)).toBe(depth);
    expect(redoDepth(editor.state)).toBe(0);
    // Redo brings nothing of the run back; undo goes back through the edits before it.
    expect(editor.run(redo)).toBe(false);
    while (undoDepth(editor.state)) editor.run(undo);
    expect(JSON.stringify(session.document())).toBe(original);
  });

  it("takes back a style the edits added to the document", async () => {
    const { document } = await corpus("05-business-letter");
    // The letter without its heading styles: Word has them built in, the document does not.
    const bare = {
      ...document,
      styles: document.styles.filter(
        (s) => !/^heading/i.test(s.id) && !/^heading/i.test(s.basedOn ?? ""),
      ),
    };
    const session = openSession(bare, { author: "Agent" });
    const styles = () =>
      session
        .document()
        .styles.map((s) => s.id)
        .join();
    const before = styles();
    const read = session.read({ limit: 2 });
    const handle = (read.ok ? read.blocks[1]?.handle : "") as string;
    const point = session.checkpoint();
    expect(session.setStyle(handle, "Heading 1").ok).toBe(true);
    expect(session.insertAfter(handle, { text: "x", style: "Heading 2" }).ok).toBe(true);
    expect(styles()).not.toBe(before);
    point.rollback();
    expect(styles()).toBe(before);
  });

  it("is used once", async () => {
    const { document } = await corpus("01-mutual-nda");
    const session = openSession(document, { author: "Agent" });
    const released = session.checkpoint();
    released.release();
    expect(() => released.rollback()).toThrow(/already/);
    const rolled = session.checkpoint();
    rolled.rollback();
    expect(() => rolled.rollback()).toThrow(/already/);
    expect(() => rolled.release()).toThrow(/already/);
  });

  it("an insert or a replace of very many is refused, not started", async () => {
    const { document } = await corpus("01-mutual-nda");
    const session = openSession(document, { author: "Agent" });
    const read = session.read({ limit: 3 });
    const handle = (read.ok ? read.blocks[2]?.handle : "") as string;
    const before = JSON.stringify(session.document());
    const started = Date.now();
    expect(session.insertAfter(handle, new Array(20000).fill(""))).toMatchObject({
      ok: false,
      code: "invalid",
      message:
        "At most 500 paragraphs are inserted at once: 20000 were given. Insert them in parts.",
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(JSON.stringify(session.document())).toBe(before);
    expect(session.insertAfter(handle, new Array(500).fill("p")).ok).toBe(true);

    const long = session.insertAfter(handle, "a".repeat(600));
    const made = (long.ok ? long.blocks[0]?.handle : "") as string;
    expect(session.replaceText(made, "a", "b", { all: true })).toMatchObject({
      ok: false,
      code: "several-matches",
    });
    expect(session.replaceText(made, "a".repeat(300), "b", { all: true })).toMatchObject({
      ok: true,
      replaced: 2,
    });
  });
});

describe("what one operation writes (the fourth review of #165)", () => {
  it("a replace or a fill that would write too much, its places together, is refused", async () => {
    const { document } = await corpus("03-offer-letter-template");
    const session = openSession(document, { author: "Agent" });
    const r = session.read({ limit: 2 });
    const first = (r.ok ? r.blocks[0]?.handle : "") as string;
    const made = session.insertAfter(first, "a".repeat(500));
    const handle = (made.ok ? made.blocks[0]?.handle : "") as string;
    const before = JSON.stringify(session.document());
    const started = Date.now();
    expect(session.replaceText(handle, "a", "x".repeat(199_000), { all: true })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(JSON.stringify(session.document())).toBe(before);
    // At the cap: done.
    expect(session.replaceText(handle, "a", "x".repeat(600), { all: true })).toMatchObject({
      ok: true,
      replaced: 500,
    });
    const control = session.controls().find((c) => c.kind === "text" || c.kind === "richText");
    expect(session.fillControl(control?.id as string, "y".repeat(300_001))).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });
});

describe("what merge data writes (the fourth review's re-check)", () => {
  it("a value written into many fields of its name is held by what it writes", async () => {
    const { document } = await corpus("03-offer-letter-template");
    // A template that holds the same merge field a thousand times.
    const content = document.content as { content: { content?: unknown[] }[] };
    const holder = content.content.find((p) => JSON.stringify(p).includes("CandidateFirstName"));
    const hostile = {
      ...document,
      content: { ...content, content: [...content.content, ...new Array(1000).fill(holder)] },
    };
    const session = openSession(hostile as never, { author: "Agent" });
    const before = JSON.stringify(session.document());
    const started = Date.now();
    expect(
      session.updateFields({ data: { CandidateFirstName: "v".repeat(190_000) } }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(JSON.stringify(session.document())).toBe(before);
    // The same name twice, by capitals, the long value where core looks: what is written is
    // what is counted, whichever key core takes.
    for (const data of [
      { CandidateFirstName: "v".repeat(190_000), candidatefirstname: "" },
      { candidatefirstname: "", CandidateFirstName: "v".repeat(190_000) },
    ])
      expect(session.updateFields({ data }), JSON.stringify(Object.keys(data))).toMatchObject({
        ok: false,
        code: "invalid",
      });
    expect(JSON.stringify(session.document())).toBe(before);
    // Short enough, all of them: done.
    const done = session.updateFields({ data: { CandidateFirstName: "Ada" } });
    expect(done).toMatchObject({ ok: true });
    expect(done.ok && done.updated).toBeGreaterThan(1000);
  });
});

describe("what a document's own fields write (the re-check of #175)", () => {
  it("pictures that write far more than the document holds are refused, nothing changed", async () => {
    const { document } = await corpus("03-offer-letter-template");
    const content = document.content as { content: unknown[] };
    const picture = `"${"dddd ".repeat(2000)}"`;
    const fieldParagraph = {
      type: "paragraph",
      content: [
        { type: "fieldStart" },
        { type: "fieldCode", attrs: { text: `DATE \\@ ${picture}` } },
        { type: "fieldSeparator" },
        { type: "text", text: "old" },
        { type: "fieldEnd" },
      ],
    };
    const hostile = {
      ...document,
      content: { ...content, content: [...content.content, ...new Array(50).fill(fieldParagraph)] },
    };
    const session = openSession(hostile as never, { author: "Agent" });
    const before = JSON.stringify(session.document());
    const started = Date.now();
    const refused = session.updateFields();
    expect(refused).toMatchObject({ ok: false, code: "invalid" });
    expect(!refused.ok && refused.message).toContain("Nothing was changed");
    expect(Date.now() - started).toBeLessThan(5000);
    expect(JSON.stringify(session.document())).toBe(before);
  });
});

describe("target (18.2)", () => {
  it("is where a block's content is in the session's editor, or the handle's refusal", async () => {
    const { document } = await corpus("01-mutual-nda");
    const session = openSession(document, { author: "Agent" });
    const read = session.read();
    if (!read.ok) throw new Error(read.message);
    const paragraph = read.blocks.find((b) => b.kind === "paragraph" && b.text.length > 10);
    const table = read.blocks.find((b) => b.kind === "table");
    const at = session.target(paragraph?.handle as string);
    expect(at).toMatchObject({ ok: true, target: { story: null } });
    const { from, to } = (at as { target: { from: number; to: number } }).target;
    expect(session.editor.state.doc.textBetween(from, to)).toBe(paragraph?.text);
    // It follows the block through edits.
    session.insertBefore(paragraph?.handle as string, "Inserted.");
    const moved = session.target(paragraph?.handle as string);
    const again = (moved as { target: { from: number; to: number } }).target;
    expect(again.from).toBeGreaterThan(from);
    expect(session.editor.state.doc.textBetween(again.from, again.to)).toBe(paragraph?.text);
    expect(session.target(table?.handle as string)).toMatchObject({ ok: true });
    expect(session.target("b9999")).toMatchObject({ ok: false, code: "unknown-handle" });
  });
});

describe("a paragraph the session inserted, then deleted", () => {
  it("leaves the document as it was: no tracked change, nothing joined on rejecting", async () => {
    const { rejectAllChanges, trackedChanges } = await import("@folijs/core");
    const { document } = await corpus("01-mutual-nda");
    const session = openSession(document, { author: "Agent" });
    const before = JSON.stringify(session.document().content);
    const read = session.read({ limit: 3 });
    const handle = (read.ok ? read.blocks[1]?.handle : "") as string;
    for (const side of ["after", "before"] as const) {
      const made =
        side === "after" ? session.insertAfter(handle, "tmp") : session.insertBefore(handle, "tmp");
      const inserted = (made.ok ? made.blocks[0]?.handle : "") as string;
      expect(session.deleteBlock(inserted)).toMatchObject({ ok: true });
      expect(trackedChanges(session.editor.state.doc), side).toEqual([]);
      expect(JSON.stringify(session.document().content), side).toBe(before);
    }
    session.editor.run(rejectAllChanges());
    expect(JSON.stringify(session.document().content)).toBe(before);
  });
});
