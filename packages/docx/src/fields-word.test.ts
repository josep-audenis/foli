/**
 * `updateFields` against Word (11.8): on the corpus, with Word's own pages fed in as the layout,
 * every field works out to what Word has in `corpus/reference/word`, and nothing changes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createEditor,
  type Editor,
  type FieldLayout,
  fieldsIn,
  type Node,
  updateFields,
} from "@folijs/core";
import { describe, expect, it } from "vitest";
import { importDocx } from "./index.js";

const root = join(import.meta.dirname, "..", "..", "..", "corpus");
interface WordField {
  code: string;
  result: string;
  page: number;
}
interface WordDocument {
  pages: number;
  paragraphs: { text: string; page: number }[];
  fields: WordField[];
}
const reference = (name: string): WordDocument =>
  JSON.parse(
    readFileSync(join(root, "reference", "word", `${name}.json`), "utf8").replace(/^﻿/, ""),
  );

async function open(name: string, now?: Date) {
  const bytes = new Uint8Array(readFileSync(join(root, "word", `${name}.docx`)));
  const { document } = await importDocx(bytes);
  return { editor: createEditor({ document }), now };
}

/** The results, as the reference has them: Word's paragraph marks are left out there. */
const results = (editor: Editor) =>
  fieldsIn(editor.state.doc).map((f) => f.result.replace(/\r/g, ""));

/** Word's pages as a layout: a position is on its paragraph's page. */
function wordLayout(doc: Node, word: WordDocument): FieldLayout {
  const starts: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "paragraph") starts.push(pos);
    return !node.isTextblock;
  });
  expect(starts.length).toBe(word.paragraphs.length);
  return {
    pages: word.pages,
    pageAt(pos) {
      let i = starts.length - 1;
      while (i > 0 && (starts[i] as number) > pos) i--;
      const number = word.paragraphs[i]?.page ?? 1;
      return { number, sectionPages: word.pages };
    },
  };
}

describe.each(["01-mutual-nda", "04-board-report", "09-pump-test-memo"])(
  "%s against Word",
  (name) => {
    it("works every field out to Word's result, changing nothing", async () => {
      const word = reference(name);
      const { editor } = await open(name);
      const before = editor.state.doc;
      const report = updateFields(editor, { layout: wordLayout(before, word) });
      expect(report.skipped.filter((s) => s.reason !== "locked")).toEqual([]);
      expect(report.updated).toBe(0);
      expect(editor.state.doc).toBe(before);
      const fields = fieldsIn(editor.state.doc);
      expect(fields.map((f) => f.instruction)).toEqual(word.fields.map((f) => f.code));
      expect(results(editor)).toEqual(word.fields.map((f) => f.result));
    });

    it("gets Word's result back after every result is spoiled", async () => {
      const word = reference(name);
      const { editor } = await open(name);
      const layout = wordLayout(editor.state.doc, word);
      // Each non-locked field but the table of contents loses its result's text.
      const tr = editor.state.tr;
      for (const field of [...fieldsIn(editor.state.doc)].reverse()) {
        if (field.locked || field.name === "TOC" || field.parent?.name === "TOC") continue;
        if (field.resultTo > field.resultFrom) tr.delete(field.resultFrom, field.resultTo);
      }
      editor.dispatch(tr);
      updateFields(editor, { layout });
      expect(results(editor)).toEqual(word.fields.map((f) => f.result));
    });
  },
);

describe("04's table of contents", () => {
  it("is rebuilt as Word has it, when an entry is wrong", async () => {
    const word = reference("04-board-report");
    const { editor } = await open("04-board-report");
    const pages = new Map<string, number>();
    for (const p of word.paragraphs) pages.set(p.text, p.page);
    const toc = fieldsIn(editor.state.doc)[0];
    expect(toc?.name).toBe("TOC");
    // The first entry's title changed by hand: the whole table is built again.
    const at = (toc?.resultFrom ?? 0) + 1;
    editor.dispatch(editor.state.tr.insertText("X", at));
    // Pages by the heading's text: positions move when the table is built again.
    const layout: FieldLayout = {
      pages: word.pages,
      pageAt(pos) {
        const { parent } = editor.state.doc.resolve(pos);
        return { number: pages.get(parent.textContent) ?? 1, sectionPages: word.pages };
      },
    };
    const report = updateFields(editor, { layout });
    expect(report.rebuilt).toBe(1);
    const fields = fieldsIn(editor.state.doc);
    expect(results(editor)).toEqual(word.fields.map((f) => f.result));
    expect(fields.map((f) => f.instruction)).toEqual(word.fields.map((f) => f.code));
  });
});

describe("03's merge fields", () => {
  it("are filled from data, Word's date picture applied", async () => {
    const { editor } = await open("03-offer-letter-template");
    const report = updateFields(editor, {
      data: { candidatefirstname: "Ada", StartDate: new Date(2026, 2, 3) },
    });
    expect(report.updated).toBe(2);
    expect(results(editor)).toEqual(["Ada", "3 March 2026"]);
  });
});
