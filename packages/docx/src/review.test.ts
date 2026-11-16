import { readFileSync } from "node:fs";
import { createEditor, type NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { exportDocx, importDocx } from "./index.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const REFERENCE = new URL("../../../corpus/reference/word/", import.meta.url);
const NAME = "02-services-agreement-redlined.docx";

/** A paragraph's text as Word's `Range.Text` gives it. */
const textOf = (paragraph: NodeJSON): string =>
  (paragraph.content ?? [])
    .map((n) =>
      n.type === "text" ? n.text : n.type === "tab" ? "\t" : n.type === "hardBreak" ? "\n" : "",
    )
    .join("");
const paragraphs = (content: NodeJSON) =>
  (content.content ?? []).filter((b) => b.type === "paragraph");
const REVIEW = /"type":"(insertion|deletion|formatChange)"|"revision":\{|"formatChange":\{/;

describe("the redlined agreement", () => {
  it("accepting every change gives Word's text with changes accepted", async () => {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(new URL(NAME, CORPUS))),
    );
    expect(JSON.stringify(document.content)).toMatch(REVIEW);
    const editor = createEditor({ document });
    expect(editor.commands.acceptAllChanges()).toBe(true);
    const accepted = editor.getDocument();
    expect(JSON.stringify(accepted.content)).not.toMatch(REVIEW);
    const reference = JSON.parse(
      readFileSync(new URL(NAME.replace(".docx", ".json"), REFERENCE), "utf8"),
    ) as { paragraphs: { text: string; inTable: boolean }[] };
    // Case aside: Word's Range.Text applies the heading styles' all caps.
    expect(paragraphs(accepted.content).map((p) => textOf(p).toLowerCase())).toEqual(
      reference.paragraphs.filter((p) => !p.inTable).map((p) => p.text.toLowerCase()),
    );
    // And it is still a package Foli writes and reads back.
    const again = await importDocx(await exportDocx(accepted, pkg));
    expect(paragraphs(again.document.content).map(textOf)).toEqual(
      paragraphs(accepted.content).map(textOf),
    );
  });

  it("rejecting every change leaves no inserted text and keeps the deleted", async () => {
    const { document } = await importDocx(new Uint8Array(readFileSync(new URL(NAME, CORPUS))));
    // Without inserted text, a paragraph whose mark was inserted joined with the next.
    const original: string[] = [];
    let carried = "";
    for (const p of paragraphs(document.content)) {
      carried += (p.content ?? [])
        .filter((n) => !(n.marks ?? []).some((m) => m.type === "insertion"))
        .map((n) => (n.type === "text" ? n.text : ""))
        .join("");
      if ((p.attrs?.revision as { insertion?: unknown } | undefined)?.insertion) continue;
      original.push(carried);
      carried = "";
    }
    const editor = createEditor({ document });
    editor.commands.rejectAllChanges();
    const rejected = editor.getDocument();
    expect(JSON.stringify(rejected.content)).not.toMatch(REVIEW);
    expect(paragraphs(rejected.content).map((p) => textOf(p))).toEqual(original);
  });
});
