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
