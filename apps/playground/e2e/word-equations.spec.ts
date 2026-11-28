/**
 * Equations shown (35.4): the corpus's Word-made equations (13) drawn as MathML by the browser on
 * the editing pages and in `renderDocument`'s pages (print, exportPdf): fractions, scripts,
 * radicals, n-ary operators, delimiters, matrices, functions; a display equation on a line of its
 * own, centered, an inline one in its sentence; their text for screen readers; axe.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const NAME = "13-equations.docx";

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL(NAME, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(
    () => document.querySelectorAll("section.foli-page [data-foli-math] math").length >= 11,
  );
}

/** What the page's equations are made of. */
const drawn = (page: Page, root: string) =>
  page.evaluate((selector) => {
    const maths = [...document.querySelectorAll(`${selector} [data-foli-math] math`)];
    return {
      count: maths.length,
      display: maths.filter((m) => m.getAttribute("display") === "block").length,
      tags: [
        ...new Set(maths.flatMap((m) => [...m.querySelectorAll("*")].map((e) => e.localName))),
      ],
      alt: maths.map((m) => m.getAttribute("alttext")),
    };
  }, root);

test("draws Word's equations as MathML on the editing pages; axe", async ({ page }) => {
  await open(page);
  const math = await drawn(page, "section.foli-page");
  expect(math.count).toBe(11);
  expect(math.display).toBe(10);
  for (const tag of ["mfrac", "msqrt", "mroot", "msup", "msubsup", "munderover", "mtable", "mo"])
    expect(math.tags, tag).toContain(tag);
  expect(math.alt[0]).toBe("x=-b±b2-4ac2a");
  // A fraction is drawn as one: its numerator above its denominator.
  const fraction = await page.evaluate(() => {
    const f = document.querySelector("section.foli-page mfrac") as Element;
    const [num, den] = [...f.children].map((c) => c.getBoundingClientRect());
    return { above: (num?.bottom ?? 0) <= (den?.top ?? 0) + 1 };
  });
  expect(fraction.above).toBe(true);
  // A display equation is centered in its line; the inline one sits in its sentence.
  const placement = await page.evaluate(() => {
    const block = document.querySelector(
      'section.foli-page [data-foli-math="display"] math',
    ) as Element;
    const page = (block.closest("section.foli-page") as Element).getBoundingClientRect();
    const r = block.getBoundingClientRect();
    const inline = document.querySelector('section.foli-page [data-foli-math="inline"]') as Element;
    return {
      center: (r.left + r.right) / 2 - (page.left + page.right) / 2,
      sentence: (inline.closest("p, [data-foli-block]")?.textContent ?? "").includes("Pythagoras"),
    };
  });
  expect(Math.abs(placement.center)).toBeLessThan(40);
  expect(placement.sentence).toBe(true);
  const results = await new AxeBuilder({ page }).include("section.foli-page").analyze();
  expect(results.violations).toEqual([]);
});

test("renderDocument draws them too (print, exportPdf)", async ({ page }) => {
  await page.goto("/word.html");
  await page.waitForFunction(() => "foliWord" in window);
  const base64 = readFileSync(new URL(NAME, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliWord.render(data, "final"), base64);
  const math = await drawn(page, "body");
  expect(math.count).toBe(11);
  expect(math.tags).toContain("mfrac");
});
