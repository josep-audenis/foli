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
    // The document kept the focus.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("editor");
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
  // With a tab stop on it too.
  const strip = await page
    .locator(".foli-ruler:not(.foli-ruler-vertical) > .foli-ruler-page")
    .boundingBox();
  const g = await geometry(page);
  if (!strip || !g) throw new Error("no ruler");
  await page.mouse.click(g.text.left + 2880 * g.pxPerTwip, strip.y + strip.height - 3);
  await expect(page.getByRole("slider", { name: "Left tab" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".foli-ruler:not(.foli-ruler-vertical)")
    .analyze();
  expect(results.violations).toEqual([]);
});

const tabs = (page: Page) =>
  page.evaluate(() => window.foliEdit.editor.state.selection.$head.parent.attrs.tabs);

for (const zoom of [1, 2]) {
  test(`at ${zoom * 100}%, a click adds a tab stop, a drag moves it, off the ruler removes it`, async ({
    page,
  }) => {
    await open(page, zoom);
    const g = await geometry(page);
    if (!g?.paragraph) throw new Error("no geometry");
    const strip = await page
      .locator(".foli-ruler:not(.foli-ruler-vertical) > .foli-ruler-page")
      .boundingBox();
    if (!strip) throw new Error("no ruler");
    // A center stop an inch from the left margin.
    await page.getByRole("button", { name: "Tab stop to add: Left tab" }).click();
    await page.mouse.click(g.text.left + 1440 * g.pxPerTwip, strip.y + strip.height - 3);
    await expect.poll(() => tabs(page)).toEqual([{ position: 1440, kind: "center" }]);
    // Dragged half an inch right: one undo step.
    const stop = await handle(page, "tab-0");
    expect(Math.abs(stop.x - (g.text.left + 1440 * g.pxPerTwip))).toBeLessThan(1.5);
    await drag(page, stop, stop.x + 720 * g.pxPerTwip);
    await expect.poll(() => tabs(page)).toEqual([{ position: 2160, kind: "center" }]);
    const moved = await handle(page, "tab-0");
    expect(Math.abs(moved.x - (stop.x + 720 * g.pxPerTwip))).toBeLessThan(1.5);
    await page.evaluate(() => window.foliEdit.editor.commands.undo());
    await expect.poll(() => tabs(page)).toEqual([{ position: 1440, kind: "center" }]);
    // Dragged down off the ruler: gone.
    const back = await handle(page, "tab-0");
    await page.mouse.move(back.x, back.y);
    await page.mouse.down();
    await page.mouse.move(back.x, back.y + 80, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => tabs(page)).toBeNull();
  });
}

test("a tab stop's double-click opens the Tabs dialog", async ({ page }) => {
  await open(page, 1);
  const g = await geometry(page);
  const strip = await page
    .locator(".foli-ruler:not(.foli-ruler-vertical) > .foli-ruler-page")
    .boundingBox();
  if (!g || !strip) throw new Error("no ruler");
  await page.mouse.click(g.text.left + 1440 * g.pxPerTwip, strip.y + strip.height - 3);
  await expect.poll(() => tabs(page)).toEqual([{ position: 1440, kind: "left" }]);
  await page.locator('[data-foli-ruler="tab-0"]').dblclick();
  await expect(page.locator(".foli-tabs-dialog")).toBeVisible();
});

for (const zoom of [1, 2]) {
  test(`at ${zoom * 100}%, a table column's border drags on the ruler, in one undo step`, async ({
    page,
  }) => {
    await open(page, zoom);
    // A 2 by 3 table at the caret, the caret in its first cell.
    await page.evaluate(() => {
      const { editor, commands } = window.foliEdit;
      editor.run(commands.insertTable(2, 3));
    });
    const grid = () =>
      page.evaluate(() => {
        let found: number[] | null = null;
        window.foliEdit.editor.state.doc.forEach((node) => {
          if (!found && node.type.name === "table") found = node.attrs.grid as number[];
        });
        return found;
      });
    const before = (await grid()) as number[] | null;
    if (!before) throw new Error("no table");
    await expect(page.getByRole("slider", { name: "Column 1 border" })).toBeVisible();
    await settled(page);
    const g = await geometry(page);
    const first = g?.table?.columns[0];
    if (!g || !first) throw new Error("no columns");
    // Grabbed at its top: the cell's right indent marker is over its lower half.
    const border = {
      ...(await handle(page, "column-0")),
      y: (await handle(page, "column-0")).y - 6,
    };
    expect(Math.abs(border.x - first.right)).toBeLessThan(1);
    // Half an inch right.
    await drag(page, border, border.x + 720 * g.pxPerTwip);
    await expect.poll(async () => ((await grid()) as number[])[0]).not.toBe(before[0]);
    const after = (await grid()) as number[];
    // The next column gave it: the table keeps its width.
    expect(after[0]! + after[1]!).toBe(before[0]! + before[1]!);
    // Snapped to the ruler's grid: within a sixteenth of where it was let go.
    expect(Math.abs((after[0] ?? 0) - ((before[0] ?? 0) + 720))).toBeLessThanOrEqual(45);
    const moved = await handle(page, "column-0");
    expect(Math.abs(moved.x - (border.x + (after[0]! - before[0]!) * g.pxPerTwip))).toBeLessThan(
      1.5,
    );
    await page.evaluate(() => window.foliEdit.editor.commands.undo());
    await expect.poll(grid).toEqual(before);
  });
}

for (const zoom of [1, 2]) {
  test(`at ${zoom * 100}%, the vertical ruler drags the caret's page's top margin`, async ({
    page,
  }) => {
    await open(page, zoom);
    const g = await geometry(page);
    if (!g) throw new Error("no geometry");
    const ruler = page.getByRole("group", { name: "Vertical ruler" });
    await expect(ruler).toBeVisible();
    const box = await page
      .locator('.foli-ruler-vertical [data-foli-ruler="margin-top"]')
      .boundingBox();
    if (!box) throw new Error("no top margin");
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(Math.abs(at.y - g.margins.top)).toBeLessThan(1);
    // Half an inch down.
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y + 720 * g.pxPerTwip, { steps: 6 });
    await page.mouse.up();
    const top = () =>
      page.evaluate(() => window.foliEdit.editor.getDocument().section?.margins?.top ?? null);
    await expect.poll(top).toBe(2160);
    const moved = await page
      .locator('.foli-ruler-vertical [data-foli-ruler="margin-top"]')
      .boundingBox();
    expect(
      Math.abs((moved?.y ?? 0) + (moved?.height ?? 0) / 2 - (at.y + 720 * g.pxPerTwip)),
    ).toBeLessThan(1.5);
    await page.evaluate(() => window.foliEdit.editor.commands.undo());
    await expect.poll(top).toBe(1440);
    const results = await new AxeBuilder({ page }).include(".foli-ruler-vertical").analyze();
    expect(results.violations).toEqual([]);
  });
}

test("the View tab's Ruler shows and hides both rulers", async ({ page }) => {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await expect(page.getByRole("group", { name: /ruler$/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "View", exact: true }).click();
  const button = page.getByRole("button", { name: "Ruler", exact: true });
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(page.getByRole("group", { name: "Horizontal ruler" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Vertical ruler" })).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect(page.getByRole("group", { name: /ruler$/ })).toHaveCount(0);
});
