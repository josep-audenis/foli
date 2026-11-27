/**
 * Shapes against Word (Phase 34, ADR-0017): the corpus's `12-shapes-poster.docx` laid out by
 * `renderDocument`, and each shape's box on Foli's page compared by ink with the same box of
 * Word's PDF of it (`corpus/reference/word/12-shapes-poster.pdf`, Word 16's, rendered by pdf.js
 * at 96 px per inch): an agreement of 0.9 at least, within 2 px (`src/ink.ts`). Part of
 * `pnpm corpus:pages`; the scores go to `test-results/word-shapes.json`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { cloudFaces, loadFonts } from "./fonts.js";

const ROOT = new URL("../../../", import.meta.url);
const NAME = "12-shapes-poster";
/** The least ink agreement a shape's box has with Word's (ADR-0017). */
const TOLERANCE = 0.9;
/** Pixels around a shape's box, for its line drawn over the edge and its arrow ends. */
const PAD = 6;

type Region = [number, number, number, number];

test("the corpus's shapes are drawn as Word draws them (12)", async ({ page }) => {
  await page.goto("/word.html");
  await loadFonts(page, cloudFaces());
  const base64 = readFileSync(new URL(`corpus/word/${NAME}.docx`, ROOT)).toString("base64");
  await page.evaluate((data) => window.foliWord.render(data, "final"), base64);
  const pages = page.locator(".foli-word-page");
  const shots: { png: string; regions: Region[]; names: string[] }[] = [];
  for (let i = 0; i < (await pages.count()); i++) {
    const element = pages.nth(i);
    const { regions, names } = await element.evaluate((e, pad) => {
      const p = e.getBoundingClientRect();
      const regions: [number, number, number, number][] = [];
      const names: string[] = [];
      for (const shape of e.querySelectorAll<HTMLElement>("[data-foli-shape]")) {
        // What is drawn: the box, its strokes and ends (the SVG's own box, overflow included).
        const r = shape.getBoundingClientRect();
        const drawn = shape.querySelector("svg g")?.getBoundingClientRect() ?? r;
        const left = Math.min(r.left, drawn.left) - p.left - pad;
        const top = Math.min(r.top, drawn.top) - p.top - pad;
        const right = Math.max(r.right, drawn.right) - p.left + pad;
        const bottom = Math.max(r.bottom, drawn.bottom) - p.top + pad;
        regions.push([Math.round(left), Math.round(top), Math.round(right), Math.round(bottom)]);
        names.push(shape.getAttribute("aria-label") ?? shape.getAttribute("data-foli-shape") ?? "");
      }
      return { regions, names };
    }, PAD);
    shots.push({
      png: (await element.screenshot({ scale: "css" })).toString("base64"),
      regions,
      names,
    });
  }
  const pdf = readFileSync(new URL(`corpus/reference/word/${NAME}.pdf`, ROOT)).toString("base64");
  const scores = await page.evaluate(
    ([word, list]) =>
      window.foliWord.compareRegions(
        word,
        list.map(({ png, regions }) => ({ png, regions })),
      ),
    [pdf, shots] as const,
  );
  const results = shots.flatMap((shot, i) =>
    shot.names.map((name, j) => ({
      page: i + 1,
      name,
      score: Math.round((scores[i]?.[j]?.score ?? 0) * 1000) / 1000,
      ink: [scores[i]?.[j]?.word, scores[i]?.[j]?.foli],
    })),
  );
  mkdirSync(new URL("test-results/", ROOT), { recursive: true });
  writeFileSync(
    new URL("test-results/word-shapes.json", ROOT),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  // Every shape of the file is shown (the header's line on both pages).
  expect(results.length).toBe(44);
  const below = results.filter((r) => r.score < TOLERANCE);
  expect(below, JSON.stringify(below)).toEqual([]);
});
