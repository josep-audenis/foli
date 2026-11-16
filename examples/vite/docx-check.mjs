// The installed @folijs/docx in Node: a corpus document imported, exported and imported again
// gives the same content, and a new document exports to a package that imports.
import { readFileSync } from "node:fs";
import { createDocument } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";

const bytes = readFileSync(new URL("../../corpus/word/05-business-letter.docx", import.meta.url));
const first = await importDocx(bytes);
const again = await importDocx(await exportDocx(first.document, first.package));
const fresh = await importDocx(await exportDocx(createDocument()));
const problems = [
  JSON.stringify(again.document.content) !== JSON.stringify(first.document.content) &&
    "a round trip changed the content",
  fresh.document.content.content?.length !== 1 && "a new document did not export",
].filter(Boolean);
if (problems.length) {
  process.stderr.write(`DOCX check failed:\n${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("DOCX check passed\n");
