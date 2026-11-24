import { createDocument, setSectionSetup, trackedChanges } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { agentTools, openSession } from "./index.js";

const doc = () =>
  createDocument({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
      { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
    ],
  });
const handles = (session: ReturnType<typeof openSession>) =>
  (session.read() as { blocks: { handle: string }[] }).blocks.map((b) => b.handle);

describe("review (23.8)", () => {
  it("is refused unless the session reviews, and its tool is not offered", () => {
    const session = openSession(doc(), { author: "Agent" });
    expect(session.reviewing).toBe(false);
    expect(session.changes().ok).toBe(false);
    expect(session.acceptChanges("all").ok).toBe(false);
    expect(agentTools(session).some((t) => t.name === "review")).toBe(false);
  });

  it("lists changes, accepts some by id and rejects the rest", () => {
    const author = openSession(doc(), { author: "Bob" });
    const [first, second] = handles(author) as [string, string];
    author.replaceText(first, "First", "Opening");
    author.insertAfter(second, "A third one.");
    const session = openSession(author.document(), { author: "Reviewer", review: true });
    const listed = session.changes();
    expect(listed.ok).toBe(true);
    const text = listed.ok ? listed.text : "";
    expect(text).toMatch(/^\[c\d+\] deleted, Bob \(\d{4}-\d\d-\d\d\), in \[b1\]: "First"$/m);
    expect(text).toMatch(/^\[c\d+\] inserted, Bob .*: "Opening"$/m);
    const ids = listed.ok ? listed.changes.filter((c) => c.block === "b1").map((c) => c.id) : [];
    expect(session.acceptChanges(ids).ok).toBe(true);
    expect((session.read() as { text: string }).text).toContain("Opening paragraph.");
    expect(trackedChanges(session.editor.state.doc).every((c) => !ids.includes(c.id))).toBe(true);
    const rejected = session.rejectChanges("all", { author: "Bob" });
    expect(rejected.ok).toBe(true);
    expect(trackedChanges(session.editor.state.doc)).toEqual([]);
    expect((session.read() as { text: string }).text).not.toContain("A third one.");
    expect(session.acceptChanges([424242]).ok).toBe(false);
    expect(session.acceptChanges("all").ok).toBe(false);
  });

  it("works through the review tool", () => {
    const author = openSession(doc(), { author: "Bob" });
    author.replaceText(handles(author)[0] as string, "First", "Opening");
    const session = openSession(author.document(), { author: "Reviewer", review: true });
    const review = agentTools(session).find((t) => t.name === "review");
    expect(review?.run({ action: "list" }).text).toMatch(/\[c\d+\] deleted/);
    expect(review?.run({ action: "accept", ids: "all" }).text).toBe("All changes accepted.");
    expect(review?.run({ action: "list" }).text).toBe("The body has no tracked changes.");
    expect(review?.run({ action: "reject" }).isError).toBe(true);
  });

  it("decides the last section's setup change by id, and refuses an empty author (23.8 review)", () => {
    const author = openSession(doc(), { author: "Bob" });
    author.editor.select(1);
    expect(author.editor.run(setSectionSetup({ pageSize: { width: 16838, height: 11906 } }))).toBe(
      true,
    );
    const session = openSession(author.document(), { author: "Reviewer", review: true });
    const listed = session.changes();
    const setup = listed.ok
      ? listed.changes.find((c) => c.kind === "sectionFormatting")
      : undefined;
    expect(setup).toBeDefined();
    const done = session.rejectChanges([setup?.id as number]);
    expect(done.ok && done.text).toBe(`Rejected c${setup?.id}.`);
    expect(session.document().section.pageSize?.width).not.toBe(16838);
    expect(session.acceptChanges("all", { author: "" }).ok).toBe(false);
    expect(session.acceptChanges([1], { author: "Bob" }).ok).toBe(false);
    expect(session.acceptChanges("all", null).ok).toBe(false);
  });
});
