/**
 * Word's right-click menu (29.8): opens at the pointer on the document, Cut cuts, the arrows move,
 * Escape closes back to the document; axe.
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
      return { x: (left + right) / 2, y: top + height / 2 };
    }
    throw new Error(`no ${word}`);
  }, word);
const text = (page: Page) => page.evaluate(() => window.foliEdit.editor.state.doc.textContent);

test("right-click opens the menu; Cut cuts the selection; Escape goes back", async ({ page }) => {
  await open(page);
  const bold = await box(page, "Bold");
  await page.mouse.dblclick(bold.x, bold.y);
  await page.mouse.click(bold.x, bold.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "Document menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Cut" })).toBeFocused();
  const results = await new AxeBuilder({ page }).include(".foli-context-menu").analyze();
  expect(results.violations).toEqual([]);
  await menu.getByRole("menuitem", { name: "Cut" }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => text(page)).not.toContain("Bold");
  // Again, by the keyboard: ArrowDown moves, Escape closes back to the document.
  const word = await box(page, "Open");
  await page.mouse.click(word.x, word.y, { button: "right" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator("#editor")).toBeFocused();
});
