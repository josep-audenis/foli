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
  // Settled: fonts loaded and the relayout they cause drawn.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
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

/** The table row (index) and cell (index) the caret is in. */
const where = (page: Page) =>
  page.evaluate(() => {
    const { selection, doc } = window.foliEdit.editor.state;
    const $pos = doc.resolve(selection.head);
    for (let d = $pos.depth; d > 0; d--)
      if ($pos.node(d).type.name === "tableCell")
        return { row: $pos.index(d - 2), cell: $pos.index(d - 1), text: $pos.parent.textContent };
    return { row: -1, cell: -1, text: $pos.parent.textContent };
  });

test("Tab goes to the next cell; Down from the last row on page 1 goes to the first on page 2", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  await page
    .locator("td", { hasText: /^Support item 33$/ })
    .first()
    .click();
  await page.keyboard.press("Tab");
  expect(await where(page)).toMatchObject({ row: 36, cell: 2, text: "each" });
  await page.keyboard.press("ArrowDown");
  // Row 38 starts page 2 (under the repeated header).
  expect(await where(page)).toMatchObject({ row: 37, cell: 2 });
  await page.keyboard.press("Shift+Tab");
  expect((await where(page)).cell).toBe(1);
});

test("Up from the header row leaves the table, to the paragraph above it", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  await page
    .locator("td", { hasText: /^Unit$/ })
    .first()
    .click();
  await page.keyboard.press("ArrowUp");
  expect((await where(page)).row).toBe(-1);
});

/** The model selection's kind and, for cells, how many and the cells marked in the DOM. */
const selected = (page: Page) =>
  page.evaluate(() => {
    const json = window.foliEdit.editor.state.selection.toJSON();
    const cells = (window.foliEdit.editor.state.selection as unknown as { cells?: number[] }).cells;
    return {
      type: json.type,
      cells: cells?.length ?? 0,
      marked: document.querySelectorAll("td.foli-selected-cell").length,
    };
  });

test("a drag across cells selects them; Delete empties them", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  const from = page.locator("td", { hasText: /^Hardware item 4$/ }).first();
  const to = page.locator("td", { hasText: /^Hardware item 5$/ }).first();
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("no cells");
  // Inside each cell's text (a cell's edge can belong to the merged category cell beside it).
  await page.mouse.move(a.x + a.width / 3, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 3, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  // `selectionchange` is asynchronous: the view reads the drag when it arrives.
  await expect.poll(() => selected(page)).toEqual({ type: "cell", cells: 2, marked: 2 });
  await page.keyboard.press("Delete");
  const texts = await page.evaluate(() => {
    const out: string[] = [];
    window.foliEdit.editor.state.doc.descendants((node) => {
      if (node.isTextblock && /^Hardware item [45]$/.test(node.textContent))
        out.push(node.textContent);
    });
    return out;
  });
  expect(texts).toEqual([]);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

test("Shift+Down from a cell's last line selects cells; Shift+Right widens them", async ({
  page,
}) => {
  await open(page, "06-price-schedule.docx");
  await page
    .locator("td", { hasText: /^Hardware item 3$/ })
    .first()
    .click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await selected(page)).toEqual({ type: "cell", cells: 2, marked: 2 });
  await page.keyboard.press("Shift+ArrowRight");
  expect(await selected(page)).toEqual({ type: "cell", cells: 4, marked: 4 });
});

test("a paste over selected cells goes into the anchor cell; the table stays", async ({ page }) => {
  await open(page, "06-price-schedule.docx");
  await page
    .locator("td", { hasText: /^Hardware item 3$/ })
    .first()
    .click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  expect((await selected(page)).cells).toBe(4);
  const tables = () =>
    page.evaluate(() => {
      let count = 0;
      window.foliEdit.editor.state.doc.descendants((node) => {
        if (node.type.name === "table") count++;
      });
      return count;
    });
  const before = await tables();
  await page.evaluate(() =>
    window.foliEdit.view.paste({ getData: (type: string) => (type === "text/plain" ? "Z" : "") }),
  );
  expect(await tables()).toBe(before);
  await expect(page.locator("td", { hasText: /^Z$/ })).toHaveCount(1);
  await expect(page.locator("td", { hasText: /^Hardware item 4$/ })).toHaveCount(1);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});
