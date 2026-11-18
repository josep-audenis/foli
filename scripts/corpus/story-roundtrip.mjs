// Headers, footers and notes between Foli and Word (11.4). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/story-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/story-roundtrip.mjs check <dir>
//
// `make` exports every corpus document with stories to <dir>/foli twice: as imported (<name>.docx)
// and edited (<name>-edited.docx: "Foli edit" added to every header and footer and to the last
// normal note, a table in every header, and a new footnote with a tracked insertion, its
// reference at the end of the first paragraph), and a new package with a header, a footer, a
// footnote and an endnote (00-new-stories). 11.7 adds headers changed through the editor's
// commands: 08 without even pages or a first page and with its last section's header unlinked
// (08-newsletter-commands), 05 with even pages on and a header typed in through `editor.story`
// (05-business-letter-commands), and a new package with even and odd headers (00-new-settings).
// `check` needs Word's data for every file made: each
// opened; an unchanged one has the original's pages, sections and notes; an edited one every
// header and footer with its original text, the edit and (headers) one more table, its pictures
// showing the same image bytes, every other note as it was and in its place, the edited and the
// added note, and the tracked insertion. One line per file; exits 1 on any difference.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDocument,
  createEditor,
  setDifferentEvenPages,
  setDifferentFirstPage,
  setStoryLinked,
} from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

/** Each story's pictures, in order, as the bytes of their images. */
async function storyImages(path) {
  const { document, package: pkg } = await importDocx(new Uint8Array(readFileSync(path)));
  const images = {};
  for (const [id, story] of Object.entries(document.stories ?? {})) {
    const found = [];
    const walk = (node) => {
      if (node.type === "picture") {
        const part = document.resources?.[node.attrs.resource]?.part;
        found.push(part ? Buffer.from(pkg.part(`/${part}`).data).toString("base64") : "");
      }
      for (const child of node.content ?? []) walk(child);
    };
    walk(story.content);
    images[id] = found;
  }
  return images;
}

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
const CELL = "Foli cell";
const TYPED = "Foli typed";
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
    if (story.kind === "header")
      story.content.content.unshift({
        type: "table",
        attrs: { grid: [2000] },
        content: [
          { type: "tableRow", content: [{ type: "tableCell", content: [paragraph(CELL)] }] },
        ],
      });
  }
  const free = Math.max(0, ...notes.map((id) => Number(id.split(":")[1]))) + 1;
  stories[`footnote:${free}`] = {
    kind: "footnote",
    content: doc({
      type: "paragraph",
      content: [
        { type: "noteMark" },
        {
          type: "text",
          text: ` ${ADDED}`,
          marks: [{ type: "insertion", attrs: { id: 90_001, author: "Foli" } }],
        },
      ],
    }),
  };
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
  const commands = async (name, change) => {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(join(corpus, `${name}.docx`))),
    );
    const editor = createEditor({ document });
    change(editor);
    await write(`${name}-commands.docx`, await exportDocx(editor.getDocument(), pkg));
  };
  await commands("08-newsletter", (editor) => {
    editor.run(setDifferentEvenPages(false));
    editor.run(setDifferentFirstPage(false, 0));
    editor.run(setStoryLinked("header", "default", false, 4));
  });
  await commands("05-business-letter", (editor) => {
    editor.run(setDifferentEvenPages(true));
    const header = editor.story("rId7");
    header.select(1);
    header.commands.insertText(`${TYPED} `);
  });
  await write(
    "00-new-settings.docx",
    await exportDocx({
      ...createDocument(doc(paragraph("Body"))),
      section: { ...createDocument().section, headers: { default: "h1", even: "h2" } },
      settings: { evenAndOddHeaders: true },
      stories: {
        h1: { kind: "header", content: doc(paragraph("Odd header")) },
        h2: { kind: "header", content: doc(paragraph("Even header")) },
      },
    }),
  );
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
for (const file of readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".docx"))) {
  const name = file.replace(".docx", "");
  const path = join(dir, "word", `${name}.json`);
  if (!existsSync(path)) {
    report(name, ["no data from Word"]);
    continue;
  }
  const word = json(path);
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
  if (name === "00-new-settings") {
    if (word.evenAndOddHeaders !== true) problems.push("even and odd headers are off");
    const { default: odd, even } = word.sections[0].headers;
    if (!odd.text.includes("Odd header")) problems.push("default header");
    if (!even.exists || !even.text.includes("Even header")) problems.push("even header");
    report(name, problems);
    continue;
  }
  if (name === "08-newsletter-commands") {
    const base = json(join(reference, "08-newsletter.json"));
    if (word.evenAndOddHeaders !== false) problems.push("even and odd headers are still on");
    if (word.sections[0].differentFirstPage !== false) problems.push("still a first page");
    const header = word.sections[4].headers.default;
    if (header.linked !== false) problems.push("the last section's header is still linked");
    if (header.text !== base.sections[4].headers.default.text)
      problems.push(`the unlinked header says "${header.text}"`);
    report(name, problems);
    continue;
  }
  if (name === "05-business-letter-commands") {
    if (word.evenAndOddHeaders !== true) problems.push("even and odd headers are off");
    if (!word.sections[0].headers.default.text.startsWith(TYPED)) problems.push("typed text");
    report(name, problems);
    continue;
  }
  const isEdited = name.endsWith("-edited");
  const base = json(join(reference, `${name.replace(/-edited$/, "")}.json`));
  if (isEdited) {
    if (!notes.some((t) => t.includes(ADDED))) problems.push("the added note is missing");
    if (word.notes.length !== base.notes.length + 1)
      problems.push(`${word.notes.length} notes, expected ${base.notes.length + 1}`);
    const footnotes = base.notes.filter((n) => n.kind === "footnote");
    if (footnotes.length && !notes.some((t) => t.includes(EDIT))) problems.push("the edited note");
    // Every original note, in order, once the added one is left out.
    const kept = word.notes.filter((n) => !n.text.includes(ADDED));
    base.notes.forEach((original, i) => {
      const note = kept[i];
      if (note?.kind !== original.kind || !note.text.includes(original.text))
        problems.push(`note ${i + 1} is not the original's`);
    });
    const source = join(corpus, `${name.replace(/-edited$/, "")}.docx`);
    const before = await storyImages(source);
    const after = await storyImages(join(dir, "foli", file));
    for (const [id, images] of Object.entries(before))
      if (JSON.stringify(images) !== JSON.stringify(after[id] ?? []))
        problems.push(`story ${id}: its pictures changed`);
    const added = word.notes.find((n) => n.text.includes(ADDED));
    if (added?.revisions !== 1) problems.push(`added note: ${added?.revisions} revisions, not 1`);
    for (const side of ["headers", "footers"])
      base.sections.forEach((section, s) => {
        for (const [variant, story] of Object.entries(section[side])) {
          if (!story.exists || !story.text.trim()) continue;
          const text = word.sections[s]?.[side][variant]?.text ?? "";
          if (!text.includes(EDIT)) problems.push(`section ${s + 1} ${side} ${variant}: no edit`);
          if (!text.includes(story.text.trim()))
            problems.push(`section ${s + 1} ${side} ${variant}: lost its text`);
          if (side === "headers" && !text.includes(CELL))
            problems.push(`section ${s + 1} header ${variant}: no table`);
          const tables = word.sections[s]?.[side][variant]?.tables;
          if (side === "headers" && tables !== story.tables + 1)
            problems.push(`section ${s + 1} header ${variant}: ${tables} tables`);
        }
      });
  } else {
    if (word.pages !== base.pages) problems.push(`${word.pages} pages, Word's ${base.pages}`);
    if (JSON.stringify(word.notes) !== JSON.stringify(base.notes)) problems.push("notes differ");
    if (JSON.stringify(word.sections) !== JSON.stringify(base.sections))
      problems.push("sections differ");
  }
  report(name, problems);
}
if (failed) process.exitCode = 1;
