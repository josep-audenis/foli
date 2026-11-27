/**
 * Layout Options (33.4): the button beside a selected picture or text box, Layout ▸ Arrange's
 * Wrap Text and Position, on the corpus's text box flyer (11): the wrapping changes what the
 * page draws, an object goes in line and back where it was, and is put at a preset.
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
const wrapOf = (page: Page) =>
  logo(page).evaluate(
    (img) => img.closest("[data-foli-float]")?.getAttribute("data-foli-float") ?? "inline",
  );

test("the Layout Options button wraps the selected picture; in line and back where it was", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".foli-layout-options button")).toHaveCount(0);
  await logo(page).click();
  const button = page
    .locator(".foli-layout-options")
    .getByRole("button", { name: "Layout Options" });
  await expect(button).toBeVisible();
  // Beside the picture, on its right.
  const picture = await logo(page).boundingBox();
  const at = await button.boundingBox();
  expect(at && picture && at.x >= picture.x + picture.width).toBe(true);
  expect(await wrapOf(page)).toBe("tight");
  await button.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Tight" })).toBeChecked();
  const results = await new AxeBuilder({ page }).include(".foli-layout-options").analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("menuitemcheckbox", { name: "Square" }).click();
  await expect.poll(() => wrapOf(page)).toBe("square");
  const before = await logo(page).boundingBox();
  await button.click();
  await page.getByRole("menuitemcheckbox", { name: "In Line with Text" }).click();
  await expect.poll(() => wrapOf(page)).toBe("inline");
  await logo(page).click();
  await page
    .locator(".foli-layout-options")
    .getByRole("button", { name: "Layout Options" })
    .click();
  await page.getByRole("menuitemcheckbox", { name: "Square" }).click();
  await expect.poll(() => wrapOf(page)).toBe("square");
  // Floating again where it was drawn in line: its paragraph's start, the line's top.
  const after = await logo(page).boundingBox();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
});

test("Layout ▸ Position puts the selected picture at a preset; fixed on the page", async ({
  page,
}) => {
  await open(page);
  await logo(page).click();
  await page.getByRole("tab", { name: "Layout" }).click();
  await page.getByRole("button", { name: "Position" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Top right" }).click();
  const float = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            foliEdit: {
              editor: { state: { selection: { node?: { attrs: { float: unknown } } } } };
            };
          }
        ).foliEdit.editor.state.selection.node?.attrs.float,
    );
  await expect.poll(float).toMatchObject({
    wrap: "square",
    horizontal: { relativeTo: "margin", align: "right" },
  });
  // Against the margin it is fixed on the page; moved with its paragraph, then fixed again.
  await page.getByRole("button", { name: "Wrap Text" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Move with Text" }).click();
  await expect.poll(float).toMatchObject({ vertical: { relativeTo: "paragraph" } });
  await page.getByRole("button", { name: "Wrap Text" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Fix Position on Page" }).click();
  await expect.poll(float).toMatchObject({ vertical: { relativeTo: "page" } });
});
