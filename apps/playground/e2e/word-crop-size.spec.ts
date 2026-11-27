/**
 * Crop handles, resizing and the Size dialog (33.5) on the corpus's text box flyer (11): Picture
 * Format ▸ Crop puts handles on the selected picture's edges, a drag crops it; a text box's handle
 * resizes it freely, with Shift keeping its ratio; the Layout dialog's Size tab sizes a picture,
 * its ratio locked.
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
/** The selected node's attributes. */
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

test("Picture Format ▸ Crop puts handles on the picture's edges; a drag crops it", async ({
  page,
}) => {
  await open(page);
  await logo(page).click();
  await page.getByRole("tab", { name: "Picture Format" }).click();
  const crop = page.getByRole("button", { name: "Crop", exact: true });
  await crop.click();
  await expect(crop).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-foli-crop]")).toHaveCount(4);
  await expect(page.locator("[data-foli-resize]")).toHaveCount(0);
  await page.locator('[data-foli-crop="left"]').scrollIntoViewIfNeeded();
  const handle = await page.locator('[data-foli-crop="left"]').boundingBox();
  if (!handle) throw new Error("no crop handle");
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => ((await selected(page))?.crop as { left?: number })?.left ?? 0)
    .toBeGreaterThan(5_000);
  // Word keeps the image's scale: what is cut makes the picture narrower.
  expect(Number((await selected(page))?.width)).toBeLessThan(2_032_000);
  await crop.click();
  await expect(page.locator("[data-foli-crop]")).toHaveCount(0);
});

test("a text box's handle resizes it freely; Shift keeps its ratio", async ({ page }) => {
  await open(page);
  const box = page.locator('[data-foli-text-box="textbox:1"]').first();
  const at = await box.boundingBox();
  if (!at) throw new Error("no box");
  // A press opens it; Escape leaves it selected, with its handle.
  await page.mouse.click(at.x + 10, at.y + 10);
  await page.keyboard.press("Escape");
  const handle = page.locator("[data-foli-resize]");
  await expect(handle).toHaveCount(1);
  const before = (await selected(page)) as { width: number; height: number };
  const h = await handle.boundingBox();
  if (!h) throw new Error("no handle");
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 40, h.y + h.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => ((await selected(page)) as { width: number }).width)
    .toBeLessThan(before.width);
  const free = (await selected(page)) as { width: number; height: number };
  expect(free.height).toBeGreaterThan(before.height);
  const h2 = await page.locator("[data-foli-resize]").boundingBox();
  if (!h2) throw new Error("no handle");
  await page.keyboard.down("Shift");
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await page.mouse.down();
  await page.mouse.move(h2.x + h2.width / 2 + 60, h2.y + h2.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect
    .poll(async () => ((await selected(page)) as { width: number }).width)
    .toBeGreaterThan(free.width);
  const kept = (await selected(page)) as { width: number; height: number };
  expect(Math.abs(kept.height / kept.width - free.height / free.width)).toBeLessThan(0.01);
});

test("the Size dialog sizes a picture, its ratio locked, in one undo step", async ({ page }) => {
  await open(page);
  await logo(page).click();
  const before = (await selected(page)) as { width: number; height: number };
  await page.getByRole("tab", { name: "Picture Format" }).click();
  await page.getByRole("button", { name: "Size…" }).click();
  const dialog = page.getByRole("dialog", { name: "Layout" });
  await expect(dialog.getByRole("tab", { name: "Size" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByLabel("Lock aspect ratio")).toBeChecked();
  const results = await new AxeBuilder({ page }).include(".foli-layout-dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByLabel("Scale height (%)").fill("50");
  await expect(dialog.getByLabel("Scale width (%)")).toHaveValue("50");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect
    .poll(async () => ((await selected(page)) as { width: number }).width)
    .toBeLessThan(before.width * 0.51);
  const after = (await selected(page)) as { width: number; height: number };
  expect(Math.abs(after.height - before.height / 2)).toBeLessThan(13_000);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => ((await selected(page)) as { width: number } | null)?.width)
    .toBe(before.width);
});
