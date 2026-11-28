/**
 * Word's Insert tab extras (Phase 35): Symbol (its recent symbols and dialog), one undo step
 * each; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("tab", { name: "Insert" }).click();
}
/** The first paragraph's text, the caret put at its start. */
const firstText = (page: Page) =>
  page.evaluate(() => window.foliEdit.editor.state.doc.child(0).textContent);

test.describe("Insert ▸ Symbol (35.1)", () => {
  test("the recent symbols insert at the caret; More Symbols… opens the dialog", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => window.foliEdit.editor.select(1));
    const before = await firstText(page);
    await page.getByRole("button", { name: "Symbol" }).click();
    const menu = page.getByRole("menu", { name: "Symbol" });
    await expect(menu.getByRole("menuitem")).toHaveCount(21);
    const results = await new AxeBuilder({ page }).include(".foli-menu").analyze();
    expect(results.violations).toEqual([]);
    await menu.getByRole("menuitem", { name: "©" }).click();
    expect(await firstText(page)).toBe(`©${before}`);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await firstText(page)).toBe(before);
  });

  test("the dialog inserts a subset's character in its font, from the keyboard too", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => window.foliEdit.editor.select(1));
    const before = await firstText(page);
    await page.getByRole("button", { name: "Symbol" }).click();
    await page.getByRole("menuitem", { name: "More Symbols…" }).click();
    const dialog = page.getByRole("dialog", { name: "Symbol" });
    await dialog.getByLabel("Subset").selectOption({ label: "Arrows" });
    const results = await new AxeBuilder({ page }).include(".foli-symbol-dialog").analyze();
    expect(results.violations).toEqual([]);
    const grid = dialog.getByRole("listbox", { name: "Symbols" });
    await grid.getByRole("option", { selected: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByLabel("Character code (Unicode, hex)")).toHaveValue("2191");
    await page.keyboard.press("Enter");
    expect(await firstText(page)).toBe(`↑${before}`);
    // Still open: Special Characters, by name.
    await dialog.getByRole("tab", { name: "Special Characters" }).click();
    await dialog.getByRole("option", { name: /Section/ }).dblclick();
    expect(await firstText(page)).toBe(`↑§${before}`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("Word's keys type its special characters", async ({ page }) => {
    await open(page);
    await page.locator("section.foli-page").first().click();
    await page.evaluate(() => window.foliEdit.editor.select(1));
    const before = await firstText(page);
    await page.keyboard.press("Control+Alt+c");
    await page.keyboard.press("Control+Alt+t");
    await page.keyboard.press("Control+Shift+Space");
    expect(await firstText(page)).toBe(`©™ ${before}`);
  });
});

test.describe("Insert ▸ Date & Time (35.2)", () => {
  test("inserts the date as a field in the format picked; axe", async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.foliEdit.editor.select(1));
    await page.getByRole("button", { name: "Date & Time" }).click();
    const dialog = page.getByRole("dialog", { name: "Date and Time" });
    await dialog.getByLabel("Language").selectOption("en-US");
    const results = await new AxeBuilder({ page }).include(".foli-date-time-dialog").analyze();
    expect(results.violations).toEqual([]);
    await dialog.getByRole("option").nth(4).click();
    await dialog.getByLabel("Update automatically").check();
    await dialog.getByRole("button", { name: "OK" }).click();
    await expect(dialog).toHaveCount(0);
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    expect(await firstText(page)).toMatch(new RegExp(`^${today}`));
    const code = await page.evaluate(() => {
      let found = "";
      window.foliEdit.editor.state.doc.descendants((n) => {
        if (n.type.name === "fieldCode" && !found) found = String(n.attrs.text);
      });
      return found;
    });
    expect(code).toBe(String.raw` DATE \@ "yyyy-MM-dd" `);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await firstText(page)).not.toMatch(new RegExp(`^${today}`));
  });
});
