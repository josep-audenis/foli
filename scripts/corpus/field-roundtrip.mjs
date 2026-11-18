// Fields and content controls between Foli and Word (11.5). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/field-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/field-roundtrip.mjs check <dir>
//
// `make` exports every corpus document with fields or controls to <dir>/foli: as imported
// (<name>.docx) and edited (<name>-edited.docx: "Foli edit" added to the result of a REF, SEQ or
// MERGEFIELD field, and to the first text of each control not showing its placeholder; a block
// control of several blocks split by a paragraph put between them). `check` needs Word's data for
// every file made: each opened; an unchanged one has the original's fields and controls; an edited
// one Foli's edits, and one more control where one was split. One line per file; exits 1 on any
// difference.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/field-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const corpus = join(root, "corpus", "word");
const reference = join(root, "corpus", "reference", "word");
const EDIT = "Foli edit";
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));

const paragraphs = (node, out = []) => {
  if (node.type === "paragraph") out.push(node);
  for (const child of node.content ?? []) paragraphs(child, out);
  return out;
};

/** The text node after `from` in `nodes`, before `until` ends the search. */
const textAfter = (nodes, from, until) => {
  for (let i = from + 1; i < nodes.length && !until(nodes[i]); i++)
    if (nodes[i].type === "text") return nodes[i];
  return undefined;
};

function edited(document) {
  const copy = structuredClone(document);
  const editedFields = [];
  let controls = 0;
  for (const p of paragraphs(copy.content)) {
    const nodes = p.content ?? [];
    nodes.forEach((node, i) => {
      if (node.type === "fieldCode" && /^\s*(REF|SEQ|MERGEFIELD)\b/.test(node.attrs.text)) {
        const separator = nodes.findIndex((n, at) => at > i && n.type === "fieldSeparator");
        const text = separator >= 0 && textAfter(nodes, separator, (n) => n.type === "fieldEnd");
        if (text) {
          text.text += EDIT;
          editedFields.push(node.attrs.text.trim());
        }
      }
      if (node.type === "controlStart") {
        const control = copy.controls[node.attrs.id];
        const text = textAfter(nodes, i, (n) => n.type === "controlEnd");
        if (text && !control.placeholder?.showing && control.kind !== "checkbox") {
          text.text += EDIT;
          controls++;
        }
      }
    });
  }
  // A block control of two blocks or more: a paragraph outside it between them.
  const blocks = copy.content.content;
  let split = 0;
  for (let i = 0; i + 1 < blocks.length && !split; i++) {
    const id = blocks[i].attrs?.controls?.[0];
    if (id && blocks[i + 1].attrs?.controls?.[0] === id) {
      blocks.splice(i + 1, 0, { type: "paragraph" });
      split = 1;
    }
  }
  return { document: copy, expected: { editedFields, controls, split } };
}

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  const expected = {};
  for (const name of readdirSync(corpus).filter((n) => n.endsWith(".docx"))) {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(join(corpus, name))),
    );
    const text = JSON.stringify(document.content);
    if (!document.controls && !text.includes('"fieldCode"')) continue;
    writeFileSync(join(dir, "foli", name), await exportDocx(document, pkg));
    const change = edited(document);
    expected[name.replace(".docx", "")] = change.expected;
    writeFileSync(
      join(dir, "foli", name.replace(".docx", "-edited.docx")),
      await exportDocx(change.document, pkg),
    );
  }
  writeFileSync(join(dir, "expected.json"), JSON.stringify(expected));
  process.exit(0);
}

const expected = json(join(dir, "expected.json"));
let failed = 0;
for (const file of readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".docx"))) {
  const name = file.replace(".docx", "");
  const problems = [];
  const path = join(dir, "word", `${name}.json`);
  const word = existsSync(path) ? json(path) : undefined;
  if (!word) problems.push("no data from Word");
  else if (!word.opened) problems.push(`not opened: ${word.error}`);
  else {
    const base = json(join(reference, `${name.replace(/-edited$/, "")}.json`));
    if (!name.endsWith("-edited")) {
      if (word.pages !== base.pages) problems.push(`${word.pages} pages, Word's ${base.pages}`);
      for (const key of ["fields", "controls", "bookmarks"])
        if (JSON.stringify(word[key]) !== JSON.stringify(base[key])) problems.push(`${key} differ`);
    } else {
      const want = expected[name.replace(/-edited$/, "")];
      for (const code of want.editedFields)
        if (!word.fields.some((f) => f.code === code && f.result.includes(EDIT)))
          problems.push(`field ${code}: no edit`);
      const shown = word.controls.filter((c) => c.text.includes(EDIT)).length;
      if (shown < want.controls) problems.push(`${shown} edited controls, not ${want.controls}`);
      if (word.controls.length !== base.controls.length + want.split)
        problems.push(`${word.controls.length} controls, not ${base.controls.length + want.split}`);
      if (word.fields.length !== base.fields.length) problems.push("the fields' number changed");
    }
  }
  if (problems.length) failed++;
  console.log(`${name}: ${problems.length ? problems.join("; ") : "ok"}`);
}
if (failed) process.exitCode = 1;
