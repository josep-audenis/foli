import { readdirSync, readFileSync } from "node:fs";
import { type NodeJSON, Resolver } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { importDocx } from "../index.js";

const CORPUS = new URL("../../../../corpus/word/", import.meta.url);
const REFERENCE = new URL("../../../../corpus/reference/word/", import.meta.url);
const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));

/** Every paragraph in document order (table cells included), and whether it is in a table. */
function paragraphs(
  node: NodeJSON,
  inTable = false,
  out: { node: NodeJSON; inTable: boolean }[] = [],
) {
  if (node.type === "paragraph") out.push({ node, inTable });
  for (const c of node.content ?? []) paragraphs(c, inTable || node.type === "table", out);
  return out;
}

describe("list numbers on the Word corpus", () => {
  for (const name of names) {
    it(`${name}: every paragraph outside tables has the list number Word shows`, async () => {
      const { document } = await importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));
      const reference = JSON.parse(
        readFileSync(new URL(name.replace(".docx", ".json"), REFERENCE), "utf8"),
      ) as { paragraphs: { text: string; listString: string; inTable: boolean }[] };
      const all = paragraphs(document.content);
      const markers = new Resolver(document).markers(all.map((p) => p.node.attrs ?? {}));
      const actual = all.flatMap((p, i) => (p.inTable ? [] : [markers[i]?.text ?? ""]));
      const expected = reference.paragraphs.filter((p) => !p.inTable).map((p) => p.listString);
      if (name.startsWith("03-")) {
        // Content controls are opaque blocks until Phase 11: their paragraphs are not read.
        expect(expected.filter(Boolean)).toEqual(actual.filter(Boolean));
      } else expect(actual).toEqual(expected);
    });
  }

  it("the corpus has numbered and bulleted lists", () => {
    const strings = names.flatMap((name) =>
      (
        JSON.parse(readFileSync(new URL(name.replace(".docx", ".json"), REFERENCE), "utf8")) as {
          paragraphs: { listString: string }[];
        }
      ).paragraphs.map((p) => p.listString),
    );
    expect(strings).toContain("1.1");
    expect(strings).toContain("(a)");
    expect(strings).toContain("");
  });
});
