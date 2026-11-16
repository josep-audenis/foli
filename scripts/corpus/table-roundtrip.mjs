// Tables between Foli and Word (10.4). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/table-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/table-roundtrip.mjs check <dir>
//
// `make` exports every corpus document with tables twice to <dir>/foli: as imported
// (<name>.docx) and edited (<name>-edited.docx: in the first table, "Foli edit" typed into the
// first cell of the second row, that row kept from breaking across pages, the last cell shaded,
// and the third row deleted as a tracked change by "Foli Reviewer"), and a table made in the
// model in a new package, with its grid and without (00-new-table*). `check` reads what Word
// made of them (word-reference.ps1 accepts every change before measuring): each opened, as many
// pages as Word gives the original, and every paragraph, table cells included, with Foli's text
// in Foli's order (the deleted row gone). Prints one line per document; exits 1 on any difference.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDocument, parseDocument } from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/table-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const corpus = join(root, "corpus", "word");
const reference = join(root, "corpus", "reference", "word");

/** A paragraph's text as Word's Range.Text gives it (an inline picture is "/"). */
const textOf = (p) =>
  (p.content ?? [])
    .map((n) => {
      if ((n.marks ?? []).some((m) => m.type === "deletion")) return "";
      if (n.type === "text") return n.text;
      if (n.type === "tab") return "\t";
      if (n.type === "hardBreak") return "\n";
      if (n.type === "opaqueInline" && String(n.attrs?.xml).includes("<wp:inline")) return "/";
      return "";
    })
    .join("");

/**
 * Paragraph texts in Word's order: depth first; a cell a vertical merge covers and a row
 * deleted as a tracked change (accepted) have none.
 */
function texts(node, out = []) {
  if (node.type === "paragraph") out.push(textOf(node).toLowerCase());
  else if (node.type === "tableCell" && node.attrs?.vMerge === "continue") return out;
  else if (node.type === "tableRow" && node.attrs?.revision?.deletion) return out;
  else for (const child of node.content ?? []) texts(child, out);
  return out;
}

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  for (const name of readdirSync(corpus).filter((n) => n.endsWith(".docx"))) {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(join(corpus, name))),
    );
    const table = (document.content.content ?? []).find((b) => b.type === "table");
    if (!table) continue;
    const base = name.replace(/\.docx$/, "");
    writeFileSync(join(dir, "foli", `${base}.docx`), await exportDocx(document, pkg));
    const edited = structuredClone(document);
    const t = edited.content.content.find((b) => b.type === "table");
    const rows = t.content;
    const second = rows[1] ?? rows[0];
    const first = second.content.find((c) => c.attrs?.vMerge !== "continue") ?? second.content[0];
    first.content[0] = { ...first.content[0], content: [{ type: "text", text: "Foli edit" }] };
    second.attrs = { ...second.attrs, cantSplit: true };
    const lastRow = rows.at(-1);
    const lastCell = lastRow.content.at(-1);
    lastCell.attrs = { ...lastCell.attrs, shading: { pattern: "clear", fill: "FFF2CC" } };
    if (rows.length > 3 && !rows[2].content.some((c) => c.attrs?.vMerge)) {
      rows[2].attrs = {
        ...rows[2].attrs,
        revision: { deletion: { id: 9001, author: "Foli Reviewer", date: "2026-11-16T00:00:00Z" } },
      };
    }
    writeFileSync(
      join(dir, "foli", `${base}-edited.docx`),
      await exportDocx(parseDocument(edited), pkg),
    );
    writeFileSync(
      join(dir, "foli", `${base}.expected.json`),
      JSON.stringify({ plain: texts(document.content), edited: texts(edited.content) }),
    );
  }
  // A table made in the model, in a new package: with its grid, and without one.
  for (const [base, grid] of [
    ["00-new-table", [3000, 3000]],
    ["00-new-table-no-grid", []],
  ]) {
    const cell = (text, attrs) => ({
      type: "tableCell",
      ...(attrs ? { attrs } : {}),
      content: [{ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }],
    });
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        {
          type: "table",
          attrs: { grid, borders: { insideH: { style: "single", size: 4 } } },
          content: [
            {
              type: "tableRow",
              attrs: { header: true },
              content: [cell("a", { vMerge: "restart" }), cell("b")],
            },
            { type: "tableRow", content: [cell("", { vMerge: "continue" }), cell("c")] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    };
    const document = parseDocument({ ...createDocument(), content });
    writeFileSync(join(dir, "foli", `${base}.docx`), await exportDocx(document));
    writeFileSync(
      join(dir, "foli", `${base}.expected.json`),
      JSON.stringify({ plain: texts(content) }),
    );
  }
  console.log(
    `made ${readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".docx")).length} documents`,
  );
} else {
  let failed = 0;
  for (const file of readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".expected.json"))) {
    const base = file.replace(".expected.json", "");
    const expected = JSON.parse(readFileSync(join(dir, "foli", file), "utf8"));
    // A table made in the model has no Word original: no page count to compare.
    const made = base.startsWith("00-");
    const original = made
      ? null
      : JSON.parse(readFileSync(join(reference, `${base}.json`), "utf8"));
    for (const [suffix, want] of [
      ["", expected.plain],
      ...(made ? [] : [["-edited", expected.edited]]),
    ]) {
      const word = JSON.parse(readFileSync(join(dir, "word", `${base}${suffix}.json`), "utf8"));
      const got = word.paragraphs.map((p) => p.text.toLowerCase());
      const problems = [];
      if (!word.opened) problems.push(`not opened: ${word.error}`);
      if (original && suffix === "" && word.pages !== original.pages)
        problems.push(`${word.pages} pages, Word gives the original ${original.pages}`);
      const at = got.findIndex((t, i) => t !== want[i]);
      if (got.length !== want.length || at >= 0)
        problems.push(
          `paragraph ${at < 0 ? want.length : at}: Word "${got[at] ?? ""}", Foli "${want[at] ?? ""}" (${got.length} vs ${want.length})`,
        );
      if (problems.length) failed++;
      console.log(`${base}${suffix}: ${problems.length ? problems.join("; ") : "ok"}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
