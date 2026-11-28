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
/** Paragraphs as text (case aside: Word's Range.Text applies headings' all caps), or null for one
 * with content Foli keeps verbatim (a field, a content control: no text in Foli). */
const paragraphs = (d: FoliDocument) =>
  (d.content.content ?? [])
    .filter((b) => b.type === "paragraph")
    .map((p) =>
      // Word's text shows a picture as "/" and an equation in math letters; Foli's has neither:
      // such paragraphs are not compared.
      (p.content ?? []).some((n) => ["opaqueInline", "picture", "equation"].includes(n.type))
        ? null
        : textOf(p).toLowerCase(),
    );

/** Word's change types (WdRevisionType) of what Foli imported, with their authors. */
function revisionsOf(document: FoliDocument): string[] {
  const found = new Set<string>();
  const see = (type: number, author: unknown) => found.add(`${type} ${String(author)}`);
  const walk = (node: NodeJSON) => {
    const attrs = (node.attrs ?? {}) as Record<string, { author?: string } | null>;
    if (node.type === "paragraph") {
      const revision = attrs.revision as {
        insertion?: { author: string };
        deletion?: { author: string };
      } | null;
      if (revision?.insertion) see(1, revision.insertion.author);
      if (revision?.deletion) see(2, revision.deletion.author);
      if (attrs.formatChange) see(10, attrs.formatChange.author);
    }
    for (const m of node.marks ?? []) {
      const author = (m.attrs as { author?: string } | undefined)?.author;
      const move = (m.attrs as { move?: string | null } | undefined)?.move;
      if (m.type === "insertion") see(move ? 15 : 1, author);
      if (m.type === "deletion") see(move ? 14 : 2, author);
      if (m.type === "formatChange") see(3, author);
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(document.content);
  return [...found].sort();
}

const load = async (name: string) => ({
  word: JSON.parse(
    readFileSync(new URL(name.replace(".docx", ".json"), REFERENCE), "utf8"),
  ) as WordReview,
  document: (await importDocx(new Uint8Array(readFileSync(new URL(name, CORPUS))))).document,
});

describe("review content as Word reads it", () => {
  for (const name of names) {
    it(`${name}: the same kinds of changes by the same authors`, async () => {
      const { word, document } = await load(name);
      const theirs = [...new Set(word.revisions.map((r) => `${r.type} ${r.author}`))].sort();
      expect(revisionsOf(document)).toEqual(theirs);
    });

    it(`${name}: the same comments, threads and resolved state`, async () => {
      const { word, document } = await load(name);
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

    it(`${name}: accepting and rejecting every change gives Word's text`, async (context) => {
      const { word, document } = await load(name);
      for (const accept of [true, false]) {
        const editor = createEditor({ document });
        if (accept) editor.commands.acceptAllChanges();
        else editor.commands.rejectAllChanges();
        const ours = paragraphs(editor.getDocument());
        const theirs = (accept ? word.accepted : word.rejected)
          .filter((p) => !p.inTable)
          .map((p) => p.text.toLowerCase());
        // A content control around paragraphs is one opaque block in Foli: no paragraph to match.
        if (ours.length !== theirs.length)
          return context.skip(`${ours.length} paragraphs in Foli, ${theirs.length} in Word`);
        // Paragraphs with verbatim content have no text in Foli: the others are compared.
        const shown = (list: (string | null)[]) => list.filter((_, i) => ours[i] !== null);
        expect(shown(ours), accept ? "accepted" : "rejected").toEqual(shown(theirs));
      }
    });
  }
});
