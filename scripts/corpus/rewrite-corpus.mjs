// Writes every .docx of a folder back through @folijs/docx, for Word to check
// (scripts/corpus/word-reference.ps1): `<name>-same.docx` written with no part replaced, and
// `<name>-rewritten.docx` with the main document replaced by itself plus a comment, so one part
// is compressed again and the others are copied. Both must open in Word with the reference
// numbers of the original. Run after `pnpm build`:
//
//   node scripts/corpus/rewrite-corpus.mjs <out folder> [in folder, default corpus/word]

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPackage } from "../../packages/docx/dist/index.js";

const [out, input = join(import.meta.dirname, "..", "..", "corpus", "word")] =
  process.argv.slice(2);
if (!out) {
  console.error("Usage: node scripts/corpus/rewrite-corpus.mjs <out folder> [in folder]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
for (const file of readdirSync(input).filter((name) => name.endsWith(".docx"))) {
  const pkg = await readPackage(new Uint8Array(readFileSync(join(input, file))));
  const base = file.slice(0, -".docx".length);
  writeFileSync(join(out, `${base}-same.docx`), await pkg.write());
  const text = pkg.text(pkg.mainDocument);
  const body = text.indexOf("<w:body>");
  if (body === -1) throw new Error(`${file}: no <w:body>`);
  const edited = `${text.slice(0, body + 8)}<!-- rewritten by @folijs/docx -->${text.slice(body + 8)}`;
  const replaced = new Map([[pkg.mainDocument, new TextEncoder().encode(edited)]]);
  writeFileSync(join(out, `${base}-rewritten.docx`), await pkg.write(replaced));
  console.log(`${file}: written`);
}
