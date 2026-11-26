/**
 * Zoom (29.6): the pages drawn at 50%, 100% and 200% with CSS `zoom`; clicking, selecting,
 * dragging and typing land where the pointer is. Ctrl+wheel asks for the next zoom.
 */
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page): Promise<void> {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
}

/** Where a word of the sample is on the screen. */
const box = (page: Page, word: string) =>
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
const selected = (page: Page) =>
  page.evaluate(() => {
    const { state } = window.foliEdit.editor;
    return state.doc.textBetween(state.selection.from, state.selection.to);
  });

for (const zoom of [0.5, 1, 2]) {
  test(`at ${zoom * 100}%, a click, a drag and typing land where the pointer is`, async ({
    page,
  }) => {
    await open(page);
    await page.evaluate((zoom) => window.foliEdit.view.setOptions({ zoom }), zoom);
    const width = await page.evaluate(
      () =>
        (document.querySelector("section.foli-page") as HTMLElement).getBoundingClientRect().width,
    );
    // A Letter or A4 page is about 800 px wide at 100%.
    expect(width / zoom).toBeGreaterThan(700);
    expect(width / zoom).toBeLessThan(900);
    const bold = await box(page, "Bold");
    await page.mouse.dblclick((bold.left + bold.right) / 2, bold.y);
    // Windows selects the space after a word with it.
    await expect.poll(async () => (await selected(page)).trim()).toBe("Bold");
    const word = await box(page, "Open");
    await page.mouse.move(word.left + 1, word.y);
    await page.mouse.down();
    await page.mouse.move(word.right - 1, word.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => selected(page)).toBe("Open");
    // A click just after "Bold", then typing: the text goes there.
    const again = await box(page, "Bold");
    await page.mouse.click(again.right + 0.5, again.y);
    await page.keyboard.type("X");
    await expect
      .poll(() =>
        page.evaluate(() => window.foliEdit.editor.state.doc.textContent.includes("BoldX")),
      )
      .toBe(true);
  });
}

test("Ctrl+wheel over the document asks for the next zoom, 10% a notch", async ({ page }) => {
  await open(page);
  const bold = await box(page, "Bold");
  await page.mouse.move(bold.left, bold.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect
    .poll(() => page.evaluate(() => (document.getElementById("editor") as HTMLElement).style.zoom))
    .toBe("1.1");
});
