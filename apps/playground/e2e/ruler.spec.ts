/**
 * The ruler (31.x): its handles dragged at 100% and 200% zoom change the document as the
 * Paragraph and Page setup dialogs do, in one undo step, and stay under the pointer; each is a
 * slider the keyboard moves; axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page, zoom: number): Promise<void> {
  await page.goto("/edit.html?toolbar&ruler");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((zoom) => window.foliEdit.zoom(zoom), zoom);
  // The caret in the paragraph after the heading.
  await page.evaluate(() => {
    const { editor, view } = window.foliEdit;
    let pos = 0;
    editor.state.doc.descendants((node, at) => {
      if (!pos && node.isTextblock && node.textContent.startsWith("Open")) pos = at + 3;
    });
    view.focus();
    editor.select(pos, pos);
  });
  await settled(page);
}

/** Waits for the ruler to have read the pages as they are now (it reads in the next frame). */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const g = await geometry(page);
      const box = await page.locator('[data-foli-ruler="left"]').boundingBox();
      return g?.paragraph && box ? Math.abs(box.x + box.width / 2 - g.paragraph.left) : 99;
    })
    .toBeLessThan(1);
}

/** The centre of a handle on the screen. */
const handle = async (page: Page, key: string) => {
  const box = await page.locator(`[data-foli-ruler="${key}"]`).boundingBox();
  if (!box) throw new Error(`no ${key}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const indent = (page: Page) =>
  page.evaluate(() => window.foliEdit.editor.state.selection.$head.parent.attrs.indent);
const geometry = (page: Page) =>
  page.evaluate(() => window.foliEdit.editor.storyView?.rulerGeometry?.() ?? null);

/** Drags from `from` to `x` (same height) in steps, as a person does. */
async function drag(page: Page, from: { x: number; y: number }, x: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(x, from.y, { steps: 6 });
  await page.mouse.up();
}

for (const zoom of [1, 2]) {
  test(`at ${zoom * 100}%, the indent markers drag as Word's, in one undo step each`, async ({
    page,
  }) => {
    await open(page, zoom);
    const g = await geometry(page);
    if (!g?.paragraph) throw new Error("no geometry");
    // An inch to the right: the left indent and the first line move together.
    const left = await handle(page, "left");
    expect(Math.abs(left.x - g.paragraph.left)).toBeLessThan(1);
    await drag(page, left, left.x + 1440 * g.pxPerTwip);
    await expect.poll(() => indent(page)).toEqual({ left: 1440 });
    // The marker is under the pointer, the paragraph's text where the geometry says.
    const moved = await handle(page, "left");
    expect(Math.abs(moved.x - (left.x + 1440 * g.pxPerTwip))).toBeLessThan(1.5);
    const after = await geometry(page);
    expect(Math.abs((after?.paragraph?.left ?? 0) - moved.x)).toBeLessThan(1);
    // The hanging marker back half an inch: the first line stays.
    const hanging = await handle(page, "hanging");
    await drag(page, hanging, hanging.x - 720 * g.pxPerTwip);
    await expect.poll(() => indent(page)).toEqual({ left: 720, firstLine: 720 });
    // The first line a quarter inch in from there.
    const first = await handle(page, "first-line");
    await drag(page, first, first.x - 360 * g.pxPerTwip);
    await expect.poll(() => indent(page)).toEqual({ left: 720, firstLine: 360 });
    // Scrolled to the page's right edge (at 200% it is past the window's): the ruler follows.
    await page.evaluate(() => {
      const scroller = document.getElementById("body") as HTMLElement;
      scroller.scrollLeft = scroller.scrollWidth;
    });
    await settled(page);
    // The right indent about half an inch in: the grid runs from the left margin (Word's), and
    // an A4 page's text is not a whole number of sixteenths wide.
    const right = await handle(page, "right");
    await drag(page, right, right.x - 720 * g.pxPerTwip);
    await expect
      .poll(async () => Math.abs(((await indent(page))?.right ?? 0) - 720))
      .toBeLessThanOrEqual(45);
    // Each drag one undo step.
    await page.evaluate(() => window.foliEdit.editor.commands.undo());
    await expect.poll(() => indent(page)).toEqual({ left: 720, firstLine: 360 });
    await page.evaluate(() => window.foliEdit.editor.commands.undo());
    await page.evaluate(() => window.foliEdit.editor.commands.undo());
    await page.evaluate(() => window.foliEdit.editor.commands.undo());
    await expect.poll(() => indent(page)).toBeNull();
  });

  test(`at ${zoom * 100}%, a margin drags as Page setup sets it`, async ({ page }) => {
    await open(page, zoom);
    const g = await geometry(page);
    if (!g) throw new Error("no geometry");
    // Between the first-line and hanging markers (the ruler is not zoomed), where the margin's
    // edge is free to take.
    const margin = await handle(page, "margin-left");
    const first = await handle(page, "first-line");
    await drag(page, { x: margin.x, y: first.y + 6 }, margin.x + 720 * g.pxPerTwip);
    await expect
      .poll(() =>
        page.evaluate(() => window.foliEdit.editor.getDocument().section?.margins?.left ?? null),
      )
      .toBe(2160);
    const moved = await handle(page, "margin-left");
    expect(Math.abs(moved.x - (margin.x + 720 * g.pxPerTwip))).toBeLessThan(1.5);
  });
}

test("each handle is a slider the keyboard moves; Escape cancels a drag; axe", async ({ page }) => {
  await open(page, 1);
  const left = page.getByRole("slider", { name: "Left indent" });
  await expect(left).toHaveAttribute("aria-valuetext", '0"');
  await left.focus();
  await page.keyboard.press("ArrowRight");
  await expect(left).toHaveAttribute("aria-valuetext", '0.06"');
  await page.keyboard.press("PageUp");
  await expect.poll(() => indent(page)).toEqual({ left: 810 });
  // A drag cancelled with Escape changes nothing.
  const at = await handle(page, "left");
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 100, at.y, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => indent(page)).toEqual({ left: 810 });
  const results = await new AxeBuilder({ page }).include(".foli-ruler").analyze();
  expect(results.violations).toEqual([]);
});
