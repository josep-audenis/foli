import { createDocument, trackedChanges } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { agentTools, openSession, type Session } from "./index.js";

const open = (...texts: string[]) =>
  openSession(
    createDocument({
      type: "doc",
      content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    }),
    { author: "Agent" },
  );
const handles = (session: Session) =>
  (session.read() as { blocks: { handle: string }[] }).blocks.map((b) => b.handle);
const text = (session: Session) => (session.read({ formatting: true }) as { text: string }).text;

describe("paragraph formatting and lists (23.5)", () => {
  it("aligns and spaces paragraphs as tracked formatting changes; read shows it", async () => {
    const session = open("Title", "Body");
    const [title] = handles(session);
    const done = session.formatParagraphs(title as string, {
      align: "center",
      spaceAfter: 12,
      lineSpacing: 2,
    });
    expect(done.ok).toBe(true);
    expect(trackedChanges(session.editor.state.doc).map((c) => c.kind)).toEqual([
      "paragraphFormatting",
    ]);
    expect(text(session)).toMatch(
      /formatting: paragraph centered, line spacing 2, space after 12 pt/,
    );
    const again = openSession((await importDocx(await exportDocx(session.document()))).document, {
      author: "A",
    });
    expect(text(again)).toMatch(/paragraph centered/);
    session.editor.commands.rejectAllChanges();
    expect(text(session)).not.toMatch(/centered/);
  });

  it("makes paragraphs next to each other one list, takes a level deeper, and off again", () => {
    const session = open("Intro", "One", "Two", "Three");
    const [, one, two, three] = handles(session) as [string, string, string, string];
    expect(session.formatParagraphs([one, two, three], { list: "numbered" }).ok).toBe(true);
    const numbers = () =>
      (session.read() as { blocks: { number?: string }[] }).blocks.map((b) => b.number ?? "");
    expect(numbers()).toEqual(["", "1.", "2.", "3."]);
    expect(session.formatParagraphs(two, { indent: "more" }).ok).toBe(true);
    expect(numbers()[2]).not.toBe("2.");
    expect(session.formatParagraphs([one, two, three], { list: null }).ok).toBe(true);
    expect(numbers()).toEqual(["", "", "", ""]);
    expect(session.formatParagraphs(one, { list: "bullet" }).ok).toBe(true);
    expect(numbers()[1]).not.toBe("");
  });

  it("refuses what it cannot do, through the tool too", () => {
    const session = open("x");
    const [x] = handles(session) as [string];
    for (const format of [
      {},
      { align: "middle" },
      { lineSpacing: 0 },
      { spaceAfter: -1 },
      { indent: 2 },
      { list: "roman" },
      { bold: true },
    ])
      expect(session.formatParagraphs(x, format as never).ok).toBe(false);
    expect(session.formatParagraphs([], { align: "center" }).ok).toBe(false);
    const tool = agentTools(session).find((t) => t.name === "format_paragraph");
    expect(tool?.run({ handles: [x], format: { align: "right" } }).isError).toBeUndefined();
    expect(tool?.run({ handles: [x], format: { align: "up" } }).isError).toBe(true);
  });
});
