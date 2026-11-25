/**
 * Word's ribbon (Phase 25): `edit.html?ribbon` shows `wordRibbonTabs` with `overflow="menu"`.
 * Tabs of captioned groups, the table tabs that come with the selection, collapsing, large
 * buttons drawn small before groups go under More, and KeyTips.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const tab = (page: Page, name: string) => page.getByRole("tab", { name });
const panel = (page: Page) => page.locator(".foli-ribbon-panel");

async function open(page: Page, docx?: string): Promise<void> {
  await page.goto("/edit.html?ribbon");
  await page.waitForFunction(() => "foliEdit" in window);
  if (docx) {
    const base64 = readFileSync(new URL(docx, CORPUS)).toString("base64");
    await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
    await page.waitForFunction(() => document.querySelectorAll("section.foli-page").length >= 1);
  }
  await page.evaluate(() => document.fonts.ready);
  await expect(tab(page, "Home")).toHaveAttribute("aria-selected", "true");
}

test("shows Word's tabs in captioned groups, without axe violations", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page);
  await expect(page.getByRole("tab")).toHaveText([
    "Home",
    "Insert",
    "Layout",
    "References",
    "Review",
    "View",
  ]);
  await expect(toolbar(page).getByRole("group", { name: "Font" })).toBeVisible();
  const scan = async () =>
    (await new AxeBuilder({ page }).include(".foli-ribbon").analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`,
    );
  expect(await scan()).toEqual([]);
  await tab(page, "References").click();
  const footnotes = toolbar(page).getByRole("group", { name: "Footnotes" });
  await expect(footnotes.getByRole("button", { name: "Footnote" })).toHaveClass(
    /foli-toolbar-large/,
  );
  await expect(footnotes.getByRole("button", { name: "Note options…" })).toHaveClass(
    /foli-toolbar-launcher/,
  );
  expect(await scan()).toEqual([]);
  await expect(page.locator(".foli-ribbon")).toHaveScreenshot("ribbon-references.png");
});

test("shows the table tabs while the caret is in a table, and runs their buttons", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  await expect(tab(page, "Table Layout")).toHaveCount(0);
  await editor(page).locator("td").first().click();
  await expect(tab(page, "Table Design")).toBeVisible();
  await expect(tab(page, "Table Layout")).toHaveClass(/foli-ribbon-tab-contextual/);
  await tab(page, "Table Layout").click();
  const rows = () => editor(page).locator("tr").count();
  const before = await rows();
  await toolbar(page).getByRole("button", { name: "Insert below" }).click();
  await expect.poll(rows).toBe(before + 1);
  // Out of the table: the tabs go, and Home shows again.
  await editor(page).locator(".foli-page > p").first().click();
  await expect(tab(page, "Table Layout")).toHaveCount(0);
  await expect(tab(page, "Home")).toHaveAttribute("aria-selected", "true");
});

test("collapses to its tabs; a tab's panel shows over the document until a command runs", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Collapse the ribbon" }).click();
  await expect(panel(page)).toBeHidden();
  await tab(page, "Home").click();
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".foli-ribbon")).toHaveClass(/foli-ribbon-floating/);
  await toolbar(page).getByRole("button", { name: "Bold" }).click();
  await expect(panel(page)).toBeHidden();
  // Ctrl+F1 from the document pins it again.
  await editor(page).click();
  await page.keyboard.press("Control+F1");
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse the ribbon" })).toBeVisible();
});

for (const width of [1366, 1024, 768]) {
  test(`at ${width} px, draws large buttons small before groups go under More; every item reachable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 768 });
    await open(page);
    await tab(page, "Review").click();
    const all = await toolbar(page).locator(".foli-toolbar-button, .foli-toolbar-select").count();
    // Nothing is cut off: what does not fit is in the More panel.
    const overflow = await toolbar(page).evaluate((bar) => bar.scrollWidth - bar.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const inMore = await page.locator(".foli-toolbar-more-panel").count();
    if (inMore) {
      // Groups went under More only once every large button was drawn small.
      await expect(toolbar(page).locator(".foli-toolbar-large")).toHaveCount(0);
      await page.getByRole("button", { name: "More" }).click();
    }
    for (const button of await toolbar(page)
      .locator(".foli-toolbar-button:not(.foli-toolbar-more)")
      .all())
      await expect(button).toBeVisible();
    expect(all).toBeGreaterThan(0);
  });
}

test("KeyTips: Alt, a tab's letter, an item's letter", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page);
  await editor(page).click();
  const text = await editor(page).innerText();
  await page.keyboard.press("Alt");
  await expect(page.locator(".foli-keytip")).toHaveCount(6);
  await page.keyboard.press("n");
  await expect(tab(page, "Insert")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".foli-keytip").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator(".foli-keytip")).toHaveCount(0);
  // The letters went to the ribbon, not into the document.
  expect(await editor(page).innerText()).toBe(text);
});
