/**
 * Word's formatting dialogs (Phase 30): the Paragraph dialog from the ribbon's launcher and the
 * right-click menu, applied in one undo step; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
}
const attrs = (page: Page, i: number) =>
  page.evaluate((i) => window.foliEdit.editor.state.doc.child(i).attrs, i);

test("the Paragraph dialog sets indents, spacing and breaks in one undo step", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.foliEdit.editor.select(3));
  await page.getByRole("button", { name: "Paragraph settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Paragraph" });
  await expect(dialog.getByLabel("Alignment")).toBeFocused();
  const results = await new AxeBuilder({ page }).include(".foli-paragraph-dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByLabel("Alignment").selectOption("center");
  await dialog.getByLabel("Left", { exact: true }).fill("0.5");
  await dialog.getByLabel("Before", { exact: true }).fill("18 pt");
  await dialog.getByRole("tab", { name: "Line and Page Breaks" }).click();
  await dialog.getByLabel("Page break before").check();
  const breaks = await new AxeBuilder({ page }).include(".foli-paragraph-dialog").analyze();
  expect(breaks.violations).toEqual([]);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await attrs(page, 0)).toMatchObject({
    justification: "center",
    indent: { left: 720 },
    spacing: { before: 360 },
    pageBreakBefore: true,
  });
  await page.keyboard.press("ControlOrMeta+z");
  expect(await attrs(page, 0)).toMatchObject({ justification: null, pageBreakBefore: null });
});

test("Paragraph… in the right-click menu opens the dialog; Escape goes back", async ({ page }) => {
  await open(page);
  const word = page.locator("section.foli-page").getByText("Open a .docx", { exact: false });
  await word.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paragraph…" }).click();
  const dialog = page.getByRole("dialog", { name: "Paragraph" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#editor")).toBeFocused();
});
