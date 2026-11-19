/**
 * Foli's PDF against Word's (11.12): every corpus document imported in Node (`@folijs/docx`),
 * printed by `exportPdf` (`@folijs/pdf`, built: `pnpm build`) through a page of this run's
 * Chromium with its pictures, tracked changes accepted (as Word's PDFs are), and each page
 * compared with Word's PDF by ink (`src/ink.ts`), both PDFs rendered by pdf.js at 96 px per inch.
 * Runs with `pnpm corpus:pages` when `FOLI_WORD_PDF` names a folder of Word's PDFs
 * (`word-reference.ps1 -PdfDir`); results in `test-results/word-pdf-export.json`, overlays in
 * `test-results/word-pdf-export/`. Numbers in corpus/README.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importDocx } from "@folijs/docx";
import { exportPdf } from "@folijs/pdf";
import { test } from "@playwright/test";
import { cloudFaces, fontFaces } from "./fonts.js";

const ROOT = new URL("../../../", import.meta.url);
const CORPUS = new URL("corpus/word/", ROOT);
const PDF_DIR = process.env.FOLI_WORD_PDF;
/** Another origin for the fonts: the PDF's page is `about:blank`. */
const FONT_ORIGIN = "http://fonts.foli.localhost";

interface Compared {
  sizes: number[][];
  page: { score: number } | null;
  overlay: string | null;
}
interface Result {
  pages: [number, number];
  /** Per page of the longer of the two; a page only one has, or of another size, scores 0. */
  scores: number[];
  page: number;
  /** Fields `exportPdf` updated, and those it left. */
  fields: { updated: number; skipped: number };
}
const results: Record<string, Result> = {};
const round = (n: number) => Math.round(n * 1000) / 1000;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / (values.length || 1);

test.describe.configure({ mode: "serial" });
test.skip(!PDF_DIR, "FOLI_WORD_PDF names no folder of Word's PDFs");

const names = readdirSync(CORPUS).filter((n) => n.endsWith(".docx"));
const faces = cloudFaces();

for (const name of names) {
  test(name, async ({ page, context }) => {
    const wordPdf = join(PDF_DIR as string, name.replace(/\.docx$/, ".pdf"));
    test.skip(!existsSync(wordPdf), `no PDF of ${name}`);
    const { document, package: pkg } = await importDocx(
      new Uint8Array(readFileSync(new URL(name, CORPUS))),
    );
    const printing = await context.newPage();
    const exported = await exportPdf(document, {
      page: printing,
      review: "final",
      resources: (_key, resource) => (resource.part ? pkg.part(`/${resource.part}`) : undefined),
      styles: await fontFaces(printing, faces, FONT_ORIGIN),
    });
    await printing.close();
    await page.goto("/word.html");
    const { wordPages, foliPages, compared } = (await page.evaluate(
      ([word, foli]) => window.foliWord.comparePdfs(word, foli),
      [
        readFileSync(wordPdf).toString("base64"),
        Buffer.from(exported.pdf).toString("base64"),
      ] as const,
    )) as { wordPages: number; foliPages: number; compared: Compared[] };
    const out = new URL("test-results/word-pdf-export/", ROOT);
    mkdirSync(out, { recursive: true });
    const base = name.replace(/\.docx$/, "");
    writeFileSync(new URL(`${base}.pdf`, out), exported.pdf);
    compared.forEach((c, i) => {
      if (c.overlay)
        writeFileSync(
          new URL(`${base}-${i + 1}.png`, out),
          Buffer.from(c.overlay.slice(c.overlay.indexOf(",") + 1), "base64"),
        );
    });
    const scores = Array.from({ length: Math.max(wordPages, foliPages) }, (_, i) =>
      round(compared[i]?.page?.score ?? 0),
    );
    results[name] = {
      pages: [foliPages, wordPages],
      scores,
      page: round(mean(scores)),
      fields: { updated: exported.fields.updated, skipped: exported.fields.skipped.length },
    };
    console.log(
      `${name}: Foli's PDF against Word's: ${round(mean(scores))} (${scores.join(", ")}); ${foliPages} pages (Word ${wordPages}); fields updated ${exported.fields.updated}, left ${exported.fields.skipped.length}${faces.length ? "" : ", without Office cloud fonts"}`,
    );
    compared.forEach((c, i) => {
      if (!c.page)
        console.log(
          `  page ${i + 1}: Word's is ${c.sizes[0]}, Foli's ${c.sizes[1]} px: not compared`,
        );
    });
  });
}

test.afterAll(() => {
  if (!Object.keys(results).length) return;
  const all = Object.values(results).flatMap((r) => r.scores);
  const out = new URL("test-results/", ROOT);
  mkdirSync(out, { recursive: true });
  writeFileSync(
    new URL("word-pdf-export.json", out),
    `${JSON.stringify({ fonts: faces.map((f) => f.family), documents: results, pages: all.length, page: round(mean(all)) }, null, 2)}\n`,
  );
  console.log(`Foli's PDF against Word's, of ${all.length} pages: ${round(mean(all))}`);
});
