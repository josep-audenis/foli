import { createDocument, type FoliDocument } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { openSession, type Session } from "./index.js";

const blocks = (session: Session) => {
  const result = session.read();
  if (!result.ok) throw new Error(result.message);
  return result.blocks;
};
const p = (text: string, attrs?: Record<string, unknown>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text }],
});

describe("regressions: agent", () => {
  it("comment initials of an author whose name starts outside the BMP are well-formed", () => {
    const session = openSession(createDocument({ type: "doc", content: [p("Hello")] } as never), {
      author: "🤖 Bot",
    });
    const result = session.comment(blocks(session)[0]?.handle as string, "note");
    expect(result.ok).toBe(true);
    const initials = session.document().comments[0]?.initials as string;
    expect(initials).not.toMatch(/\p{Cs}/u); // no lone surrogate
  });

  it("comment initials are letters, not the punctuation a word starts with", () => {
    const session = openSession(createDocument({ type: "doc", content: [p("Hello")] } as never), {
      author: "Claude (trial)",
    });
    expect(session.comment(blocks(session)[0]?.handle as string, "note").ok).toBe(true);
    expect(session.document().comments[0]?.initials).toBe("Ct");
  });

  it("deleting the author's own inserted paragraph keeps another author's text in it", () => {
    const doc = createDocument({
      type: "doc",
      content: [
        p("Intro"),
        {
          type: "paragraph",
          attrs: { revision: { insertion: { id: 1, author: "Agent" } } },
          content: [
            {
              type: "text",
              text: "Draft ",
              marks: [{ type: "insertion", attrs: { id: 2, author: "Agent" } }],
            },
            {
              type: "text",
              text: "human words",
              marks: [{ type: "insertion", attrs: { id: 3, author: "Human" } }],
            },
          ],
        },
      ],
    } as never);
    const session = openSession(doc, { author: "Agent" });
    const last = blocks(session).at(-1);
    expect(last?.text).toBe("Draft human words");
    const result = session.deleteBlock(last?.handle as string);
    expect(result.ok).toBe(true);
    // The human's suggestion is still in the document (as a tracked deletion), not gone untracked.
    expect(JSON.stringify(session.document().content)).toContain("human words");
  });

  it("deleting untracked text in the author's own paragraph is a tracked change", () => {
    const doc = createDocument({
      type: "doc",
      content: [
        p("Intro"),
        p("typed with tracking off", { revision: { insertion: { id: 1, author: "Agent" } } }),
      ],
    } as never);
    const session = openSession(doc, { author: "Agent" });
    const last = blocks(session).at(-1);
    session.deleteBlock(last?.handle as string);
    expect(JSON.stringify(session.document().content)).toContain("typed with tracking off");
  });

  const dropDown = (): FoliDocument => ({
    ...createDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Pick: " },
            { type: "controlStart", attrs: { id: "c1" } },
            { type: "text", text: "One" },
            { type: "controlEnd", attrs: { id: "c1" } },
          ],
        },
      ],
    } as never),
    controls: {
      c1: {
        kind: "dropDown",
        tag: "choice",
        items: [
          { value: "1", display: "One" },
          { value: "2", display: "Two" },
        ],
      },
    },
  });

  it("a drop-down's value is one of the items it lists", () => {
    const session = openSession(dropDown(), { author: "Agent" });
    const control = session.controls()[0];
    expect(control?.items).toEqual(["One", "Two"]);
    expect(control?.items).toContain(control?.value);
  });

  it("filling a drop-down with the value read from it is not refused", () => {
    const session = openSession(dropDown(), { author: "Agent" });
    const value = session.controls()[0]?.value as string;
    expect(session.fillControl("choice", value).ok).toBe(true);
  });
});
