// Regressions (Phase 21, 21.11: what costs a model retries). Each test failed before its fix.
import { createDocument, findInText, type NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { openSession as open, type Session } from "./index.js";

const openSession = (document: Parameters<typeof open>[0]) => open(document, { author: "Bot" });

const p = (text: string, attrs?: Record<string, unknown>): NodeJSON => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text }],
});
const blocks = (session: Session) => {
  const result = session.read();
  if (!result.ok) throw new Error(result.message);
  return result.blocks;
};

describe("21.11", () => {
  it("find looks through soft hyphens and zero-width spaces, and takes a non-breaking hyphen as -", () => {
    expect(findInText("co­operate", "cooperate")).toEqual([[0, 10]]);
    expect(findInText("a​b c", "ab")).toEqual([[0, 3]]);
    expect(findInText("well‑known", "well-known")).toEqual([[0, 10]]);
    const session = openSession(createDocument({ type: "doc", content: [p("co­operate")] }));
    const handle = blocks(session)[0]?.handle as string;
    expect(session.replaceText(handle, "cooperate", "work").ok).toBe(true);
  });

  it("a refusal quotes invisible and look-alike characters escaped, and never half a pair", () => {
    const session = openSession(
      createDocument({ type: "doc", content: [p(`well‑known ${"😀".repeat(1200)}`)] }),
    );
    const handle = blocks(session)[0]?.handle as string;
    const result = session.replaceText(handle, "well‐known", "x");
    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.message;
    expect(message).toContain("\\u2010");
    expect(message).toContain("\\u2011");
    expect(message).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it("read gives a cell's grid column, its span and a vertical merge", () => {
    const cell = (text: string, attrs: Record<string, unknown> = {}): NodeJSON => ({
      type: "tableCell",
      attrs,
      content: [p(text)],
    });
    const session = openSession(
      createDocument({
        type: "doc",
        content: [
          {
            type: "table",
            attrs: { grid: [1000, 1000, 1000] },
            content: [
              {
                type: "tableRow",
                content: [cell("wide", { gridSpan: 2 }), cell("top", { vMerge: "restart" })],
              },
              {
                type: "tableRow",
                content: [cell("a"), cell("b"), cell("under", { vMerge: "continue" })],
              },
            ],
          },
          p("after"),
        ],
      }),
    );
    const read = session.read();
    const text = read.ok ? read.text : "";
    expect(text).toContain("table, 2 rows, 3 columns");
    expect(text).toMatch(/r1 c1-2.*: wide/);
    expect(text).toMatch(/r1 c3, merged down.*: top/);
    expect(text).toMatch(/r2 c3, merged up/);
  });
});
