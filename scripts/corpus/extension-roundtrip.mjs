// Custom nodes and marks between Foli and Word (ADR-0008, 12.3). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/extension-roundtrip.mjs make <dir>
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/corpus/extension-word.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/extension-roundtrip.mjs check <dir>
//
// `make` writes: `sample` (mentions, one bold and one in a table cell, topic marks, a block card)
// exported with the extension; `long-tag` (a mention whose tag is 255 characters, the most a tag
// holds); `foreign` (the sample read back by an editor without the extension and exported from
// it: foreign nodes keep their control text); `typed` (made through the editor's commands). Word
// lists each file's content controls, types into the first marked run and at the start, and saves.
// `check` has Word's list match the controls Foli wrote (in order: a node a locked plain text
// control showing its text, a marked run a rich text control around it, every tag as written) and
// Foli read Word's file back with every node and mark as it was, the typed text under the mark.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDocument,
  createEditor,
  Fragment,
  Slice,
  TextSelection,
  toggleMark,
} from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/extension-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));

const acme = {
  name: "acme",
  nodes: {
    "acme:mention": {
      inline: true,
      attrs: { id: {}, label: {} },
      text: (attrs) => `@${attrs.label}`,
    },
    "acme:card": { attrs: { id: {} }, text: (attrs) => `Card ${attrs.id}` },
  },
  marks: { "acme:topic": { attrs: { topic: {} }, inclusive: false } },
};
const extensions = [acme];
const isCustom = (type) => type.includes(":");
const text = (value, marks) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const mention = (id, label, marks) => ({
  type: "acme:mention",
  attrs: { id, label },
  ...(marks ? { marks } : {}),
});
const topic = (value) => ({ type: "acme:topic", attrs: { topic: value } });
const bold = { type: "bold" };

function sample() {
  const cell = (content) => ({ type: "tableCell", content: [{ type: "paragraph", content }] });
  return createDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          text("Ask "),
          mention("u-42", "Ada Lovelace"),
          text(" about the "),
          text("budget", [topic("finance")]),
          text(" and "),
          text("plan", [bold, topic("finance")]),
          text("."),
        ],
      },
      { type: "acme:card", attrs: { id: "c-1" } },
      {
        type: "table",
        attrs: { grid: [4000, 4000] },
        content: [
          {
            type: "tableRow",
            content: [
              cell([mention("u-7", "Grace", [bold])]),
              cell([text("roadmap", [topic("product-2027")])]),
            ],
          },
        ],
      },
      { type: "paragraph" },
    ],
  });
}

function longTag() {
  const base = `foli:${JSON.stringify({ node: "acme:mention", attrs: { id: "u-1", label: "" } })}`;
  const label = "Long label ".repeat(30).slice(0, 255 - base.length);
  return createDocument({
    type: "doc",
    content: [{ type: "paragraph", content: [text("Tag "), mention("u-1", label)] }],
  });
}

/** Typed through the editor: text, a mention inserted, a word marked. */
function typed() {
  const editor = createEditor({ extensions });
  editor.commands.insertText("Ask ");
  editor.run((state, dispatch) => {
    const node = state.schema.nodes["acme:mention"].create({ id: "u-42", label: "Ada Lovelace" });
    dispatch(state.tr.replaceSelection(new Slice(Fragment.from(node), 0, 0)));
    return true;
  });
  editor.commands.insertText(" about the budget");
  const end = editor.state.selection.from;
  editor.run((state, dispatch) => {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, end - 6, end)));
    return true;
  });
  editor.run(toggleMark("acme:topic", { topic: "finance" }));
  return editor.getDocument();
}

/** Custom nodes and the text under custom marks, in order, with their other marks. */
function customs(tree) {
  const found = [];
  const walk = (node) => {
    // `runExt` is the `w:rPr` an import keeps verbatim, not formatting of its own.
    const marks = (node.marks ?? []).filter((m) => m.type !== "runExt");
    if (isCustom(node.type)) found.push({ node: node.type, attrs: node.attrs, marks });
    else if (marks.some((m) => isCustom(m.type))) found.push({ text: node.text, marks });
    node.content?.forEach(walk);
  };
  walk(tree);
  // Adjacent text under the same marks is one run (Word may split or join runs).
  return found.reduce((out, item) => {
    const last = out[out.length - 1];
    if (item.text && last?.text && JSON.stringify(last.marks) === JSON.stringify(item.marks))
      last.text += item.text;
    else out.push({ ...item });
    return out;
  }, []);
}

/** The controls Word should list for the body, in order (ADR-0008's mapping). */
function controls(document) {
  const textOf = (node) => acme.nodes[node.type].text(node.attrs);
  const tag = (value) => `foli:${JSON.stringify(value)}`;
  const out = [];
  const inlines = (items) => {
    for (let i = 0; i < items.length; ) {
      const mark = items[i].marks?.find((m) => isCustom(m.type));
      if (mark) {
        let j = i;
        while (
          j < items.length &&
          items[j].marks?.some((m) => JSON.stringify(m) === JSON.stringify(mark))
        )
          j++;
        const run = items.slice(i, j);
        const shown = run.map((n) => n.text ?? (isCustom(n.type) ? textOf(n) : "")).join("");
        out.push({
          type: 0,
          tag: tag({ mark: mark.type, attrs: mark.attrs }),
          text: shown,
          lockContents: false,
        });
        inlines(run.map((n) => ({ ...n, marks: n.marks.filter((m) => m !== mark) })));
        i = j;
        continue;
      }
      if (isCustom(items[i].type))
        out.push({
          type: 1,
          tag: tag({ node: items[i].type, attrs: items[i].attrs }),
          text: textOf(items[i]),
          lockContents: true,
        });
      i++;
    }
  };
  const blocks = (node) => {
    if (isCustom(node.type))
      out.push({
        type: 1,
        tag: tag({ node: node.type, attrs: node.attrs }),
        text: textOf(node),
        lockContents: true,
      });
    else if (node.type === "paragraph") inlines(node.content ?? []);
    else node.content?.forEach(blocks);
  };
  blocks(document.content);
  return out;
}

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  const write = async (name, document, options) => {
    writeFileSync(
      join(dir, "foli", `${name}.docx`),
      await exportDocx(document, undefined, options),
    );
  };
  const cases = { sample: sample(), "long-tag": longTag(), typed: typed() };
  for (const [name, document] of Object.entries(cases)) await write(name, document, { extensions });
  // An editor without the extension: foreign content, written back with the controls' text.
  const read = await importDocx(readFileSync(join(dir, "foli", "sample.docx")));
  const foreign = createEditor({ document: read.document });
  if (foreign.state.doc.firstChild.child(1).type.name !== "foreignInline")
    throw new Error("not foreign without the extension");
  await write("foreign", foreign.getDocument());
  cases.foreign = sample();
  const expected = Object.fromEntries(
    Object.entries(cases).map(([name, document]) => [
      name,
      { customs: customs(document.content), controls: controls(document) },
    ]),
  );
  writeFileSync(join(dir, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(cases).length} files to ${join(dir, "foli")}`);
} else {
  const expected = json(join(dir, "expected.json"));
  const names = readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".docx"));
  let failed = 0;
  for (const file of names) {
    const name = file.replace(/\.docx$/, "");
    const wanted = expected[name];
    const report = json(join(dir, "word", `${name}.json`));
    const problems = [];
    if (report.error) problems.push(`Word: ${report.error}`);
    const listed = (report.controls ?? []).map((c) => ({ ...c, text: c.text.replace(/\r$/, "") }));
    if (JSON.stringify(listed) !== JSON.stringify(wanted.controls))
      problems.push(
        `controls: Word ${JSON.stringify(listed)} vs ${JSON.stringify(wanted.controls)}`,
      );
    const { document } = await importDocx(readFileSync(join(dir, "word", file)));
    // Valid for the extension, and with every node and mark; the first marked run has Word's text.
    const back = customs(createEditor({ document, extensions }).getDocument().content);
    const want = structuredClone(wanted.customs);
    const firstRun = want.find((c) => c.text);
    if (firstRun) firstRun.text += " typed";
    if (JSON.stringify(back) !== JSON.stringify(want))
      problems.push(`read back: ${JSON.stringify(back)} vs ${JSON.stringify(want)}`);
    if (!JSON.stringify(document.content).includes("Word edit. "))
      problems.push("Word's edit lost");
    if (problems.length) failed++;
    console.log(
      `${problems.length ? "FAIL" : "ok  "} ${name}: ${listed.length} controls in Word, ${back.length} custom items read back`,
    );
    for (const problem of problems) console.log(`     ${problem}`);
  }
  console.log(`${names.length - failed} of ${names.length} passed`);
  process.exit(failed ? 1 : 0);
}
