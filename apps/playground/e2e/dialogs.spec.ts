/**
 * Word's formatting dialogs (Phase 30): the Paragraph and Font dialogs from the ribbon's
 * launchers and the right-click menu, applied in one undo step; axe.
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

test("the Font dialog sets the font, effects and spacing in one undo step", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.foliEdit.editor.select(40, 60));
  await page.getByRole("button", { name: "Font settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Font" });
  await expect(dialog.getByRole("combobox", { name: "Font", exact: true })).toBeFocused();
  const results = await new AxeBuilder({ page }).include(".foli-font-dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByLabel("Font style").selectOption("bold");
  await dialog.getByLabel("Size").fill("16");
  await dialog.getByLabel("Underline style").selectOption("wave");
  await dialog.getByLabel("Small caps").check();
  await dialog.getByRole("tab", { name: "Advanced" }).click();
  await dialog.getByLabel("Spacing").selectOption("condensed");
  await dialog.getByLabel("By").fill("0.5");
  const advanced = await new AxeBuilder({ page }).include(".foli-font-dialog").analyze();
  expect(advanced.violations).toEqual([]);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);
  const marks = () =>
    page.evaluate(() => {
      const { state } = window.foliEdit.editor;
      let found: string[] = [];
      state.doc.nodesBetween(45, 46, (node) => {
        if (node.isText) found = node.marks.map((m) => m.type.name).sort();
      });
      return found;
    });
  expect(await marks()).toEqual(
    expect.arrayContaining(["bold", "characterSpacing", "fontSize", "smallCaps", "underline"]),
  );
  await page.keyboard.press("ControlOrMeta+z");
  expect(await marks()).not.toContain("smallCaps");
});

test("Font… in the right-click menu opens the Font dialog", async ({ page }) => {
  await open(page);
  const word = page.locator("section.foli-page").getByText("Open a .docx", { exact: false });
  await word.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Font…" }).click();
  await expect(page.getByRole("dialog", { name: "Font" })).toBeVisible();
});

test("the Tabs dialog, from the Paragraph dialog's Tabs…, sets a stop", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.foliEdit.editor.select(3));
  await page.getByRole("button", { name: "Paragraph settings" }).click();
  await page
    .getByRole("dialog", { name: "Paragraph" })
    .getByRole("button", { name: "Tabs…" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Tabs" });
  await expect(dialog.getByLabel("Tab stop position")).toBeFocused();
  await dialog.getByLabel("Tab stop position").fill("1.5");
  await dialog.getByLabel("Center").check();
  await dialog.getByLabel("Dots").check();
  await dialog.getByRole("button", { name: "Set" }).click();
  await expect(dialog.getByRole("option", { name: '1.5"' })).toBeAttached();
  const results = await new AxeBuilder({ page }).include(".foli-tabs-dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await attrs(page, 0)).tabs).toEqual([{ position: 2160, kind: "center", leader: "dot" }]);
});
