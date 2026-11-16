// Foli's reading of review content against Word's (9.8): the reference is what Word itself reports
// for the corpus (`scripts/corpus/word-review.ps1`, in corpus/reference/review).
import { readdirSync, readFileSync } from "node:fs";
import { createEditor, type FoliDocument, type NodeJSON } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { importDocx } from "./index.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const REFERENCE = new URL("../../../corpus/reference/review/", import.meta.url);
const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));

interface WordReview {
  revisions: { type: number; author: string; text: string }[];
  comments: { text: string; author: string; initials: string; parent: number; done: boolean }[];
  accepted: { text: string; inTable: boolean }[];
  rejected: { text: string; inTable: boolean }[];
}

const textOf = (p: NodeJSON) =>
  (p.content ?? [])
    .map((n) =>
      n.type === "text" ? n.text : n.type === "tab" ? "\t" : n.type === "hardBreak" ? "\n" : "",
    )
    .join("");
const paragraphs = (d: FoliDocument) =>
  (d.content.content ?? [])
    .filter((b) => b.type === "paragraph")
    .map((p) => textOf(p).toLowerCase());
const opaque = (d: FoliDocument) => JSON.stringify(d.content).includes('"type":"opaqueInline"');

describe("review content as Word reads it", () => {
  for (const name of names) {
    it(`${name}: the same comments, threads and resolved state`, async () => {
      const word = JSON.parse(
        readFileSync(new URL(name.replace(".docx", ".json"), REFERENCE), "utf8"),
      ) as WordReview;
      const { document } = await importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));
      const byId = new Map(document.comments.map((c) => [c.id, c]));
      const ours = document.comments.map((c) => ({
        text: c.content.map(textOf).join("\n"),
        author: c.author,
        initials: c.initials ?? "",
        parent:
          c.parent === undefined
            ? null
            : (byId.get(c.parent)?.content.map(textOf).join("\n") ?? null),
        done: c.done ?? false,
      }));
      const theirs = word.comments.map((c) => ({
        ...c,
        parent: c.parent < 0 ? null : (word.comments[c.parent]?.text ?? null),
      }));
      const order = (list: typeof ours) => [...list].sort((a, b) => a.text.localeCompare(b.text));
      expect(order(ours)).toEqual(order(theirs));
    });

    it(`${name}: accepting and rejecting every change gives Word's text`, async () => {
      const word = JSON.parse(
        readFileSync(new URL(name.replace(".docx", ".json"), REFERENCE), "utf8"),
      ) as WordReview;
      const { document } = await importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))));
      // Content Foli keeps verbatim (content controls, fields) has no text in Foli.
      if (opaque(document)) return;
      const outside = (list: { text: string; inTable: boolean }[]) =>
        list.filter((p) => !p.inTable).map((p) => p.text.toLowerCase());
      for (const accept of [true, false]) {
        const editor = createEditor({ document });
        if (accept) editor.commands.acceptAllChanges();
        else editor.commands.rejectAllChanges();
        // Case aside: Word's Range.Text applies the heading styles' all caps.
        expect(paragraphs(editor.getDocument()), accept ? "accepted" : "rejected").toEqual(
          outside(accept ? word.accepted : word.rejected),
        );
      }
    });
  }
});
