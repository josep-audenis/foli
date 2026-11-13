/**
 * Page agreement with Word (8.6b): every corpus document laid out by `renderDocumentV3` with
 * tracked changes accepted (as Word's reference data is measured), and each paragraph outside
 * tables compared with the page Word starts it on (`corpus/reference/word/`). Paragraphs are
 * matched by their text, in order. Run with `pnpm corpus:pages`; numbers in corpus/README.md.
 *
 * Fonts: Chromium uses the fonts installed on the machine. Office's cloud fonts (Aptos, the
 * default since 2023) are not installed system-wide: they are served to the page from Office's
 * font cache (`FOLI_FONT_DIR`, default the Windows cache) when present, for this run only.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const ROOT = new URL("../../../", import.meta.url);
const CORPUS = new URL("corpus/word/", ROOT);
const REFERENCE = new URL("corpus/reference/word/", ROOT);
const FONT_DIR =
  process.env.FOLI_FONT_DIR ??
  join(process.env.LOCALAPPDATA ?? "", "Microsoft", "FontCache", "4", "CloudFonts");
const FAMILIES = (process.env.FOLI_FONTS ?? "Aptos,Aptos Display").split(",");
const FONT_PATH = "/__foli-word-fonts/";

interface Face {
  family: string;
  file: string;
  weight: number;
  italic: boolean;
}

/** A TrueType font's weight and italic flag, from its OS/2 table. */
function faceOf(bytes: Buffer): { weight: number; italic: boolean } | null {
  if (bytes.length < 12) return null;
  const tables = bytes.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (record + 16 > bytes.length) return null;
    if (bytes.toString("latin1", record, record + 4) !== "OS/2") continue;
    const offset = bytes.readUInt32BE(record + 8);
    if (offset + 64 > bytes.length) return null;
    return {
      weight: bytes.readUInt16BE(offset + 4),
      italic: (bytes.readUInt16BE(offset + 62) & 1) === 1,
    };
  }
  return null;
}

/** The faces of the cloud font families found in the font cache. */
function cloudFaces(): Face[] {
  const faces: Face[] = [];
  for (const family of FAMILIES) {
    const dir = join(FONT_DIR, family);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".ttf"))) {
      const face = faceOf(readFileSync(join(dir, file)));
      if (face) faces.push({ family, file: join(dir, file), ...face });
    }
  }
  return faces;
}

async function loadFonts(page: Page, faces: Face[]): Promise<void> {
  if (!faces.length) return;
  await page.route(`**${FONT_PATH}*`, (route) => {
    const index = Number(new URL(route.request().url()).pathname.slice(FONT_PATH.length));
    const face = faces[index];
    if (!face) return route.abort();
    return route.fulfill({ contentType: "font/ttf", body: readFileSync(face.file) });
  });
  await page.addStyleTag({
    content: faces
      .map(
        (f, i) =>
          `@font-face { font-family: "${f.family}"; src: url("${FONT_PATH}${i}") format("truetype"); font-weight: ${f.weight}; font-style: ${f.italic ? "italic" : "normal"}; font-display: block; }`,
      )
      .join("\n"),
  });
  await page.evaluate(
    (all) =>
      Promise.all(
        all.map((f) =>
          document.fonts.load(`${f.italic ? "italic" : "normal"} ${f.weight} 16px "${f.family}"`),
        ),
      ).then(() => {}),
    faces,
  );
}

interface Reference {
  pages: number;
  paragraphs: { text: string; page: number; line: number; inTable: boolean }[];
}
interface Shown {
  type: string;
  page: number | null;
  line: number | null;
  text: string;
}

const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

interface Result {
  paragraphs: number;
  compared: number;
  /** On Word's page. */
  agreed: number;
  /** On Word's page and line. */
  sameLine: number;
  /** On Word's page, at most one line from Word's. */
  nearLine: number;
  pages: [number, number];
}
const results: Record<string, Result> = {};

test.describe.configure({ mode: "serial" });

const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));
const faces = cloudFaces();

for (const name of names) {
  test(name, async ({ page }) => {
    await page.goto("/word.html");
    await loadFonts(page, faces);
    const base64 = readFileSync(new URL(name, CORPUS)).toString("base64");
    const shown: Shown[] = await page.evaluate(
      (data) =>
        (
          window as unknown as { foliWord: { render(d: string, r: string): Promise<Shown[]> } }
        ).foliWord.render(data, "final"),
      base64,
    );
    const reference = JSON.parse(
      readFileSync(new URL(name.replace(".docx", ".json"), REFERENCE), "utf8").replace(/^﻿/, ""),
    ) as Reference;
    const expected = reference.paragraphs.filter((p) => !p.inTable);
    const paragraphs = shown.filter((s) => s.type === "paragraph" && s.page !== null);
    // Match in order by text; a paragraph Foli does not show as one (inside a content control)
    // is left out of the comparison.
    let at = 0;
    let compared = 0;
    let agreed = 0;
    let sameLine = 0;
    let nearLine = 0;
    const disagreements: string[] = [];
    for (const word of expected) {
      const found = paragraphs.findIndex(
        (p, i) => i >= at && i < at + 4 && normal(p.text) === normal(word.text),
      );
      if (found < 0) continue;
      at = found + 1;
      compared++;
      const foli = (paragraphs[found]?.page ?? -1) + 1;
      const line = paragraphs[found]?.line ?? 0;
      if (foli === word.page) {
        agreed++;
        if (line === word.line) sameLine++;
        if (Math.abs(line - word.line) <= 1) nearLine++;
      }
      if (foli !== word.page || line !== word.line)
        disagreements.push(
          `page ${foli} line ${line} (Word ${word.page}, ${word.line}): ${word.text.slice(0, 50)}`,
        );
    }
    const pages = await page.locator(".foli-word-page").count();
    results[name] = {
      paragraphs: expected.length,
      compared,
      agreed,
      sameLine,
      nearLine,
      pages: [pages, reference.pages],
    };
    console.log(
      `${name}: of ${compared} paragraphs (${expected.length} outside tables), ${agreed} on Word's page, ${sameLine} on its line, ${nearLine} within a line; ${pages} pages (Word ${reference.pages})${faces.length ? "" : ", without Office cloud fonts"}`,
    );
    for (const line of disagreements) console.log(`  ${line}`);
    // The comparison itself must hold: most paragraphs matched by text.
    expect(compared).toBeGreaterThanOrEqual(Math.floor(expected.length * 0.6));
  });
}

test.afterAll(() => {
  const out = new URL("test-results/", ROOT);
  mkdirSync(out, { recursive: true });
  const total = { compared: 0, agreed: 0, sameLine: 0, nearLine: 0 };
  for (const r of Object.values(results)) {
    total.compared += r.compared;
    total.agreed += r.agreed;
    total.sameLine += r.sameLine;
    total.nearLine += r.nearLine;
  }
  writeFileSync(
    new URL("word-pages.json", out),
    `${JSON.stringify({ fonts: faces.map((f) => f.family), documents: results, total }, null, 2)}\n`,
  );
  console.log(
    `Total: of ${total.compared} paragraphs, ${total.agreed} on Word's page, ${total.sameLine} on its line, ${total.nearLine} within a line`,
  );
});
