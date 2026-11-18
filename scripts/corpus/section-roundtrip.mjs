// Sections between Foli and Word (11.6). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/section-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/section-roundtrip.mjs check <dir>
//
// `make` exports the corpus's document with sections (08) to <dir>/foli: as imported; edited by
// the editor's commands (a continuous break in its first section, three columns in the section
// after it, a line between two columns in the last section); the same edits made while tracking;
// and a new package with two columns, set widths, an odd page section, page numbers and note
// properties (00-new-sections). `check` needs Word's data for every file: each opened; the
// unchanged one has Word's own pages and sections; the edited ones Foli's sections, as Word reads
// them (tracked changes accepted), the tracked one with Word counting the break and the setups as
// tracked changes. One line per file; exits 1 on any difference.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDocument,
  createEditor,
  insertSectionBreak,
  setSectionSetup,
} from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/section-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const NAME = "08-newsletter";
const source = join(root, "corpus", "word", `${NAME}.docx`);
const reference = join(root, "corpus", "reference", "word", `${NAME}.json`);
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
// WdSectionStart.
const CONTINUOUS = 0;
const NEW_PAGE = 2;
const ODD_PAGE = 4;

/** The position inside the top-level block at `index`, `offset` characters in. */
function inside(state, index, offset = 0) {
  let at = 0;
  for (let i = 0; i < index; i++) at += state.doc.child(i).nodeSize;
  return at + 1 + offset;
}

/** The edits, made through the commands the toolbar runs. Later blocks first: indexes hold. */
function edit(document, trackChanges) {
  const editor = createEditor({ document, trackChanges, author: "Foli Reviewer" });
  const last = editor.state.doc.childCount - 1;
  editor.select(inside(editor.state, last));
  editor.run(setSectionSetup({ columns: { count: 2, space: 708, separator: true } }));
  // A paragraph of the second section (two columns before: three now).
  editor.select(inside(editor.state, 6));
  editor.run(setSectionSetup({ columns: { count: 3, space: 500 } }));
  editor.select(inside(editor.state, 2, 10));
  editor.run(insertSectionBreak("continuous"));
  return editor.getDocument();
}

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  const write = (name, data) => writeFileSync(join(dir, "foli", `${name}.docx`), data);
  const { document, package: pkg } = await importDocx(new Uint8Array(readFileSync(source)));
  write(NAME, await exportDocx(document, pkg));
  write(`${NAME}-edited`, await exportDocx(edit(document, false), pkg));
  write(`${NAME}-tracked`, await exportDocx(edit(document, true), pkg));
  const paragraph = (text, section) => ({
    type: "paragraph",
    ...(section ? { attrs: { section } } : {}),
    content: [{ type: "text", text }],
  });
  const blank = createDocument({
    type: "doc",
    content: [
      paragraph("Two columns with a line.", {
        columns: { count: 2, space: 708, separator: true },
        footnotes: { format: "lowerRoman", restart: "eachSect" },
      }),
      paragraph("Set widths.", {
        type: "continuous",
        columns: {
          count: 2,
          space: 360,
          equalWidth: false,
          widths: [{ width: 3000, space: 360 }, { width: 6000 }],
        },
        endnotes: { position: "sectEnd" },
      }),
      paragraph("An odd page section, numbered from 7."),
    ],
  });
  write(
    "00-new-sections",
    await exportDocx({
      ...blank,
      section: { ...blank.section, type: "oddPage", pageNumbers: { start: 7, format: "decimal" } },
    }),
  );
  process.exit(0);
}

let failed = 0;
const base = json(reference);
const shape = (sections) => sections.map((s) => [s.start, s.columns]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** What the edits should give, section by section: Word's start and columns. */
const edited = (() => {
  const sections = shape(base.sections);
  sections[1] = [sections[1][0], 3];
  sections[sections.length - 1] = [sections.at(-1)[0], 2];
  sections.splice(1, 0, [CONTINUOUS, sections[0][1]]);
  return sections;
})();
const expected = {
  [NAME]: shape(base.sections),
  [`${NAME}-edited`]: edited,
  [`${NAME}-tracked`]: edited,
  "00-new-sections": [
    [NEW_PAGE, 2],
    [CONTINUOUS, 2],
    [ODD_PAGE, 1],
  ],
};
for (const file of readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".docx"))) {
  const name = file.replace(".docx", "");
  const path = join(dir, "word", `${name}.json`);
  const problems = [];
  if (!existsSync(path)) problems.push("no data from Word");
  else {
    const word = json(path);
    if (!word.opened) problems.push(`not opened: ${word.error}`);
    else {
      const got = shape(word.sections);
      if (!same(got, expected[name]))
        problems.push(`sections ${JSON.stringify(got)}, not ${JSON.stringify(expected[name])}`);
      if (name === NAME) {
        if (word.pages !== base.pages) problems.push(`${word.pages} pages, Word's ${base.pages}`);
        if (!same(word.sections, base.sections)) problems.push("sections differ from Word's own");
      }
      const revisions = name.endsWith("-tracked") ? 3 : 0;
      if (word.revisionsAccepted !== revisions)
        problems.push(`${word.revisionsAccepted} tracked changes, expected ${revisions}`);
    }
  }
  if (problems.length) failed++;
  console.log(`${name}: ${problems.length ? problems.join("; ") : "ok"}`);
}
if (failed) process.exitCode = 1;
