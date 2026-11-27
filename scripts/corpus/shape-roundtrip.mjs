// Shapes between Foli and Word (Phase 34). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/shape-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-reference.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/shape-roundtrip.mjs check <dir>
//
// `make` exports the corpus documents with shapes to <dir>/foli: as imported (<name>.docx) and
// edited (<name>-edited.docx): a rectangle turned 30° and flipped, refilled; a rounded
// rectangle's corners adjusted; an oval's line recolored and dotted; a hexagon moved; a line
// given an arrow at its start; a shape's text replaced; and new shapes added (a star, an arrow
// line, a rounded rectangle holding text). `check` reads what Word made of them (its `shapes`):
// each file opened, the unchanged one's shapes as Word's reference of the corpus file, the edited
// one's as Foli wrote them. Prints one line per document; exits 1 on any difference.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/shape-roundtrip.mjs make|check <dir>");
  process.exit(2);
}
const root = join(import.meta.dirname, "..", "..");
const corpus = join(root, "corpus", "word");
const reference = join(root, "corpus", "reference", "word");
const EMU_PER_PT = 12_700;
/** MsoAutoShapeType of the presets the edits make. */
const MSO = { rect: 1, roundRect: 5, ellipse: 9, star5: 92 };
/** MsoLineDashStyle of the dashes the edits use (`sysDot` without a round cap: msoLineSysDot). */
const DASH = { sysDot: 11, dash: 4 };

/** Every shape node of the body, in document order. */
function shapes(node, out = []) {
  if (node.type === "shape") out.push(node);
  for (const child of node.content ?? []) shapes(child, out);
  return out;
}
const byAlt = (doc, alt) => shapes(doc.content).find((s) => s.attrs.alt === alt);

/** What the edits are, and what Word should then say of each shape (by alt text). */
const EDITS = {
  "Preset 1": {
    attrs: { rotation: 30 * 60_000, flipH: true, fill: "FFC000", gradient: null },
    word: { rotation: 30, flipH: true, fill: "FFC000" },
  },
  "Rounded rectangle, adjusted": {
    attrs: { adjust: { adj: 10_000 } },
    word: { adjust: 0.1 },
  },
  "Dashed oval, no fill": {
    attrs: { outline: { color: "00B050", width: 38_100, dash: "sysDot" } },
    word: { line: { color: "00B050", weight: 3, dash: DASH.sysDot } },
  },
  "Line with an arrow": {
    attrs: {
      outline: {
        color: "156082",
        width: 19_050,
        head: { type: "triangle" },
        tail: { type: "triangle" },
      },
    },
    word: { line: { color: "156082", weight: 1.5 } },
  },
};
const NEW = [
  {
    alt: "New star",
    geometry: "star5",
    width: 72,
    height: 72,
    left: 300,
    top: 20,
    fill: "FFC000",
    word: { autoShapeType: MSO.star5, fill: "FFC000" },
  },
  {
    alt: "New rounded rectangle with text",
    geometry: "roundRect",
    width: 140,
    height: 50,
    left: 20,
    top: 20,
    fill: "002060",
    text: "New text",
    word: { autoShapeType: MSO.roundRect, fill: "002060", text: "New text" },
  },
];

// The corpus documents (those with shapes are found by importing them).
const names = readdirSync(corpus).filter((name) => name.endsWith(".docx"));
const shaped = (name) =>
  importDocx(new Uint8Array(readFileSync(join(corpus, name)))).then(
    ({ document }) => shapes(document.content).length > 0,
  );

if (mode === "make") {
  mkdirSync(join(dir, "foli"), { recursive: true });
  for (const name of names) {
    if (!(await shaped(name))) continue;
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(join(corpus, name))),
    );
    writeFileSync(join(dir, "foli", name), await exportDocx(document, pkg));
    const edited = structuredClone(document);
    for (const [alt, { attrs }] of Object.entries(EDITS)) {
      const shape = byAlt(edited, alt);
      if (shape) shape.attrs = { ...shape.attrs, ...attrs };
    }
    const hexagon = byAlt(edited, "Hexagon wrapped square");
    if (hexagon?.attrs.float?.horizontal?.offset !== undefined)
      hexagon.attrs.float.horizontal.offset += 10 * EMU_PER_PT;
    const text = byAlt(edited, "Rounded rectangle with text");
    if (text?.attrs.story)
      edited.stories[text.attrs.story].content.content[0].content = [
        { type: "text", text: "Edited shape" },
      ];
    // The new shapes in the last paragraph, in front of the text.
    const last = edited.content.content.at(-1);
    for (const [i, shape] of NEW.entries()) {
      const story = shape.text ? `textbox:new${i}` : null;
      if (story)
        edited.stories[story] = {
          kind: "textBox",
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: shape.text }] }],
          },
        };
      last.content = [
        ...(last.content ?? []),
        {
          type: "shape",
          attrs: {
            geometry: shape.geometry,
            width: shape.width * EMU_PER_PT,
            height: shape.height * EMU_PER_PT,
            float: {
              horizontal: { relativeTo: "page", offset: shape.left * EMU_PER_PT },
              vertical: { relativeTo: "page", offset: shape.top * EMU_PER_PT },
              wrap: "inFront",
            },
            fill: shape.fill,
            outline: { color: "000000", width: 12_700 },
            alt: shape.alt,
            ...(story ? { story, textColor: "FFFFFF", verticalAlign: "center" } : {}),
          },
        },
      ];
    }
    writeFileSync(
      join(dir, "foli", name.replace(/\.docx$/, "-edited.docx")),
      await exportDocx(parseDocument(edited), pkg),
    );
    console.log(`${name}: written`);
  }
} else {
  let failed = false;
  const read = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  const near = (a, b) => (typeof a === "number" ? Math.abs(a - b) <= 0.6 : a === b);
  const differs = (want, got, path = "") => {
    const out = [];
    for (const [key, value] of Object.entries(want)) {
      const at = `${path}${key}`;
      if (value && typeof value === "object")
        out.push(...differs(value, got?.[key] ?? {}, `${at}.`));
      else if (!near(got?.[key], value))
        out.push(`${at}: Word ${JSON.stringify(got?.[key])}, wanted ${JSON.stringify(value)}`);
    }
    return out;
  };
  for (const name of names) {
    const base = name.replace(/\.docx$/, "");
    let unchanged;
    let edited;
    try {
      unchanged = read(join(dir, "word", `${base}.json`));
      edited = read(join(dir, "word", `${base}-edited.json`));
    } catch {
      continue;
    }
    const original = read(join(reference, `${base}.json`));
    const problems = [];
    if (!unchanged.opened) problems.push(`unchanged: not opened (${unchanged.error})`);
    if (!edited.opened) problems.push(`edited: not opened (${edited.error})`);
    // Unchanged: as Word reads the corpus file.
    const same = (s) => JSON.stringify(s);
    if (same(unchanged.shapes) !== same(original.shapes))
      problems.push("unchanged: shapes differ from Word's reference of the corpus file");
    // Edited: as Foli wrote them.
    const find = (alt) => edited.shapes?.find((s) => s.alt === alt);
    for (const [alt, { word }] of Object.entries(EDITS))
      problems.push(...differs(word, find(alt)).map((d) => `${alt}: ${d}`));
    const hexWas = original.shapes.find((s) => s.alt === "Hexagon wrapped square");
    const hexNow = find("Hexagon wrapped square");
    if (hexWas && !near(hexNow?.left, hexWas.left + 10))
      problems.push(`Hexagon wrapped square: left ${hexNow?.left}, wanted ${hexWas.left + 10}`);
    if (find("Rounded rectangle with text")?.text !== "Edited shape")
      problems.push(
        `Rounded rectangle with text: text ${JSON.stringify(find("Rounded rectangle with text")?.text)}`,
      );
    for (const shape of NEW) {
      const got = find(shape.alt);
      if (!got) problems.push(`${shape.alt}: not found`);
      else
        problems.push(
          ...differs(
            {
              ...shape.word,
              width: shape.width,
              height: shape.height,
              left: shape.left,
              top: shape.top,
            },
            got,
          ).map((d) => `${shape.alt}: ${d}`),
        );
    }
    console.log(`${name}: ${problems.length ? `${problems.length} differences` : "as written"}`);
    for (const problem of problems) console.log(`  ${problem}`);
    failed ||= problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
