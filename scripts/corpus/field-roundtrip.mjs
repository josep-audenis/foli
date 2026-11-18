// Fields and content controls between Foli and Word (11.5). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/field-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/field-roundtrip.mjs check <dir>
//
// `make` exports every corpus document with fields or controls, in its body or stories, to
// <dir>/foli: as imported (<name>.docx) and edited (<name>-edited.docx: "Foli edit" added to the
// result of a REF, SEQ or MERGEFIELD field and to the first text of each control; text added to
// every header or footer holding a field, so Foli writes those fields; a block control of several
// blocks split by a paragraph put between them). The corpus's own controls show their
// placeholders and stay verbatim, so 00-controls adds an inline and a block control to a document
// (and must see both edited). `check` needs Word's data for every file made: each opened; an
// unchanged one has the original's fields, controls, bookmarks and sections; an edited one Foli's
// edits, and one more control where one was split. One line per file; exits 1 on any difference.
//
// Since 11.8 it also has Word read what `updateFields` and the insert commands write, with Word's
// pages as the layout: <name>-updated (every result spoiled, then updated), 04-rebuilt (an entry
// spoiled, the table of contents built again), 03-merged (merge fields filled from data while
// tracking), 04-inserted (a page number, the date, cross-references and a new table of contents).
// Word must find exactly the fields and results Foli holds (a `DATE`'s result aside: Word
// recomputes an unlocked one on opening).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createEditor,
  crossReferenceTargets,
  fieldsIn,
  insertCrossReference,
  insertDate,
  insertPageNumber,
  insertTableOfContents,
  updateFields,
} from "../../packages/core/dist/index.js";
import { exportDocx, importDocx, readPackage } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/field-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const corpus = join(root, "corpus", "word");
const reference = join(root, "corpus", "reference", "word");
const EDIT = "Foli edit";
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^ï»¿/, ""));

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
  // A header or footer holding a field: rewritten by Foli, with the field in it.
  let stories = 0;
  for (const story of Object.values(copy.stories ?? {})) {
    if (story.kind !== "header" && story.kind !== "footer") continue;
    if (!JSON.stringify(story.content).includes('"fieldCode"')) continue;
    const last = story.content.content.at(-1);
    if (last.type !== "paragraph") continue;
    last.content = [...(last.content ?? []), { type: "text", text: ` ${EDIT}` }];
    stories++;
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
  return { document: copy, expected: { editedFields, controls, split, stories } };
}

/** Word's pages as a layout: a position is on its paragraph's page. */
function wordLayout(doc, word) {
  const starts = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "paragraph") starts.push(pos);
    return !node.isTextblock;
  });
  return {
    pages: word.pages,
    pageAt(pos) {
      let i = starts.length - 1;
      while (i > 0 && starts[i] > pos) i--;
      return { number: word.paragraphs[i]?.page ?? 1, sectionPages: word.pages };
    },
  };
}

const heldFields = (editor) =>
  fieldsIn(editor.state.doc).map((f) => ({
    code: f.instruction,
    result: f.result.replace(/\r/g, ""),
  }));

/** Documents written through `updateFields` and the insert commands, by file name. */
function fieldEdits(name, document) {
  const base = name.replace(".docx", "");
  const word = json(join(reference, `${base}.json`));
  const open = (options) => createEditor({ document, author: "Foli Fields", ...options });
  const out = {};
  if (word.fields.some((f) => f.type !== 59)) {
    const editor = open();
    const tr = editor.state.tr;
    for (const field of [...fieldsIn(editor.state.doc)].reverse())
      if (!field.locked && field.name !== "TOC" && field.parent?.name !== "TOC")
        if (field.resultTo > field.resultFrom) tr.delete(field.resultFrom, field.resultTo);
    editor.dispatch(tr);
    updateFields(editor, { layout: wordLayout(editor.state.doc, word) });
    out[`${base}-updated`] = editor;
  }
  if (base.startsWith("03")) {
    const editor = open({ trackChanges: true });
    updateFields(editor, { data: { CandidateFirstName: "Ada", StartDate: new Date(2026, 2, 3) } });
    out[`${base}-merged`] = editor;
  }
  if (base.startsWith("04")) {
    const pages = new Map(word.paragraphs.map((p) => [p.text, p.page]));
    const rebuilt = open();
    const toc = fieldsIn(rebuilt.state.doc)[0];
    rebuilt.dispatch(rebuilt.state.tr.insertText("X", toc.resultFrom + 1));
    updateFields(rebuilt, {
      layout: {
        pages: word.pages,
        pageAt: (pos) => ({
          number: pages.get(rebuilt.state.doc.resolve(pos).parent.textContent) ?? 1,
          sectionPages: word.pages,
        }),
      },
    });
    out[`${base}-rebuilt`] = rebuilt;

    const inserted = open();
    const layout = () => wordLayout(inserted.state.doc, word);
    const end = () => {
      let pos = 0;
      inserted.state.doc.forEach((node, at) => {
        if (node.type.name === "paragraph") pos = at + node.nodeSize - 1;
      });
      return pos;
    };
    inserted.select(end());
    inserted.run(insertPageNumber({ layout: layout() }));
    inserted.commands.insertText(" ");
    inserted.run(insertDate("d MMMM yyyy", { now: new Date(2026, 2, 3) }));
    inserted.commands.insertText(" ");
    const heading = crossReferenceTargets(inserted.state).headings[1];
    inserted.run(insertCrossReference({ to: heading.pos, layout: layout() }));
    inserted.commands.insertText(" ");
    inserted.run(
      insertCrossReference({
        to: crossReferenceTargets(inserted.state).headings[1].pos,
        show: "page",
        layout: layout(),
      }),
    );
    inserted.select(1);
    inserted.run(insertTableOfContents({ from: 1, to: 2, layout: layout() }));
    out[`${base}-inserted`] = inserted;
  }
  return out;
}

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  const expected = {};
  for (const name of readdirSync(corpus).filter((n) => n.endsWith(".docx"))) {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(join(corpus, name))),
    );
    const text = JSON.stringify([document.content, document.stories]);
    if (!document.controls && !text.includes('"fieldCode"')) continue;
    await both(name, document, pkg);
  }
  // Controls the model holds: added to a document the corpus has.
  const source = await readPackage(
    new Uint8Array(readFileSync(join(corpus, "05-business-letter.docx"))),
  );
  const main = source.text(source.mainDocument);
  const run = (text) => `<w:r><w:t>${text}</w:t></w:r>`;
  const properties = (id, kind) =>
    `<w:sdtPr><w:alias w:val="C${id}"/><w:tag w:val="c${id}"/><w:id w:val="${id}"/>${kind}</w:sdtPr>`;
  const added =
    `<w:p>${run("Before ")}<w:sdt>${properties(9001, "<w:text/>")}<w:sdtContent>${run("value")}</w:sdtContent></w:sdt></w:p>` +
    `<w:sdt>${properties(9002, "")}<w:sdtContent><w:p>${run("first")}</w:p><w:p>${run("second")}</w:p></w:sdtContent></w:sdt>`;
  const at = main.indexOf("<w:p>") >= 0 ? main.indexOf("<w:p>") : main.indexOf("<w:p ");
  const fixture = await source.write(
    new Map([
      [
        source.mainDocument,
        new TextEncoder().encode(`${main.slice(0, at)}${added}${main.slice(at)}`),
      ],
    ]),
  );
  const read = await importDocx(fixture);
  await both("00-controls.docx", read.document, read.package);
  writeFileSync(join(dir, "expected.json"), JSON.stringify(expected));
  process.exit(0);

  async function both(name, document, pkg) {
    writeFileSync(join(dir, "foli", name), await exportDocx(document, pkg));
    const change = edited(document);
    expected[name.replace(".docx", "")] = change.expected;
    writeFileSync(
      join(dir, "foli", name.replace(".docx", "-edited.docx")),
      await exportDocx(change.document, pkg),
    );
    if (name.startsWith("00")) return;
    for (const [file, editor] of Object.entries(fieldEdits(name, document))) {
      expected[file] = { fields: heldFields(editor) };
      writeFileSync(
        join(dir, "foli", `${file}.docx`),
        await exportDocx(editor.getDocument(), pkg, { trackRevisions: editor.trackingChanges }),
      );
    }
  }
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
  else if (expected[name]?.fields) {
    const held = expected[name].fields;
    // Word counts a `w:hyperlink` to a bookmark (a table of contents' entries) as a field.
    const fields = word.fields.filter((f) => !f.code.startsWith("HYPERLINK \\l "));
    if (fields.length !== held.length)
      problems.push(`${fields.length} fields, Foli holds ${held.length}`);
    held.forEach((field, i) => {
      const found = fields[i];
      if (found?.code !== field.code) problems.push(`field ${i}: code ${found?.code}`);
      else if (!field.code.startsWith("DATE") && found.result !== field.result)
        problems.push(`${field.code}: Word reads ${JSON.stringify(found.result)}`);
    });
  } else {
    const plain = name.replace(/-edited$/, "");
    const base = json(
      plain === "00-controls"
        ? join(dir, "word", `${plain}.json`)
        : join(reference, `${plain}.json`),
    );
    if (plain === "00-controls" && !name.endsWith("-edited")) {
      if (word.controls.length !== 2) problems.push(`${word.controls.length} controls, not 2`);
    } else if (!name.endsWith("-edited")) {
      if (word.pages !== base.pages) problems.push(`${word.pages} pages, Word's ${base.pages}`);
      for (const key of ["fields", "controls", "bookmarks", "sections"])
        if (JSON.stringify(word[key]) !== JSON.stringify(base[key])) problems.push(`${key} differ`);
    } else {
      const want = expected[plain];
      if (plain === "00-controls" && (want.controls !== 1 || want.split !== 1))
        problems.push("the fixture's controls were not edited");
      for (const code of want.editedFields)
        if (!word.fields.some((f) => f.code === code && f.result.includes(EDIT)))
          problems.push(`field ${code}: no edit`);
      const shown = word.controls.filter((c) => c.text.includes(EDIT)).length;
      if (shown < want.controls) problems.push(`${shown} edited controls, not ${want.controls}`);
      if (word.controls.length !== base.controls.length + want.split)
        problems.push(`${word.controls.length} controls, not ${base.controls.length + want.split}`);
      if (word.fields.length !== base.fields.length) problems.push("the fields' number changed");
      if (want.stories) {
        let seen = 0;
        for (const side of ["headers", "footers"])
          word.sections.forEach((section, s) => {
            for (const [variant, story] of Object.entries(section[side])) {
              if (!story.text.includes(EDIT)) continue;
              seen++;
              // A page field Word computes again reads as it does in the original.
              const before = base.sections[s]?.[side][variant]?.text ?? "";
              if (!story.text.startsWith(before.trim()))
                problems.push(`section ${s + 1} ${side} ${variant}: its field is not as it was`);
            }
          });
        if (!seen) problems.push("no edited header or footer");
      }
    }
  }
  if (problems.length) failed++;
  console.log(`${name}: ${problems.length ? problems.join("; ") : "ok"}`);
}
if (failed) process.exitCode = 1;
