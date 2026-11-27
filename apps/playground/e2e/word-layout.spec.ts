/**
 * Layout Options (33.4): the button beside a selected picture or text box, Layout ▸ Arrange's
 * Wrap Text and Position, on the corpus's text box flyer (11): the wrapping changes what the
 * page draws, an object goes in line and back where it was, and is put at a preset.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const REFERENCE = new URL("../../../corpus/reference/word/11-text-box-flyer.json", import.meta.url);
/** Word's floating pictures in the flyer: wrapped tight and through. */
const wordPictures = (
  JSON.parse(readFileSync(REFERENCE, "utf8").replace(/^﻿/, "")) as {
    pictures: { alt: string; left: number; top: number; width: number; wrap: number }[];
  }
).pictures;

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

test("the Layout dialog sets wrapping, distance and position in one step", async ({ page }) => {
  await open(page);
  await logo(page).click();
  await page.getByRole("tab", { name: "Layout" }).click();
  await page.getByRole("button", { name: "Wrap Text" }).click();
  await page.getByRole("menuitem", { name: "More Layout Options…" }).click();
  const dialog = page.getByRole("dialog", { name: "Layout" });
  await expect(dialog.getByRole("tab", { name: "Text Wrapping" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByLabel("Tight")).toBeChecked();
  const results = await new AxeBuilder({ page }).include(".foli-layout-dialog").analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByLabel("Behind text").check();
  await dialog.getByLabel("Left", { exact: true }).fill("0.5");
  await dialog.getByRole("tab", { name: "Position" }).click();
  await dialog.locator("input[id$='-horizontal-offset-value']").fill("1");
  await dialog.locator("select[id$='-horizontal-offset-from']").selectOption("page");
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);
  const float = await page.evaluate(
    () =>
      (
        window as unknown as {
          foliEdit: { editor: { getDocument(): { content: unknown } } };
        }
      ).foliEdit.editor.getDocument().content,
  );
  const json = JSON.stringify(float);
  expect(json).toContain('"wrap":"behind"');
  expect(json).toContain('"horizontal":{"relativeTo":"page","offset":914400}');
  expect(json).toContain('"left":457200');
  await expect.poll(() => wrapOf(page)).toBe("behind");
  // One undo takes it all back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => wrapOf(page)).toBe("tight");
});

test("pictures wrapped tight and through are where Word puts them, lines around them", async ({
  page,
}, info) => {
  await open(page);
  for (const word of wordPictures) {
    const at = await page.evaluate((alt) => {
      const img = document.querySelector(`[contenteditable] img[alt="${alt}"]`) as HTMLElement;
      const holder = img.closest("[data-foli-float]") as HTMLElement;
      const fragment = holder.parentElement as HTMLElement;
      const section = img.closest("section.foli-page") as HTMLElement;
      const s = section.getBoundingClientRect();
      const scale = s.width / section.offsetWidth;
      const left = s.left + Number.parseFloat(getComputedStyle(section).paddingLeft) * scale;
      const r = img.getBoundingClientRect();
      const lines: { left: number; right: number; top: number; bottom: number }[] = [];
      const range = document.createRange();
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim() || node.parentElement?.closest("[data-foli-text-box]"))
          continue;
        range.selectNodeContents(node);
        for (const x of range.getClientRects())
          lines.push({ left: x.left, right: x.right, top: x.top, bottom: x.bottom });
      }
      return {
        wrap: holder.getAttribute("data-foli-float"),
        left: (r.left - left) / scale,
        top: (r.top - fragment.getBoundingClientRect().top) / scale,
        box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        lines,
      };
    }, word.alt);
    info.annotations.push({ type: word.alt, description: JSON.stringify({ word, at }) });
    expect(at.wrap).toBe(word.wrap === 1 ? "tight" : "through");
    expect(Math.abs(at.left - word.left * (96 / 72))).toBeLessThan(1.5);
    expect(Math.abs(at.top - word.top * (96 / 72))).toBeLessThan(1.5);
    const beside = at.lines.filter((l) => l.top < at.box.bottom - 1 && l.bottom > at.box.top + 1);
    expect(beside.length).toBeGreaterThan(0);
    for (const line of beside)
      expect(line.right <= at.box.left + 1 || line.left >= at.box.right - 1).toBe(true);
  }
});
