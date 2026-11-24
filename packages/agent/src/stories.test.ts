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
});
