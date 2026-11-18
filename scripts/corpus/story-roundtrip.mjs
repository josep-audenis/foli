// Headers, footers and notes between Foli and Word (11.4). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/story-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/story-roundtrip.mjs check <dir>
//
// `make` exports every corpus document with stories to <dir>/foli twice: as imported (<name>.docx)
// and edited (<name>-edited.docx: "Foli edit" added to every header and footer and to the last
// normal note, and one new footnote story with its reference at the end of the first paragraph),
// and a new package with a header, a footer, a footnote and an endnote (00-new-stories). `check`
// reads what Word made of them: each opened, as many pages as the original has (edited ones may
// differ by what the text adds), the stories' text as Foli wrote it. One line per document; exits
// 1 on any difference.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDocument } from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/story-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const corpus = join(root, "corpus", "word");
const reference = join(root, "corpus", "reference", "word");
const EDIT = "Foli edit";
const ADDED = "A note Foli added";
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
const paragraph = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content) => ({ type: "doc", content });
/** A note's text after its number, as Word expects (it reads a note's first character as that). */
const note = (text) =>
  doc({
    type: "paragraph",
    content: [{ type: "noteMark" }, { type: "text", text: ` ${text}` }],
  });
const names = readdirSync(corpus).filter((n) => n.endsWith(".docx"));

function edited(document) {
  const copy = structuredClone(document);
  const stories = copy.stories ?? {};
  const notes = Object.keys(stories).filter(
    (id) => stories[id].kind === "footnote" && (stories[id].noteType ?? "normal") === "normal",
  );
  for (const [id, story] of Object.entries(stories)) {
    if (story.kind === "header" || story.kind === "footer" || id === notes.at(-1))
      story.content.content.at(-1).content = [
        ...(story.content.content.at(-1).content ?? []),
        { type: "text", text: ` ${EDIT}` },
      ];
  }
  const free = Math.max(0, ...notes.map((id) => Number(id.split(":")[1]))) + 1;
  stories[`footnote:${free}`] = { kind: "footnote", content: note(ADDED) };
  copy.stories = stories;
  const first = copy.content.content.find((b) => b.type === "paragraph");
  first.content = [
    ...(first.content ?? []),
    { type: "noteReference", attrs: { story: `footnote:${free}` } },
  ];
  return copy;
}

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  const write = async (name, data) => writeFileSync(join(dir, "foli", name), data);
  for (const name of names) {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(join(corpus, name))),
    );
    if (!document.stories) continue;
    await write(name, await exportDocx(document, pkg));
    await write(name.replace(".docx", "-edited.docx"), await exportDocx(edited(document), pkg));
  }
  const blank = createDocument(
    doc({
      type: "paragraph",
      content: [
        { type: "text", text: "Body" },
        { type: "noteReference", attrs: { story: "footnote:1" } },
        { type: "noteReference", attrs: { story: "endnote:1" } },
      ],
    }),
  );
  await write(
    "00-new-stories.docx",
    await exportDocx({
      ...blank,
      section: { ...blank.section, headers: { default: "h1" }, footers: { default: "f1" } },
      stories: {
        h1: { kind: "header", content: doc(paragraph("New header")) },
        f1: { kind: "footer", content: doc(paragraph("New footer")) },
        "footnote:1": { kind: "footnote", content: note("New footnote") },
        "endnote:1": { kind: "endnote", content: note("New endnote") },
      },
    }),
  );
  process.exit(0);
}

let failed = 0;
const report = (name, problems) => {
  if (problems.length) failed++;
  console.log(`${name}: ${problems.length ? problems.join("; ") : "ok"}`);
};
const storyTexts = (word, side) =>
  word.sections.flatMap((s) => Object.values(s[side]).map((v) => v.text));
for (const file of readdirSync(join(dir, "word")).filter((n) => n.endsWith(".json"))) {
  const word = json(join(dir, "word", file));
  const name = file.replace(".json", "");
  const problems = [];
  if (!word.opened) {
    report(name, [`not opened: ${word.error}`]);
    continue;
  }
  const notes = word.notes.map((n) => n.text);
  if (name === "00-new-stories") {
    if (!storyTexts(word, "headers").includes("New header")) problems.push("header");
    if (!storyTexts(word, "footers").includes("New footer")) problems.push("footer");
    if (!notes.some((t) => t.includes("New footnote"))) problems.push("footnote");
    if (!notes.some((t) => t.includes("New endnote"))) problems.push("endnote");
    report(name, problems);
    continue;
  }
  const isEdited = name.endsWith("-edited");
  const base = json(join(reference, `${name.replace(/-edited$/, "")}.json`));
  if (isEdited) {
    if (!notes.some((t) => t.includes(ADDED))) problems.push("the added note is missing");
    if (word.notes.length !== base.notes.length + 1)
      problems.push(`${word.notes.length} notes, expected ${base.notes.length + 1}`);
    const parts = [...storyTexts(word, "headers"), ...storyTexts(word, "footers")];
    if (base.sections.some((s) => Object.values(s.headers).some((h) => h.exists && h.text.trim())))
      if (!parts.some((t) => t.includes(EDIT))) problems.push("the edited header or footer");
  } else {
    if (word.pages !== base.pages) problems.push(`${word.pages} pages, Word's ${base.pages}`);
    if (JSON.stringify(word.notes) !== JSON.stringify(base.notes)) problems.push("notes differ");
    if (JSON.stringify(word.sections) !== JSON.stringify(base.sections))
      problems.push("sections differ");
  }
  report(name, problems);
}
if (failed) process.exitCode = 1;
