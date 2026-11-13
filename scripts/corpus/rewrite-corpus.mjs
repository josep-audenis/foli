// Writes every .docx of a folder back through @folijs/docx, for Word to check
// (scripts/corpus/word-reference.ps1). Run after `pnpm build`:
//
//   node scripts/corpus/rewrite-corpus.mjs <out folder> [in folder, default corpus/word]
//
// Per document:
// - `<name>-same.docx`: the package written with no part replaced (8.2);
// - `<name>-rewritten.docx`: the main part replaced by itself plus a comment, so one part is
//   compressed again and the others are copied (8.2);
// - `<name>-exported.docx`: imported and exported without edits (8.5);
// - `<name>-edited.docx`: imported, edited (the first paragraph justified and kept with the
//   next, a run italic with text added, a new numbered paragraph with a link and a comment),
//   exported (8.5).
// The first three must open in Word with the reference numbers of the original; the edited one
// must open. Also `new-from-v2.docx`: a package made from a schema v2 document (no original).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDocument, parseDocumentV3 } from "../../packages/core/dist/index.js";
import { exportDocx, importDocx, readPackage } from "../../packages/docx/dist/index.js";

const [out, input = join(import.meta.dirname, "..", "..", "corpus", "word")] =
  process.argv.slice(2);
if (!out) {
  console.error("Usage: node scripts/corpus/rewrite-corpus.mjs <out folder> [in folder]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

/** The edits of `<name>-edited.docx`. */
function edit(document) {
  const edited = structuredClone(document);
  const paragraphs = edited.content.content.filter((b) => b.type === "paragraph");
  const [first] = paragraphs;
  first.attrs = { ...first.attrs, justification: "both", keepNext: true };
  const run = paragraphs.flatMap((p) => p.content ?? []).find((n) => n.type === "text");
  if (run) {
    run.marks = [...(run.marks ?? []).filter((m) => m.type !== "italic"), { type: "italic" }];
    run.text = `${run.text} (edited)`;
  }
  const abstract = Math.max(-1, ...edited.numbering.abstracts.map((a) => a.id)) + 1;
  const instance = Math.max(0, ...edited.numbering.instances.map((n) => n.id)) + 1;
  edited.numbering.abstracts.push({
    id: abstract,
    levels: [{ level: 0, start: 1, format: "decimal", text: "%1." }],
  });
  edited.numbering.instances.push({ id: instance, abstract });
  const comment = Math.max(-1, ...edited.comments.map((c) => c.id)) + 1;
  edited.comments.push({
    id: comment,
    author: "Foli",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Added by the export check." }] },
    ],
  });
  edited.content.content.push({
    type: "paragraph",
    attrs: { numbering: { id: instance, level: 0 } },
    content: [
      { type: "commentStart", attrs: { id: comment } },
      { type: "text", text: "A new clause, with a " },
      {
        type: "text",
        text: "link",
        marks: [{ type: "link", attrs: { href: "https://example.com/terms" } }],
      },
      { type: "commentEnd", attrs: { id: comment } },
      { type: "commentReference", attrs: { id: comment } },
    ],
  });
  return edited;
}

for (const file of readdirSync(input).filter((name) => name.endsWith(".docx"))) {
  const bytes = new Uint8Array(readFileSync(join(input, file)));
  const pkg = await readPackage(bytes);
  const base = file.slice(0, -".docx".length);
  writeFileSync(join(out, `${base}-same.docx`), await pkg.write());
  const text = pkg.text(pkg.mainDocument);
  const body = text.indexOf("<w:body>");
  if (body === -1) throw new Error(`${file}: no <w:body>`);
  const rewritten = `${text.slice(0, body + 8)}<!-- rewritten by @folijs/docx -->${text.slice(body + 8)}`;
  const replaced = new Map([[pkg.mainDocument, new TextEncoder().encode(rewritten)]]);
  writeFileSync(join(out, `${base}-rewritten.docx`), await pkg.write(replaced));
  const imported = await importDocx(bytes);
  writeFileSync(
    join(out, `${base}-exported.docx`),
    await exportDocx(imported.document, imported.package),
  );
  writeFileSync(
    join(out, `${base}-edited.docx`),
    await exportDocx(edit(imported.document), imported.package),
  );
  console.log(`${file}: written`);
}

const v2 = createDocument({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "A document from schema v2" }],
    },
    {
      type: "paragraph",
      attrs: { align: "justify" },
      content: [
        { type: "text", text: "Bold", marks: [{ type: "bold" }] },
        { type: "text", text: " and a " },
        {
          type: "text",
          text: "link",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
        {
          type: "text",
          text: "; highlighted",
          marks: [{ type: "highlight", attrs: { color: "#fff2cc" } }],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Third" }] }],
        },
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Fourth" }] },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "A point" }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    { type: "horizontalRule" },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "After the rule" },
        { type: "pageBreak" },
        { type: "text", text: "Next page" },
      ],
    },
  ],
});
writeFileSync(join(out, "new-from-v2.docx"), await exportDocx(parseDocumentV3(v2)));
console.log("new-from-v2.docx: written");
