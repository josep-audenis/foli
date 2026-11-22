import { readdirSync, readFileSync } from "node:fs";
import {
  createDocument,
  createEditor,
  insertHorizontalRule,
  type NodeJSON,
  parseDocument,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";

/**
 * Core's 0.x fixtures (one per schema version) saved to `.docx` and read back. Those read from a
 * corpus file refer to its parts (headers, pictures), so they are written with that package.
 */
const dir = new URL("../../core/fixtures/formats/", import.meta.url);
const corpus = new URL("../../../corpus/word/", import.meta.url);
const OPAQUE = "\u0000";
const text = (node: NodeJSON): string =>
  node.type.startsWith("opaque")
    ? OPAQUE
    : (node.text ?? (node.content ?? []).map((child) => text(child)).join(""));
/**
 * Every piece of `before` between opaque nodes is in `after`, in order: opaque content may be
 * read as Foli's own when read again (v3 kept tables opaque, v3 and v4 headers and notes).
 */
const kept = (before: string, after: string) => {
  let at = 0;
  for (const piece of before.split(OPAQUE)) {
    const found = after.indexOf(piece, at);
    if (found < 0) return piece;
    at = found + piece.length;
  }
  return true;
};

describe("0.x formats through .docx", () => {
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    it(`keeps the text of ${name}`, async () => {
      const loaded = parseDocument(JSON.parse(readFileSync(new URL(name, dir), "utf8")));
      const source = name.match(/^v\d-(.+)\.json$/)?.[1];
      const original = source
        ? (await importDocx(new Uint8Array(readFileSync(new URL(`${source}.docx`, corpus)))))
            .package
        : undefined;
      const { document } = await importDocx(await exportDocx(loaded, original));
      expect(kept(text(loaded.content), text(document.content))).toBe(true);
      expect(document.comments.length).toBe(loaded.comments.length);
      expect(Object.keys(document.stories ?? {})).toEqual(
        expect.arrayContaining(Object.keys(loaded.stories ?? {})),
      );
      for (const [key, story] of Object.entries(loaded.stories ?? {}))
        expect(
          kept(text(story.content), text(document.stories?.[key]?.content ?? { type: "doc" })),
        ).toBe(true);
    });
  }
});

describe("a horizontal line through .docx (19.1)", () => {
  it("keeps the rule's paragraph border", async () => {
    const editor = createEditor({
      document: createDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "abcd" }] }],
      }),
    });
    editor.select(3);
    expect(editor.run(insertHorizontalRule)).toBe(true);
    const { document } = await importDocx(await exportDocx(editor.getDocument()));
    expect(document.content.content?.map((b) => b.attrs?.borders ?? null)).toEqual([
      null,
      { bottom: { style: "single", size: 6, space: 1, color: "auto" } },
      null,
    ]);
  });
});
