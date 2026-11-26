/**
 * Word's mini toolbar (29.9): above a pointer selection, faded until the pointer comes, formats
 * the selection, goes when a key is pressed; none for a keyboard selection; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
}
const box = (page: Page, word: string) =>
  page.evaluate((word) => {
    const walker = document.createTreeWalker(
      document.querySelector("section.foli-page") as Node,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(word) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      const { left, right, top, height } = range.getBoundingClientRect();
      return { left, right, y: top + height / 2 };
    }
    throw new Error(`no ${word}`);
  }, word);

test("shows above a pointer selection, bolds it, and goes on a key", async ({ page }) => {
  await open(page);
  const word = await box(page, "Open");
  await page.mouse.move(word.left + 1, word.y);
  await page.mouse.down();
  await page.mouse.move(word.right - 1, word.y, { steps: 4 });
  await page.mouse.up();
  const mini = page.locator(".foli-mini-toolbar");
  await expect(mini).toBeVisible();
  // Above the selection.
  expect((await mini.boundingBox())?.y ?? 0).toBeLessThan(word.y);
  // Faded until the pointer comes (Word's): checked as it is read, at full opacity.
  await mini.hover();
  await expect.poll(() => mini.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  const results = await new AxeBuilder({ page }).include(".foli-mini-toolbar").analyze();
  expect(results.violations).toEqual([]);
  await mini.getByRole("button", { name: "Bold" }).click();
  await expect
    .poll(() => page.evaluate(() => window.foliEdit.editor.isMarkActive("bold")))
    .toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(mini).toHaveCount(0);
  // A keyboard selection brings none.
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(100);
  await expect(mini).toHaveCount(0);
});
