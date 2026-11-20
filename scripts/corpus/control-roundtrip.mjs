// Content controls between Foli and Word (11.9). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/control-roundtrip.mjs make <dir>
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/corpus/control-word.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/control-roundtrip.mjs check <dir>
//
// `make` writes what the editor makes of the corpus's offer letter (03, five controls) and of a new
// document: 03 unchanged, filled through the API, filled while tracking (and rejected), typed into, filled and
// emptied again, its properties changed, a control copied; a new document with every kind inserted,
// some filled, a repeating section grown. `check` has Word's reading say what Foli holds: every file
// opens, every control has its type, tag, title, placeholder state, text, locks, check box state,
// list items and date format, and no two have one id.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addRepeatingItem,
  controlsIn,
  createDocument,
  createEditor,
  insertControl,
  rejectAllChanges,
  setControlProperties,
} from "../../packages/core/dist/index.js";
// Not public since 12.2: the paste fitting and envelope step are core's internals.
import { fitPaste, withEnvelope } from "../../packages/core/dist/internal.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/control-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const TYPES = {
  richText: 0,
  text: 1,
  picture: 2,
  comboBox: 3,
  dropDown: 4,
  date: 6,
  checkbox: 8,
  repeating: 9,
};
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));

/** What Word should find: every control but repeating section items, which it does not list. */
function held(editor) {
  const { doc } = editor.state;
  const { controls } = editor.getDocument();
  const seen = new Set();
  return controlsIn(doc).flatMap((range) => {
    const control = controls[range.id];
    if (seen.has(range.id) || control.kind === "repeatingItem") return [];
    seen.add(range.id);
    const inner =
      range.level === "inline" ? [range.from + 1, range.to - 1] : [range.from, range.to];
    let text = "";
    doc.nodesBetween(inner[0], inner[1], (node, pos) => {
      if (node.isText && !node.marks.some((m) => m.type.name === "deletion"))
        text += node.text.slice(Math.max(0, inner[0] - pos), inner[1] - pos);
      return true;
    });
    return [
      {
        type: TYPES[control.kind],
        tag: control.tag ?? "",
        title: control.alias ?? "",
        placeholder: control.placeholder?.showing === true,
        text,
        lockContents: control.lock === "contentLocked" || control.lock === "sdtContentLocked",
        lockControl: control.lock === "sdtLocked" || control.lock === "sdtContentLocked",
        checked: control.kind === "checkbox" ? control.checked === true : null,
        entries: control.items?.map((i) => `${i.display ?? i.value}|${i.value}`) ?? [],
        dateFormat: control.kind === "date" ? (control.dateFormat ?? "") : null,
      },
    ];
  });
}

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  const { document, package: pkg } = await importDocx(
    new Uint8Array(readFileSync(join(root, "corpus", "word", "03-offer-letter-template.docx"))),
  );
  const open = (options) => createEditor({ document, author: "Foli Controls", ...options });
  const fill = (editor) => {
    const { setControlValue: set } = editor.commands;
    return [
      set("offer_date", new Date(2026, 2, 3)),
      set("position", "Senior Data Engineer"),
      set("salary", "90 000"),
      set("remote", true),
      set("benefits", "Everything"),
    ].every(Boolean);
  };
  const place = (editor, tag) => {
    const value = editor.controlValues().find((v) => v.tag === tag);
    return controlsIn(editor.state.doc).find((r) => r.id === value.id);
  };
  const cases = {};
  cases["03-asis"] = open();
  const filled = open();
  if (!fill(filled)) throw new Error("not filled");
  cases["03-filled"] = filled;
  const tracked = open({ trackChanges: true });
  if (!fill(tracked)) throw new Error("not filled while tracking");
  cases["03-tracked"] = tracked;
  const rejected = open({ trackChanges: true });
  fill(rejected);
  rejected.run(rejectAllChanges());
  cases["03-rejected"] = rejected;
  const typed = open();
  typed.select(place(typed, "salary").contentFrom);
  typed.commands.insertText("Typed");
  cases["03-typed"] = typed;
  const emptied = open();
  fill(emptied);
  for (const tag of ["offer_date", "position", "salary", "benefits"])
    emptied.commands.setControlValue(tag, null);
  cases["03-emptied"] = emptied;
  const changed = open();
  fill(changed);
  changed.run(setControlProperties("salary", { title: "Pay", tag: "pay", lock: "sdtLocked" }));
  changed.run(
    setControlProperties("position", {
      lock: "contentLocked",
      items: [
        { value: "a", display: "Analyst" },
        { value: "Senior Data Engineer", display: "Senior Data Engineer" },
      ],
    }),
  );
  changed.run(setControlProperties("offer_date", { dateFormat: "dd/MM/yyyy" }));
  cases["03-properties"] = changed;
  const copied = open();
  fill(copied);
  const salary = place(copied, "salary");
  const slice = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: copied.state.doc.slice(salary.from, salary.to).content.toJSON(),
      },
    ],
  };
  const fitted = fitPaste(copied.state, slice);
  const tr = copied.state.tr.insert(copied.state.doc.content.size, fitted.doc.content);
  withEnvelope(tr, fitted.envelope);
  copied.dispatch(tr);
  cases["03-copied"] = copied;

  const blank = createEditor({
    document: createDocument({
      type: "doc",
      content: ["one", "two", "three", "four", "five", "six", "section", "end"].map((text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      })),
    }),
  });
  const items = [
    { value: "a", display: "Alpha" },
    { value: "b", display: "Beta" },
  ];
  const kinds = [
    ["richText", { tag: "rich", title: "Rich" }],
    ["text", { tag: "plain", title: "Plain", lock: "sdtLocked" }],
    ["dropDown", { tag: "drop", items }],
    ["comboBox", { tag: "combo", items }],
    ["date", { tag: "date", dateFormat: "d MMMM yyyy" }],
    ["checkbox", { tag: "box", checked: true }],
  ];
  kinds.forEach(([kind, options], i) => {
    let pos = 0;
    blank.state.doc.forEach((node, offset, index) => {
      if (index === i) pos = offset + node.nodeSize - 1;
    });
    blank.select(pos);
    if (!blank.run(insertControl(kind, options))) throw new Error(`no ${kind}`);
  });
  blank.commands.setControlValue("rich", "Rich value");
  blank.commands.setControlValue("drop", "b");
  blank.commands.setControlValue("date", "2026-03-03");
  let section = 0;
  blank.state.doc.forEach((node, offset, index) => {
    if (index === 6) section = offset + 2;
  });
  blank.select(section);
  blank.run(insertControl("repeating", { tag: "rows", title: "Rows" }));
  blank.select(section);
  blank.run(addRepeatingItem());
  cases["new-controls"] = blank;

  const expected = {};
  for (const [name, editor] of Object.entries(cases)) {
    expected[name] = held(editor);
    const original = name.startsWith("03") ? pkg : undefined;
    writeFileSync(
      join(dir, "foli", `${name}.docx`),
      await exportDocx(editor.getDocument(), original, {
        trackRevisions: editor.trackingChanges,
      }),
    );
  }
  writeFileSync(join(dir, "expected.json"), JSON.stringify(expected, null, 1));
  process.exit(0);
}

const expected = json(join(dir, "expected.json"));
let failed = 0;
for (const file of readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".docx"))) {
  const name = file.replace(".docx", "");
  const problems = [];
  const word = json(join(dir, "word", `${name}.json`));
  if (!word.opened) problems.push(`not opened: ${word.error}`);
  else {
    const found = [word.controls].flat();
    const want = expected[name];
    if (found.length !== want.length)
      problems.push(`${found.length} controls, Foli holds ${want.length}`);
    if (new Set(found.map((c) => c.id)).size !== found.length) problems.push("repeated ids");
    want.forEach((control, i) => {
      const got = found[i];
      if (!got) return;
      for (const key of Object.keys(control)) {
        const a = JSON.stringify([control[key]].flat());
        const b = JSON.stringify([got[key]].flat());
        // Word shows dates in the language of its control: compared by being there.
        if (a !== b && !(key === "text" && control.type === 6 && got.text))
          problems.push(`${control.tag || i} ${key}: Word ${b}, Foli ${a}`);
      }
    });
  }
  if (problems.length) failed++;
  console.log(
    `${name}: ${problems.length ? problems.join("; ") : `ok (${expected[name].length})`}`,
  );
}
if (failed) process.exitCode = 1;
