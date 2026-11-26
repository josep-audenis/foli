/**
 * Word's ribbon (Phase 25): `edit.html` shows `wordRibbonTabs` with `overflow="menu"`.
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
  await page.goto("/edit.html");
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

/** The Review tab at a width: how many large buttons, whether More shows, how many items. */
async function reviewAt(page: Page, width: number) {
  await page.setViewportSize({ width, height: 768 });
  // Measured again by a ResizeObserver: wait for the row to stop changing.
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await stateOf(page));
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return JSON.parse(last) as Awaited<ReturnType<typeof stateOf>>;
}
const stateOf = (page: Page) =>
  toolbar(page).evaluate((bar) => ({
    large: bar.querySelectorAll(".foli-toolbar-large").length,
    more: bar.querySelector(".foli-toolbar-more-panel") !== null,
    items: bar.querySelectorAll(
      ".foli-toolbar-button:not(.foli-toolbar-more), .foli-toolbar-select",
    ).length,
    // How far the last item shown in the row passes the row's end (a hidden More, there for
    // its width, may pass it: it is not shown).
    cut: Math.max(
      0,
      ...[...bar.querySelectorAll<HTMLElement>(".foli-toolbar-button, .foli-toolbar-select")]
        .filter(
          (e) =>
            !e.closest(".foli-toolbar-more-panel") && getComputedStyle(e).visibility !== "hidden",
        )
        .map((e) => e.getBoundingClientRect().right - bar.getBoundingClientRect().right),
    ),
  }));

test("puts groups under More as the row narrows, nothing cut off, every item reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 768 });
  await open(page);
  await tab(page, "Review").click();
  const wide = await reviewAt(page, 1600);
  // Review has four large buttons (New comment, Track changes, Accept, Reject), all room.
  expect(wide.large).toBe(4);
  expect(wide.more).toBe(false);
  let more = false;
  let large = wide.large;
  let moreAt = 0;
  for (let width = 1366; width >= 320; width -= 22) {
    const at = await reviewAt(page, width);
    // With icons (29.2), large buttons drawn small are narrower: they shrink before any group
    // goes under More, and never grow back as the row narrows.
    if (at.more && !more) expect(at.large, `at ${width} px`).toBeLessThan(4);
    if (at.more && !more) moreAt = width;
    more ||= at.more;
    expect(at.cut, `at ${width} px`).toBeLessThanOrEqual(1);
    expect(at.items, `at ${width} px`).toBe(wide.items);
    expect(at.large, `at ${width} px`).toBeLessThanOrEqual(large);
    large = at.large;
  }
  expect(more).toBe(true);
  // Where More first shows, the panel's items are reachable: More opens them.
  await reviewAt(page, moreAt);
  await page.getByRole("button", { name: "More" }).click();
  for (const button of await toolbar(page)
    .locator(".foli-toolbar-more-panel .foli-toolbar-button")
    .all())
    await expect(button).toBeVisible();
  // Wide again: nothing under More.
  expect(await reviewAt(page, 1600)).toEqual(wide);
});

test("Tab goes from the tabs into the toolbar, then to the collapse button", async ({ page }) => {
  await open(page);
  await tab(page, "Home").focus();
  await page.keyboard.press("Tab");
  await expect(toolbar(page).getByRole("button", { name: "Undo" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Collapse the ribbon" })).toBeFocused();
});

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

test("paints the formatting copied with Format painter onto a pointer selection", async ({
  page,
}) => {
  await open(page);
  /** Where a word of the sample is on the screen. */
  const box = (word: string) =>
    page.evaluate((word) => {
      const walker = document.createTreeWalker(
        document.querySelector("section.foli-page") as Node,
        NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(word) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const { left, right, top, height } = range.getBoundingClientRect();
        return { left, right, y: top + height / 2 };
      }
      throw new Error(`no ${word}`);
    }, word);
  const bold = await box("Bold");
  await page.mouse.dblclick((bold.left + bold.right) / 2, bold.y);
  const painter = page.getByRole("button", { name: "Format painter" });
  await painter.click();
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".foli-format-painter")).toHaveCount(1);
  const target = await box("Open");
  await page.mouse.move(target.left + 1, target.y);
  await page.mouse.down();
  await page.mouse.move(target.right - 1, target.y, { steps: 4 });
  await page.mouse.up();
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  const weight = await page.evaluate(() => {
    const span = [...document.querySelectorAll("section.foli-page span")].find((s) =>
      s.textContent?.startsWith("Open"),
    );
    return span && getComputedStyle(span).fontWeight;
  });
  expect(weight).toBe("700");
  await editor(page).press("Control+z");
});

test("shows formatting marks over the text, the document's text unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await open(page);
  const before = await editor(page).innerText();
  const button = page.getByRole("button", { name: "Show formatting marks" });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const layer = page.locator(".foli-formatting-marks");
  await expect(layer).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => layer.evaluate((l) => l.textContent?.includes("¶") ?? false)).toBe(true);
  expect(await layer.evaluate((l) => (l.textContent?.match(/·/g) ?? []).length)).toBeGreaterThan(5);
  // The document's text is as it was.
  expect(await editor(page).innerText()).toBe(before);
  await button.click();
  await expect(layer).toHaveCount(0);
});
