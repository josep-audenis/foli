/**
 * The corpus's design memo (Word 16, Phase 32): its page color, page border, watermark, paragraph
 * borders and shading and line numbers drawn on the page; saved back, the parts untouched.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL("10-design-memo.docx", CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(() => document.querySelectorAll("section.foli-page").length >= 1);
  await page.evaluate(() => document.fonts.ready);
}

test("Word's design memo shows its page decoration", async ({ page }) => {
  await open(page);
  const first = page.locator("section.foli-page").first();
  expect(await first.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(221, 235, 247)",
  );
  const frame = first.locator("[data-foli-page-borders]");
  await expect(frame).toHaveCount(1);
  expect(await frame.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("double");
  await expect(first.locator("[data-foli-watermark] text")).toHaveText("CONFIDENTIAL");
  // Every fifth line numbered, continuously.
  const numbers = await first.locator("[data-foli-line-numbers] span").allTextContents();
  expect(numbers.length).toBeGreaterThan(0);
  expect(numbers).toEqual(numbers.map((_, i) => String((i + 1) * 5)));
  const shaded = first.getByText("Summary of the changes agreed at the review.");
  expect(
    await shaded.evaluate((el) => getComputedStyle(el.closest("p") ?? el).borderBottomStyle),
  ).toBe("solid");
  const results = await new AxeBuilder({ page }).include("section.foli-page").analyze();
  expect(results.violations).toEqual([]);
});
