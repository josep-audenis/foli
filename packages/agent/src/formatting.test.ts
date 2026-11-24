import { createDocument, trackedChanges } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { openSession } from "./index.js";

const open = (text: string) =>
  openSession(
    createDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    }),
    { author: "Agent" },
  );
const first = (session: ReturnType<typeof open>) => {
  const read = session.read();
  if (!read.ok) throw new Error(read.message);
  return read.blocks[0]?.handle as string;
};

describe("text formatting (23.4)", () => {
  it("formats text in a paragraph as a tracked formatting change, and read shows it", async () => {
    const session = open("Total due: 40 pounds. Total paid: 0.");
    const handle = first(session);
    const done = session.formatText(
      handle,
      { bold: true, color: "1F3864", size: 14 },
      { on: "Total", all: true },
    );
    expect(done.ok).toBe(true);
    expect(trackedChanges(session.editor.state.doc).every((c) => c.kind === "formatting")).toBe(
      true,
    );
    const read = session.read({ formatting: true });
    expect(read.ok && read.text).toMatch(
      /\n +formatting: bold, 14 pt, color 1F3864: "Total"; bold, 14 pt, color 1F3864: "Total"$/,
    );
    // Read without asking: no formatting line.
    expect((session.read() as { text: string }).text).not.toContain("formatting:");
    // Through .docx: the same.
    const again = openSession((await importDocx(await exportDocx(session.document()))).document, {
      author: "A",
    });
    expect((again.read({ formatting: true }) as { text: string }).text).toMatch(
      /bold, 14 pt, color 1F3864: "Total"/,
    );
    session.editor.commands.rejectAllChanges();
    expect((session.read({ formatting: true }) as { text: string }).text).not.toContain(
      "formatting:",
    );
  });

  it("takes bold off, highlights, links, and refuses what it cannot do", () => {
    const session = open("Read the site now");
    const handle = first(session);
    expect(session.formatText(handle, { bold: true }).ok).toBe(true);
    expect(session.formatText(handle, { bold: false }, { on: "site" }).ok).toBe(true);
    expect(session.formatText(handle, { highlight: "yellow" }, { on: "now" }).ok).toBe(true);
    expect(session.formatText(handle, { link: "example.com" }, { on: "site" }).ok).toBe(true);
    const text = (session.read({ formatting: true }) as { text: string }).text;
    expect(text).toMatch(/link "https:\/\/example\.com"/);
    expect(text).toMatch(/highlight yellow/);
    const refusals = [
      session.formatText(handle, {}),
      session.formatText(handle, { bold: "yes" } as never),
      session.formatText(handle, { color: "blue" }),
      session.formatText(handle, { highlight: "mauve" }),
      session.formatText(handle, { link: "javascript:alert(1)" }),
      session.formatText(handle, { glow: true } as never),
      session.formatText(handle, { bold: true }, { on: "absent" }),
    ];
    expect(refusals.map((r) => r.ok)).toEqual([false, false, false, false, false, false, false]);
  });
});
