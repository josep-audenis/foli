import { readFileSync } from "node:fs";
import { exportDocx, importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { agentTools, openSession, type Session } from "./index.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const open = async (name: string) => {
  const { document, package: pkg } = await importDocx(
    new Uint8Array(readFileSync(new URL(name, CORPUS))),
  );
  return { session: openSession(document, { author: "Agent" }), pkg };
};
const lines = (session: Session) =>
  (session.read({ headers: true }) as { text: string }).text.split("\n");
const handleOf = (session: Session, text: string) =>
  (session.read({ headers: true }) as { blocks: { handle: string; text: string }[] }).blocks.find(
    (b) => b.text === text,
  )?.handle as string;

describe("headers and footers (23.7)", () => {
  it("reads them after the body only when asked, each under where it is used", async () => {
    const { session } = await open("04-board-report.docx");
    expect((session.read() as { text: string }).text).not.toMatch(/^\[h\d+\]/m);
    const read = lines(session);
    expect(read).toContain("header of sections 1–2:");
    expect(read).toContain("[h1] header: Quarterly Board Report - Q1 2026");
    expect(read.some((l) => /^\[f\d+\] footer: Page/.test(l))).toBe(true);
    const block = (
      session.read({ headers: true }) as { blocks: { handle: string; story?: object }[] }
    ).blocks.find((b) => b.handle === "h1");
    expect(block?.story).toMatchObject({ kind: "header" });
  });

  it("edits a header with the same operations, as a tracked change, and saves it", async () => {
    const { session, pkg } = await open("04-board-report.docx");
    const h1 = handleOf(session, "Quarterly Board Report - Q1 2026");
    const done = session.replaceText(h1, "Q1 2026", "Q1 2026 (draft)");
    expect(done.ok && done.text).toBe(
      "[h1] header, changed: Quarterly Board Report - Q1 2026 (draft)",
    );
    expect(session.formatText(h1, { bold: true }, { on: "(draft)" }).ok).toBe(true);
    expect(session.insertAfter(h1, "Confidential").ok).toBe(true);
    expect(lines(session)).toContain("[h4] header, changed: Confidential");
    const { document } = await importDocx(await exportDocx(session.document(), pkg));
    const again = openSession(document, { author: "B" });
    expect(lines(again).join("\n")).toMatch(/Q1 2026 \(draft\)[\s\S]*Confidential/);
    session.editor.commands.rejectAllChanges();
    expect(lines(session)).toContain("[h1] header: Quarterly Board Report - Q1 2026");
  });

  it("refuses a comment in a header, and through the tools takes h and f handles", async () => {
    const { session } = await open("04-board-report.docx");
    const h1 = handleOf(session, "Quarterly Board Report - Q1 2026");
    const comment = session.comment(h1, "Check");
    expect(comment.ok || comment.message).toMatch(/no comments in headers and footers/);
    const tools = new Map(agentTools(session).map((t) => [t.name, t]));
    const read = tools.get("read")?.run({ headers: true });
    expect(read?.text).toContain("[h1] header:");
    const set = tools.get("set_style")?.run({ handle: h1, style: "Normal" });
    expect(set?.isError).toBeUndefined();
    // A handle a read never gave is refused, as in the body.
    expect(session.replaceText("h99", "a", "b").ok).toBe(false);
  });

  it("labels first-page and even-page parts as Word shows them (23.7 review)", async () => {
    const { session } = await open("04-board-report.docx");
    const labels = lines(session).filter((l) => !l.startsWith("["));
    expect(labels).toContain("header of section 1, first page:");
    expect(labels.some((l) => l.includes("even pages"))).toBe(false);
    const newsletter = await open("08-newsletter.docx");
    expect(lines(newsletter.session)).toContain("header of sections 1–5, even pages:");
  });

  it("keeps header handles through body edits, undo, a rollback and setDocument (23.7 review)", async () => {
    const { session } = await open("04-board-report.docx");
    const h1 = handleOf(session, "Quarterly Board Report - Q1 2026");
    const first = (session.read() as { blocks: { handle: string }[] }).blocks[0]?.handle as string;
    expect(session.insertBefore(first, "A new first paragraph").ok).toBe(true);
    expect(session.replaceText(h1, "Q1", "Q2").ok).toBe(true);
    session.editor.commands.undo();
    expect((session.block(h1) as { text: string }).text).toBe(
      "[h1] header: Quarterly Board Report - Q1 2026",
    );
    // A rollback brings back a removed story block under its handle.
    const added = session.insertAfter(h1, "X");
    const x = added.ok ? (added.blocks[0]?.handle as string) : "";
    const point = session.checkpoint();
    expect(session.deleteBlock(x).ok).toBe(true);
    point.rollback();
    expect(session.block(x).ok).toBe(true);
    // A new document: every handle goes, and a read gives the headers new ones that work.
    session.editor.setDocument(session.document());
    expect(session.block(h1).ok).toBe(false);
    const again = handleOf(session, "Quarterly Board Report - Q1 2026");
    expect(session.replaceText(again, "Q1", "Q3").ok).toBe(true);
    expect(lines(session).join(" ")).toContain("Q3 2026");
  });

  it("refuses breaks and notes in a header, and blocks of two stories in one call", async () => {
    const { session } = await open("04-board-report.docx");
    const h1 = handleOf(session, "Quarterly Board Report - Q1 2026");
    for (const item of [{ kind: "pageBreak" }, { kind: "footnote", text: "x" }] as const) {
      const refused = session.insertItem(h1, item);
      expect(refused.ok || refused.message).toMatch(/no page or section breaks and no notes/);
    }
    const f1 = (session.read({ headers: true }) as { blocks: { handle: string }[] }).blocks.find(
      (b) => b.handle.startsWith("f"),
    )?.handle as string;
    const mixed = session.formatParagraphs([h1, f1], { align: "center" });
    expect(mixed.ok || mixed.message).toMatch(/different stories/);
  });
});
