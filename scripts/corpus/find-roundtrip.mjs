// Find and replace, and bookmarks, between Foli and Word (11.11). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/find-roundtrip.mjs make <dir>
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/corpus/find-word.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/find-roundtrip.mjs check <dir>
//
// `make` replaces a word over the body and every story of two corpus documents with stories (09,
// with footnotes and endnotes; 05, with a page number in its header) and of a new document with a
// header, a footer and both kinds of note, untracked and tracked, and adds bookmarks to them: over
// a selection, at a point, in a header, one renamed, one moved by using its name again, one deleted.
// `check` has Word's reading say what Foli holds: every file opens; per kind of story, the
// replacement is there as often and the old word is gone (tracked: both are there, accepting leaves
// the new text and rejecting the old); changes are recorded in every story that was replaced in; the
// bookmarks are there with their text. One line per file; exits 1 on any difference.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDocument,
  createEditor,
  deleteBookmark,
  ensureStory,
  findAll,
  insertBookmark,
  insertNote,
  listBookmarks,
  renameBookmark,
  replaceAll,
} from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/find-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const NEW_TEXT = "ZQXW";
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
const count = (text, word) => text.split(word).length - 1;

/** Which of Word's kinds of story a match is in. */
function kindOf(editor, story) {
  if (story === null) return "main";
  return editor.getDocument().stories?.[story]?.kind ?? "main";
}

/** How many matches each kind of story has. */
function matchesByKind(editor, word) {
  const out = { main: 0, footnote: 0, endnote: 0, header: 0, footer: 0 };
  for (const match of findAll(editor, word, { matchCase: true }))
    out[kindOf(editor, match.story)]++;
  return out;
}

function newDocument(trackChanges = false) {
  const editor = createEditor({
    document: createDocument({
      type: "doc",
      content: ["The cat sat.", "A second cat here.", "The end."].map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    }),
    author: "Foli Find",
  });
  for (const side of ["header", "footer"]) {
    if (!editor.run(ensureStory(side, "default", 0))) throw new Error(`no ${side}`);
  }
  const put = (id, text) => {
    const story = editor.story(id);
    story.select(story.state.doc.content.size - 1);
    story.commands.insertText(text);
  };
  const { section } = editor.getDocument();
  put(section.headers.default, "A cat on top");
  put(section.footers.default, "A cat below");
  editor.select(5);
  editor.run(insertNote("footnote"));
  editor.select(editor.state.doc.content.size - 1);
  editor.run(insertNote("endnote"));
  for (const [id, story] of Object.entries(editor.getDocument().stories))
    if (story.kind === "footnote" || story.kind === "endnote")
      if (!story.noteType) put(id, "with a cat in it");
  if (trackChanges) editor.commands.setTrackChanges(true);
  return editor;
}

/** Bookmarks as each way of making them leaves them. */
function addBookmarks(editor) {
  const add = (name, from, to, on = editor) => {
    const made = insertBookmark(on, name, { from, to });
    if (!made.ok) throw new Error(`${name}: ${made.reason}`);
  };
  add("OverText", 1, 4);
  add("AtPoint", 6, 6);
  add("OldName", 5, 8);
  add("ToDelete", 2, 3);
  add("Moved", 1, 2);
  add("MOVED", 3, 6);
  if (!renameBookmark(editor, "OldName", "NewName").ok) throw new Error("not renamed");
  if (!deleteBookmark(editor, "ToDelete")) throw new Error("not deleted");
  const { section } = editor.getDocument();
  const header = section.headers?.default && editor.story(section.headers.default);
  if (header) add("InHeader", 1, 3, header);
}

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  const expected = {};
  const write = async (name, editor, original, extra = {}) => {
    expected[name] = {
      ...extra,
      bookmarks: listBookmarks(editor).map(({ name: n, text }) => ({ name: n, text })),
    };
    writeFileSync(
      join(dir, "foli", `${name}.docx`),
      await exportDocx(editor.getDocument(), original, { trackRevisions: editor.trackingChanges }),
    );
  };
  const replaced = async (name, make, word, original) => {
    for (const tracked of [false, true]) {
      const editor = make(tracked);
      const found = matchesByKind(editor, word);
      const before = matchesByKind(editor, NEW_TEXT);
      const report = replaceAll(editor, word, NEW_TEXT, { matchCase: true });
      if (!report.replaced) throw new Error(`${name}: nothing replaced`);
      await write(`${name}-${tracked ? "tracked" : "replaced"}`, editor, original, {
        word,
        tracked,
        found,
        before,
        refused: report.refused.length,
      });
    }
  };
  await replaced("new", newDocument, "cat");
  for (const [file, word] of [
    ["09-pump-test-memo", "the"],
    ["05-business-letter", "the"],
  ]) {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(join(root, "corpus", "word", `${file}.docx`))),
    );
    const open = (trackChanges) => createEditor({ document, trackChanges, author: "Foli Find" });
    await replaced(file.slice(0, 2), open, word, pkg);
    const marked = open(false);
    addBookmarks(marked);
    await write(`${file.slice(0, 2)}-bookmarks`, marked, pkg);
  }
  const marked = newDocument();
  addBookmarks(marked);
  await write("new-bookmarks", marked);
  writeFileSync(join(dir, "expected.json"), JSON.stringify(expected, null, 1));
  process.exit(0);
}

const expected = json(join(dir, "expected.json"));
let failed = 0;
for (const file of readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".docx"))) {
  const name = file.replace(".docx", "");
  const want = expected[name];
  const word = json(join(dir, "word", `${name}.json`));
  const problems = [];
  if (!word.opened || word.error) problems.push(`not read: ${word.error}`);
  else {
    if (want.word)
      for (const kind of ["main", "footnote", "endnote", "header", "footer"]) {
        const found = want.found[kind];
        // A header is read once per section that links to it: there, not how many times.
        const same = (got, wanted) =>
          kind === "header" || kind === "footer" ? got > 0 === wanted > 0 : got === wanted;
        const added = count(word.stories[kind], NEW_TEXT);
        if (!same(added, found)) problems.push(`${kind}: ${added} replaced, Foli ${found}`);
        if (want.tracked) {
          if (found && !word.changes[kind]) problems.push(`${kind}: no changes recorded`);
          const kept = count(word.rejected[kind], want.word);
          if (count(word.rejected[kind], NEW_TEXT))
            problems.push(`${kind}: rejected keeps new text`);
          if (kept < found) problems.push(`${kind}: rejected gives ${kept} of ${found}`);
          if (!same(count(word.accepted[kind], NEW_TEXT), found))
            problems.push(`${kind}: accepted lost the new text`);
        } else if (count(word.stories[kind], want.word) && !want.refused)
          problems.push(`${kind}: the old word is still there`);
      }
    const marks = [word.bookmarks].flat();
    for (const mark of want.bookmarks) {
      const got = marks.find((m) => m.name.toLowerCase() === mark.name.toLowerCase());
      if (!got) problems.push(`no bookmark ${mark.name}`);
      else if (got.text.trim() !== mark.text.trim())
        problems.push(`${mark.name}: Word "${got.text}", Foli "${mark.text}"`);
    }
    if (marks.length !== want.bookmarks.length)
      problems.push(`${marks.length} bookmarks, Foli ${want.bookmarks.length}`);
  }
  if (problems.length) failed++;
  console.log(`${name}: ${problems.length ? problems.join("; ") : "ok"}`);
}
if (failed) process.exitCode = 1;
