// Pictures between Foli and Word (10.10). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/picture-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/picture-roundtrip.mjs check <dir>
//
// `make` exports every corpus document with pictures twice to <dir>/foli: as imported
// (<name>.docx) and edited (<name>-edited.docx: every picture's alt text changed, the first
// picture half its size, every floating picture moved 10 pt right and down (written as a new
// `wp:anchor`), and a new picture from a data: URL, inline, at the start of the first paragraph).
// `check` reads what Word made of them: each opened, the unchanged one with as many pages as
// Word gives the original and its pictures where Word has them (corpus/reference/word), the
// edited one with Foli's pictures: their alt text, size, floating or inline, and a moved
// picture's offsets. Prints one line per document; exits 1 on any difference.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/picture-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const corpus = join(root, "corpus", "word");
const reference = join(root, "corpus", "reference", "word");
const EMU_PER_PT = 12_700;
/** A 1×1 PNG. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Every picture node, in document order. */
function pictures(node, out = []) {
  if (node.type === "picture") out.push(node);
  for (const child of node.content ?? []) pictures(child, out);
  return out;
}

/** What Word should report of a picture node (points). */
const expected = (p) => ({
  alt: p.attrs.alt ?? "",
  float: !!p.attrs.float,
  width: p.attrs.width / EMU_PER_PT,
  height: p.attrs.height / EMU_PER_PT,
  ...(typeof p.attrs.float?.horizontal?.offset === "number"
    ? { left: p.attrs.float.horizontal.offset / EMU_PER_PT }
    : {}),
  ...(typeof p.attrs.float?.vertical?.offset === "number"
    ? { top: p.attrs.float.vertical.offset / EMU_PER_PT }
    : {}),
});

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  for (const name of readdirSync(corpus).filter((n) => n.endsWith(".docx"))) {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(join(corpus, name))),
    );
    if (!pictures(document.content).length) continue;
    const base = name.replace(/\.docx$/, "");
    writeFileSync(join(dir, "foli", `${base}.docx`), await exportDocx(document, pkg));
    const edited = structuredClone(document);
    pictures(edited.content).forEach((p, i) => {
      p.attrs.alt = `Foli ${i + 1}: ${p.attrs.alt ?? "no description"}`;
      if (i === 0) {
        p.attrs.width = Math.round(p.attrs.width / 2);
        p.attrs.height = Math.round(p.attrs.height / 2);
      }
      const f = p.attrs.float;
      if (f) {
        const move = (pos) =>
          typeof pos.offset === "number" ? { ...pos, offset: pos.offset + 10 * EMU_PER_PT } : pos;
        p.attrs.float = { ...f, horizontal: move(f.horizontal), vertical: move(f.vertical) };
      }
    });
    const first = edited.content.content.find((b) => b.type === "paragraph");
    first.content = [
      {
        type: "picture",
        attrs: {
          resource: "foli-new",
          width: 24 * EMU_PER_PT,
          height: 12 * EMU_PER_PT,
          alt: "New",
        },
      },
      ...(first.content ?? []),
    ];
    edited.resources = { ...edited.resources, "foli-new": { contentType: "image/png", data: PNG } };
    const parsed = parseDocument(edited);
    writeFileSync(join(dir, "foli", `${base}-edited.docx`), await exportDocx(parsed, pkg));
    writeFileSync(
      join(dir, "foli", `${base}.expected.json`),
      JSON.stringify({ edited: pictures(edited.content).map(expected) }),
    );
  }
  console.log(
    `made ${readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".expected.json")).length * 2} documents`,
  );
} else {
  let failed = 0;
  const near = (a, b) => Math.abs((a ?? Number.NaN) - b) < 0.6;
  /** Pictures sorted by alt text, then floating or not, to compare Word's with Foli's in order. */
  const key = (p) => `${p.alt}|${p.float}`;
  const files = readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".expected.json"));
  if (!files.length) {
    console.error(`No documents in ${join(dir, "foli")}: run make first.`);
    process.exit(1);
  }
  for (const file of files) {
    const base = file.replace(".expected.json", "");
    const { edited } = JSON.parse(readFileSync(join(dir, "foli", file), "utf8"));
    const read = (name) => {
      try {
        return JSON.parse(readFileSync(name, "utf8").replace(/^\uFEFF/, ""));
      } catch (error) {
        return { opened: false, error: `no Word data (${error.message})` };
      }
    };
    const original = read(join(reference, `${base}.json`));
    for (const suffix of ["", "-edited"]) {
      const word = read(join(dir, "word", `${base}${suffix}.json`));
      const problems = [];
      if (!word.opened) problems.push(`not opened: ${word.error}`);
      const got = [...(word.pictures ?? [])].sort((a, b) => (key(a) < key(b) ? -1 : 1));
      if (suffix === "") {
        if (word.pages !== original.pages)
          problems.push(`${word.pages} pages, Word gives the original ${original.pages}`);
        const want = [...original.pictures].sort((a, b) => (key(a) < key(b) ? -1 : 1));
        if (JSON.stringify(got) !== JSON.stringify(want))
          problems.push("pictures differ from Word's");
      } else {
        const want = [...edited].sort((a, b) => (key(a) < key(b) ? -1 : 1));
        if (got.length !== want.length)
          problems.push(`${got.length} pictures, Foli ${want.length}`);
        want.forEach((w, i) => {
          const g = got[i] ?? {};
          const wrong = [];
          if (g.alt !== w.alt) wrong.push(`alt "${g.alt}"`);
          if (g.float !== w.float) wrong.push(`float ${g.float}`);
          if (!near(g.width, w.width) || !near(g.height, w.height))
            wrong.push(`size ${g.width}×${g.height}, Foli ${w.width}×${w.height}`);
          if (w.left !== undefined && !near(g.left, w.left))
            wrong.push(`left ${g.left}, Foli ${w.left}`);
          if (w.top !== undefined && !near(g.top, w.top)) wrong.push(`top ${g.top}, Foli ${w.top}`);
          if (wrong.length) problems.push(`"${w.alt}": ${wrong.join(", ")}`);
        });
      }
      if (problems.length) failed++;
      console.log(`${base}${suffix}: ${problems.length ? problems.join("; ") : "ok"}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
