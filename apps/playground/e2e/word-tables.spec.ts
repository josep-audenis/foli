/**
 * Tables on pages in the editable view (10.5): the corpus's price schedule (06) opened on the
 * editing page, laid out as Word lays it out (two pages, the header row repeated, the row that
 * may not split moved whole), with its cells' text editable and read back.
 */
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

async function open(page: Page, name: string): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL(name, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(() => document.querySelectorAll("section.foli-page").length >= 2);
}

/** Per page: the rows of the table it shows, and the repeated header rows among them. */
const pages = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("section.foli-page")].map((section) => ({
      rows: [
        ...section.querySelectorAll(":scope > [data-foli-frame=table] > table > tbody > tr"),
      ].map((tr) => (tr.hasAttribute("data-foli-repeated") ? "header" : (tr.textContent ?? ""))),
    })),
  );

test("the price schedule is on two pages, as in Word, with its header row repeated", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  const shown = await pages(page);
  expect(shown.length).toBe(2);
  // Word's page 2 starts with the row that may not split ("Support item 34", too tall to fit).
  const second = shown[1]?.rows ?? [];
  expect(second[0]).toBe("header");
  expect(second[1]).toContain("Support item 34 with a longer description");
  expect(shown[0]?.rows.some((r) => r.includes("Support item 33"))).toBe(true);
  // Every row once (the repeated header aside).
  expect([...(shown[0]?.rows ?? []), ...second].filter((r) => r !== "header").length).toBe(41);
});

test("text typed in a cell on the second page goes into its paragraph", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  const cell = page.locator("td", { hasText: /^Support item 35$/ }).first();
  await cell.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" plus");
  const texts = await page.evaluate(() => {
    const out: string[] = [];
    window.foliEdit.editor.state.doc.descendants((node) => {
      if (node.isTextblock && node.textContent.startsWith("Support item 35"))
        out.push(node.textContent);
    });
    return out;
  });
  expect(texts).toEqual(["Support item 35 plus"]);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
  await expect(editor(page)).toContainText("Support item 35 plus");
});

test("a click on the repeated header row puts the caret in the first row below it", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  await page.locator("[data-foli-repeated] td").first().click();
  const row = await page.evaluate(() => {
    const { selection, doc } = window.foliEdit.editor.state;
    const $pos = doc.resolve(selection.from);
    return $pos.depth >= 2 ? $pos.index(1) : -1;
  });
  // Row 38 (index 37): the first row on page 2.
  expect(row).toBe(37);
});
