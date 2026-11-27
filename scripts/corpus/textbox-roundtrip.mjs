// Text boxes between Foli and Word (Phase 33). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/textbox-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/textbox-roundtrip.mjs check <dir>
//
// `make` exports the corpus documents with text boxes to <dir>/foli: as imported (<name>.docx)
// and edited (<name>-edited.docx: every box's first paragraph replaced, the first box moved
// 10 pt right and down, made 20 pt wider, wrapped tight, filled white without a line, and a new
// text box, floating, square, added to the last paragraph). `check` reads what Word made of
// them: each opened, the unchanged one with Word's pages and boxes (corpus/reference/word),
// the edited one with Foli's: each box's text, size, position and wrapping. Prints one line
// per document; exits 1 on any difference.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/textbox-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const corpus = join(root, "corpus", "word");
const reference = join(root, "corpus", "reference", "word");
const EMU_PER_PT = 12_700;
/** WdWrapType of a box's wrapping. */
const WRAP = { square: 0, tight: 1, through: 2, inFront: 3, topAndBottom: 4, behind: 5 };

/** Every text box node of the body, in document order. */
function boxes(node, out = []) {
  if (node.type === "textBox") out.push(node);
  for (const child of node.content ?? []) boxes(child, out);
  return out;
}

const text = (node) =>
  node.text ?? (node.content ?? []).map(text).join(node.type === "doc" ? "\n" : "");

/** What Word should report of a box (points). */
const expected = (box, doc) => ({
  alt: box.attrs.alt ?? "",
  width: box.attrs.width / EMU_PER_PT,
  height: box.attrs.height / EMU_PER_PT,
  wrap: WRAP[box.attrs.float?.wrap],
  ...(typeof box.attrs.float?.horizontal?.offset === "number"
    ? { left: box.attrs.float.horizontal.offset / EMU_PER_PT }
    : {}),
  ...(typeof box.attrs.float?.vertical?.offset === "number"
    ? { top: box.attrs.float.vertical.offset / EMU_PER_PT }
    : {}),
  text: text(doc.stories[box.attrs.story].content),
});

const names = readdirSync(corpus).filter((name) => {
  if (!name.endsWith(".docx")) return false;
  return readFileSync(join(corpus, name)).includes("wps:txbx") || name.startsWith("11-");
});

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  for (const name of names) {
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(join(corpus, name))),
    );
    writeFileSync(join(dir, "foli", name), await exportDocx(document, pkg));
    const edited = structuredClone(document);
    const found = boxes(edited.content);
    for (const [i, box] of found.entries()) {
      const story = edited.stories[box.attrs.story];
      story.content.content[0].content = [{ type: "text", text: `Edited box ${i + 1}` }];
    }
    const first = found[0];
    if (first?.attrs.float) {
      const { horizontal, vertical } = first.attrs.float;
      first.attrs = {
        ...first.attrs,
        width: first.attrs.width + 20 * EMU_PER_PT,
        fill: "FFFFFF",
        outline: null,
        float: {
          ...first.attrs.float,
          wrap: "tight",
          horizontal: { ...horizontal, offset: (horizontal.offset ?? 0) + 10 * EMU_PER_PT },
          vertical: { ...vertical, offset: (vertical.offset ?? 0) + 10 * EMU_PER_PT },
        },
      };
    }
    edited.stories["textbox:new"] = {
      kind: "textBox",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "A new box" }] }],
      },
    };
    const last = edited.content.content.findLast((b) => b.type === "paragraph");
    last.content = [
      {
        type: "textBox",
        attrs: {
          story: "textbox:new",
          width: 144 * EMU_PER_PT,
          height: 36 * EMU_PER_PT,
          fill: "FFFFFF",
          outline: { color: "000000", width: 6350 },
          alt: "New box",
          float: {
            horizontal: { relativeTo: "column", offset: 72 * EMU_PER_PT },
            vertical: { relativeTo: "paragraph", offset: 0 },
            wrap: "square",
          },
        },
      },
      ...(last.content ?? []),
    ];
    writeFileSync(
      join(dir, "foli", name.replace(/\.docx$/, "-edited.docx")),
      await exportDocx(parseDocument(edited), pkg),
    );
    writeFileSync(
      join(dir, "foli", name.replace(/\.docx$/, "-edited.expected.json")),
      JSON.stringify(boxes(edited.content).map((b) => expected(b, edited))),
    );
  }
  console.log(`wrote ${names.length * 2} documents to ${join(dir, "foli")}`);
} else {
  let failed = false;
  const read = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  const close = (a, b) => typeof a !== "number" || Math.abs(a - b) < 0.6;
  for (const name of names) {
    const original = read(join(reference, name.replace(/\.docx$/, ".json")));
    const plain = read(join(dir, "word", name.replace(/\.docx$/, ".json")));
    const problems = [];
    if (!plain.opened) problems.push(`not opened: ${plain.error}`);
    else {
      if (plain.pages !== original.pages)
        problems.push(`${plain.pages} pages, not ${original.pages}`);
      if (JSON.stringify(plain.textBoxes) !== JSON.stringify(original.textBoxes))
        problems.push("its boxes differ from the original's");
    }
    const edited = read(join(dir, "word", name.replace(/\.docx$/, "-edited.json")));
    const want = read(join(dir, "foli", name.replace(/\.docx$/, "-edited.expected.json")));
    if (!edited.opened) problems.push(`edited: not opened: ${edited.error}`);
    else {
      const got = edited.textBoxes ?? [];
      // Word lists the body's shapes by z-order, not by place: match them by alt text.
      for (const w of want) {
        const g = got.find((b) => b.alt === w.alt);
        if (!g) problems.push(`edited: no box "${w.alt}"`);
        else if (
          g.text !== w.text ||
          !close(w.width, g.width) ||
          !close(w.height, g.height) ||
          !close(w.left, g.left) ||
          !close(w.top, g.top) ||
          (w.wrap !== undefined && g.wrap !== w.wrap)
        )
          problems.push(`edited: "${w.alt}" is ${JSON.stringify(g)}, not ${JSON.stringify(w)}`);
      }
    }
    failed ||= problems.length > 0;
    console.log(`${name}: ${problems.length ? problems.join("; ") : "ok"}`);
  }
  process.exit(failed ? 1 : 0);
}
