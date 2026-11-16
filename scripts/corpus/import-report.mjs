// Coverage of the DOCX import (ADR-0005): for every .docx of a folder, what became editable and
// what stayed opaque. Prints only counts and element names, never document text, so it can run
// on a private folder. Run after `pnpm build`:
//
//   node scripts/corpus/import-report.mjs [folder, default corpus/word]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importDocx } from "../../packages/docx/dist/index.js";

const folder = process.argv[2] ?? join(import.meta.dirname, "..", "..", "corpus", "word");
let failed = 0;
for (const file of readdirSync(folder)
  .filter((name) => name.endsWith(".docx"))
  .sort()) {
  try {
    const { document, report } = await importDocx(new Uint8Array(readFileSync(join(folder, file))));
    // Every block, table cells included.
    const count = { paragraph: 0, table: 0, opaqueBlock: 0 };
    const walk = (node) => {
      if (node.type in count) count[node.type]++;
      if (node.type !== "paragraph") for (const child of node.content ?? []) walk(child);
    };
    walk(document.content);
    const total = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);
    const list = (counts) =>
      Object.entries(counts)
        .map(([name, n]) => `${name} ${n}`)
        .join(", ") || "none";
    console.log(`${file}`);
    console.log(
      `  ${count.paragraph} paragraphs, ${count.table} tables, ${count.opaqueBlock} opaque blocks, ${document.styles.length} styles, ${document.numbering.instances.length} lists, ${document.comments.length} comments`,
    );
    console.log(`  opaque (${total(report.opaque)}): ${list(report.opaque)}`);
    console.log(`  dropped (${total(report.dropped)}): ${list(report.dropped)}`);
    console.log(`  unmodeled values: ${report.unmodeledCount}`);
  } catch (error) {
    failed++;
    console.log(`${file}\n  NOT imported: ${error.name}: ${error.message.split("(")[0]}`);
  }
}
if (failed) process.exitCode = 1;
