/**
 * Sections on pages in the editable view (11.6), on the editing page (`/edit.html`): columns of
 * equal and set widths, the line between them, column breaks, continuous sections with balanced
 * columns, Word's blank page, and the section menu and page setup dialog from the keyboard.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

const A4 = {
  pageSize: { width: 11906, height: 16838 },
  margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
};
const words = (n: number, word: string) => Array.from({ length: n }, () => word).join(" ");
const paragraph = (text: string, section?: Json, content?: Json[]): Json => ({
  type: "paragraph",
  ...(section ? { attrs: { section } } : {}),
  ...(content ? { content } : text ? { content: [{ type: "text", text }] } : {}),
});
const documentOf = (blocks: Json[], section: Json = A4): Json => ({
  schemaVersion: 5,
  section,
  defaults: { paragraph: { spacing: { after: 160 } } },
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: { type: "doc", content: blocks },
});

async function load(page: Page, document: Json) {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), document);
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  text: string;
}
const columns = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".foli-column")].map((column) => {
      const box = column.getBoundingClientRect();
      const last = column.lastElementChild?.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: last?.bottom ?? box.top,
        text: column.textContent ?? "",
      } satisfies Box;
    }),
  );
const pageCount = (page: Page) => page.locator("section.foli-page").count();
const documentText = (page: Page) =>
  page.evaluate(() => window.foliEdit.editor.state.doc.textContent);

/** One column, then two balanced ones with a line between them, then one again. */
const banded = (text = words(400, "alpha")) =>
  documentOf(
    [
      paragraph("Before the columns.", A4),
      paragraph(text, {
        ...A4,
        type: "continuous",
        columns: { count: 2, space: 720, separator: true },
      }),
      paragraph("After the columns."),
    ],
    { ...A4, type: "continuous" },
  );

test("a continuous section's columns are level, between the bands around them", async ({
  page,
}) => {
  await load(page, banded());
  expect(await pageCount(page)).toBe(1);
  const [above, first, second, below] = (await columns(page)) as [Box, Box, Box, Box];
  expect(above.text).toBe("Before the columns.");
  expect(first.text.length).toBeGreaterThan(100);
  expect(second.left).toBeGreaterThan(first.right);
  // 720 twips between them; the two start level and end within two lines of each other.
  expect(second.left - first.right).toBeCloseTo(48, 0);
  expect(second.top).toBeCloseTo(first.top, 0);
  expect(Math.abs(second.bottom - first.bottom)).toBeLessThan(45);
  expect(first.top).toBeGreaterThanOrEqual(above.bottom);
  expect(below.top).toBeGreaterThanOrEqual(Math.max(first.bottom, second.bottom) - 1);
  expect(below.text).toBe("After the columns.");
  const line = await page
    .locator(".foli-band")
    .nth(1)
    .evaluate((band) => getComputedStyle(band).backgroundImage);
  expect(line).toContain("gradient");
});

test("typing in the second column stays there, and undo brings the columns back", async ({
  page,
}) => {
  await load(page, banded());
  const before = await documentText(page);
  // A place in the second column, through the view's own mapping of the DOM.
  await page.evaluate(() => {
    const column = document.querySelectorAll(".foli-column")[2] as HTMLElement;
    const text = column.querySelector("span")?.firstChild as Text;
    const { editor, view } = window.foliEdit;
    editor.select(view.posFromDOM(text, 6) as number);
  });
  await editor(page).focus();
  await page.keyboard.type("Z");
  const after = await documentText(page);
  expect(after.length).toBe(before.length + 1);
  expect(after.indexOf("Z")).toBeGreaterThan(100);
  expect((await columns(page))[2]?.text).toContain("Z");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await documentText(page)).toBe(before);
  await page.evaluate(() => window.foliEdit.validate());
});

test("set widths and a column break: each column has its width and its text", async ({ page }) => {
  const set = {
    ...A4,
    columns: {
      count: 2,
      space: 360,
      equalWidth: false,
      widths: [{ width: 2000, space: 360 }, { width: 6666 }],
    },
  };
  await load(
    page,
    documentOf(
      [
        paragraph("", undefined, [
          { type: "text", text: "narrow" },
          { type: "columnBreak" },
          { type: "text", text: words(120, "wide") },
        ]),
      ],
      set,
    ),
  );
  const [first, second] = (await columns(page)) as [Box, Box];
  expect(first.right - first.left).toBeCloseTo((2000 * 96) / 1440, 0);
  expect(second.right - second.left).toBeCloseTo((6666 * 96) / 1440, 0);
  expect(second.left - first.right).toBeCloseTo(24, 0);
  expect(first.text).toBe("narrow");
  expect(second.text.startsWith("wide")).toBe(true);
});

test("an odd page section after page 1 leaves a blank page of its own setup", async ({ page }) => {
  const landscape = {
    ...A4,
    type: "oddPage",
    pageSize: { width: 16838, height: 11906, orientation: "landscape" },
  };
  await load(page, documentOf([paragraph("one", A4), paragraph("three")], landscape));
  // Pages 1 and 3 have text; 3 is odd, so page 2 stays blank... of the later section's size.
  await page.evaluate(() => window.foliEdit.validate());
  const pages = await page
    .locator("section.foli-page")
    .evaluateAll((all) =>
      all.map((p) => [Math.round(p.getBoundingClientRect().width), p.textContent]),
    );
  expect(pages.map(([, text]) => text)).toEqual(["one", "", "three"]);
  expect(pages[1]?.[0]).toBe(pages[2]?.[0]);
  expect(pages[1]?.[0]).toBeGreaterThan(pages[0]?.[0] as number);
  // Typing in the section keeps its pages.
  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("!");
  expect(await pageCount(page)).toBe(3);
});

test("the section menu and page setup dialog work from the keyboard and pass axe", async ({
  page,
}) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await load(page, documentOf([paragraph(words(200, "gamma"))]));
  await page.evaluate(() => window.foliEdit.editor.select(7));
  const button = page.getByRole("button", { name: "Section", exact: true });
  await button.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Section" });
  await expect(menu).toBeVisible();
  const scan = async (selector: string) =>
    (await new AxeBuilder({ page }).include(selector).analyze()).violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`,
    );
  expect(await scan(".foli-toolbar")).toEqual([]);
  // "Section break: continuous", the third item.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Section break: continuous" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  const sections = () =>
    page.evaluate(() => {
      const { content, section } = window.foliEdit.editor.getDocument();
      return {
        held: (content.content ?? []).filter((b) => b.attrs?.section).length,
        type: section.type,
        columns: section.columns?.count,
      };
    });
  expect(await sections()).toMatchObject({ held: 1, type: "continuous" });
  // Page setup, for the section the caret is in now (the last): two columns.
  await button.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Page setup…" })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Page setup" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Section starts")).toBeFocused();
  expect(await scan(".foli-setup-dialog")).toEqual([]);
  // A wrong value is announced and focused.
  await dialog.getByLabel("Columns", { exact: true }).fill("99");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("Columns");
  await expect(dialog.getByLabel("Columns", { exact: true })).toBeFocused();
  await dialog.getByLabel("Columns", { exact: true }).fill("2");
  await dialog.getByLabel("Line between columns").check();
  await dialog.getByRole("button", { name: "Apply" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(await sections()).toMatchObject({ columns: 2 });
  await expect(page.locator(".foli-column")).toHaveCount(3);
  // Undo takes the last section's setup back; Escape closes the dialog without a change.
  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sections()).columns).toBeUndefined();
  await button.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(await scan("#editor > .foli-page")).toEqual([]);
});

test("the newsletter's sections are on Word's pages in the editor", async ({ page }) => {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(
    new URL("../../../corpus/word/08-newsletter.docx", import.meta.url),
  ).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await expect.poll(() => pageCount(page)).toBe(5);
  const counts = await page
    .locator("section.foli-page")
    .evaluateAll((all) => all.map((p) => p.querySelectorAll(".foli-column").length));
  // Three bands on page 1 (1 + 2 + 1 columns), page 3 of three columns, the others plain.
  expect(counts).toEqual([4, 0, 3, 0, 0]);
  expect(await page.locator("section.foli-page").nth(3).textContent()).toBe("");
});
