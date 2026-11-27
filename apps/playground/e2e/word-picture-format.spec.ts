/**
 * Picture Format and Shape Format (33.6) on the corpus's text box flyer (11): the contextual tab
 * a selected picture or text box brings, its Size boxes, Arrange's Bring Forward, Send Backward
 * and Align, and axe on the tab.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL("11-text-box-flyer.docx", CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(() => document.querySelectorAll("[data-foli-text-box]").length >= 4);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

const logo = (page: Page) =>
  page.locator('[contenteditable] img[alt="Northwind logo, wrapped tight"]').first();
const selected = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          foliEdit: {
            editor: { state: { selection: { node?: { attrs: Record<string, unknown> } } } };
          };
        }
      ).foliEdit.editor.state.selection.node?.attrs ?? null,
  );

test("a selected picture brings Picture Format: its size in the boxes, Arrange's menus", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("tab", { name: "Picture Format" })).toHaveCount(0);
  await logo(page).click();
  await page.getByRole("tab", { name: "Picture Format" }).click();
  const results = await new AxeBuilder({ page }).include(".foli-toolbar").analyze();
  expect(results.violations).toEqual([]);
  const width = page.getByRole("spinbutton", { name: "Width" });
  await expect(width).toHaveValue(/2.22|5.64/);
  // A picture keeps its ratio: half the width, half the height.
  const before = (await selected(page)) as { width: number; height: number };
  await width.fill("1.11");
  await width.press("Enter");
  await expect
    .poll(async () => ((await selected(page)) as { height: number }).height)
    .toBeLessThan(before.height * 0.6);
  await page.getByRole("button", { name: "Bring Forward" }).click();
  await page.getByRole("menuitem", { name: "Bring to Front" }).click();
  await expect
    .poll(async () => ((await selected(page))?.float as { zOrder?: number })?.zOrder ?? 0)
    .toBeGreaterThan(251_658_240);
  await page.getByRole("button", { name: "Align" }).click();
  await page.getByRole("menuitem", { name: "Align Center" }).click();
  await expect
    .poll(async () => (await selected(page))?.float)
    .toMatchObject({ horizontal: { relativeTo: "margin", align: "center" } });
});

test("a selected text box brings Shape Format with Arrange and Size", async ({ page }) => {
  await open(page);
  const box = await page.locator('[data-foli-text-box="textbox:2"]').first().boundingBox();
  if (!box) throw new Error("no box");
  await page.mouse.click(box.x + 10, box.y + 10);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Shape Format" }).click();
  await expect(page.getByRole("tab", { name: "Picture Format" })).toHaveCount(0);
  const height = page.getByRole("spinbutton", { name: "Height" });
  await height.fill("1");
  await height.press("Enter");
  await expect
    .poll(async () => ((await selected(page)) as { height: number }).height)
    .toBe(914_400);
  // A box's width stays when its height changes.
  expect(((await selected(page)) as { width: number }).width).toBe(4_572_000);
  await page.getByRole("button", { name: "Send Backward" }).click();
  await page.getByRole("menuitem", { name: "Send Behind Text" }).click();
  await expect
    .poll(async () => ((await selected(page))?.float as { wrap?: string })?.wrap)
    .toBe("behind");
});
