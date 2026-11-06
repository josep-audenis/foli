import { expect, type Page, test } from "@playwright/test";

const STORAGE_KEY = "foli-playground-document";
const MOD = "ControlOrMeta";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const pages = (page: Page) => editor(page).locator(":scope > .foli-page");
const texts = (page: Page) => editor(page).locator(":scope > .foli-page > *").allTextContents();

/** Each saved block as its plain text. Saving is debounced (300 ms): poll it. */
async function savedTexts(page: Page): Promise<string[] | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  if (!raw) return null;
  const blocks: { content?: { text?: string }[] }[] = JSON.parse(raw).content.content;
  return blocks.map((b) => (b.content ?? []).map((i) => i.text ?? "\n").join(""));
}

const line = (i: number) => `Paragraph ${i}: ${"lorem ipsum dolor sit amet ".repeat(i % 4)}`;

/** Opens the playground on a document of `count` paragraphs (mixed lengths) and a heading. */
async function openLong(page: Page, count: number): Promise<void> {
  await page.goto("/");
  const content = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Pages" }] },
      ...Array.from({ length: count }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: line(i) }],
      })),
    ],
  };
  await page.evaluate(([key, doc]) => localStorage.setItem(key, doc), [
    STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 1,
      settings: {
        pageSize: { width: 210, height: 297 },
        margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
      },
      content,
    }),
  ] as const);
  await page.reload();
  await expect(editor(page)).toContainText("Pages");
}

/** Focuses the editor with the caret at the end of the block whose text is `text`. */
async function caretAtEnd(page: Page, text: string): Promise<void> {
  await editor(page).getByText(text, { exact: true }).click();
  await page.evaluate((wanted) => {
    const block = [...document.querySelectorAll(".foli-page > *")].find(
      (b) => b.textContent === wanted,
    );
    const last = block?.lastChild;
    if (last) getSelection()?.collapse(last, last.textContent?.length ?? 0);
  }, text);
}

/** The playground's settings (A4, 25.4 mm margins) in CSS px. */
const PX_PER_MM = 96 / 25.4;
const PAGE_HEIGHT = 297 * PX_PER_MM;
const CONTENT_HEIGHT = (297 - 2 * 25.4) * PX_PER_MM;

interface PageLayout {
  blocks: { text: string; top: number; bottom: number; marginTop: number; marginBottom: number }[];
  height: number;
  /** Where the content box ends by the page settings, not by the (growable) element. */
  contentBottom: number;
}

/** Where every page's content box is and where its blocks sit, in viewport px. */
function layout(page: Page): Promise<PageLayout[]> {
  return page.evaluate(
    (contentHeight) =>
      [...document.querySelectorAll(".foli-content > .foli-page")].map((section) => {
        const rect = section.getBoundingClientRect();
        const style = getComputedStyle(section);
        return {
          height: rect.height,
          contentBottom: rect.top + Number.parseFloat(style.paddingTop) + contentHeight,
          blocks: [...section.children].map((block) => {
            const box = block.getBoundingClientRect();
            const blockStyle = getComputedStyle(block);
            return {
              text: block.textContent ?? "",
              top: box.top,
              bottom: box.bottom,
              marginTop: Number.parseFloat(blockStyle.marginTop),
              marginBottom: Number.parseFloat(blockStyle.marginBottom),
            };
          }),
        };
      }),
    CONTENT_HEIGHT,
  );
}

/**
 * The page-flow invariants: every page holds at least one block; no block ends below its
 * page's content box (unless it is alone there); and no page could have taken the first block
 * of the next one.
 */
function expectValidFlow(pagesLayout: PageLayout[]): void {
  pagesLayout.forEach((p, i) => {
    expect(p.blocks.length, `page ${i} is empty`).toBeGreaterThan(0);
    if (p.blocks.length > 1) {
      // Blocks, bottom margins included, stay inside the content box; the page keeps its size.
      for (const block of p.blocks)
        expect(
          block.bottom + block.marginBottom,
          `"${block.text}" overflows page ${i}`,
        ).toBeLessThanOrEqual(p.contentBottom + 0.5);
      expect(p.height, `page ${i} grew`).toBeCloseTo(PAGE_HEIGHT, 0);
    }
    const next = pagesLayout[i + 1]?.blocks[0];
    const last = p.blocks[p.blocks.length - 1];
    if (next && last) {
      // Same rule as the flow: a block fits if it ends at most half a pixel below the box.
      // The next block would need the gap, its height and its own bottom margin.
      const needed =
        Math.max(last.marginBottom, next.marginTop) + (next.bottom - next.top) + next.marginBottom;
      const free = p.contentBottom - last.bottom;
      expect(free + 0.5, `page ${i} could take "${next.text}"`).toBeLessThan(needed + 0.05);
    }
  });
}

test("a long document flows into A4 pages that respect the content box", async ({ page }) => {
  await openLong(page, 60);
  expect(await pages(page).count()).toBeGreaterThan(2);
  const first = await pages(page).first().boundingBox();
  expect(first?.width).toBeCloseTo((210 * 96) / 25.4, 0);
  expect(first?.height).toBeCloseTo((297 * 96) / 25.4, 0);
  expectValidFlow(await layout(page));
  // Pages hold the blocks in document order.
  expect(await texts(page)).toEqual(["Pages", ...Array.from({ length: 60 }, (_, i) => line(i))]);
});

test("typing that grows page 1 pushes blocks onto page 2, and undo pulls them back", async ({
  page,
}) => {
  await openLong(page, 60);
  const original = await texts(page);
  const before = await layout(page);
  const lastOnFirst = before[0]?.blocks.at(-1)?.text as string;
  await caretAtEnd(page, lastOnFirst);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("new");
  const after = await layout(page);
  expectValidFlow(after);
  // The new blocks follow the old last block; whatever does not fit starts page 2.
  expect(["", "new"]).toContain(after[1]?.blocks[0]?.text);
  expect(after[0]?.blocks.map((b) => b.text)).toContain(lastOnFirst);

  // The caret stays in the moved block: typing continues there.
  await page.keyboard.type("er");
  await expect.poll(async () => (await savedTexts(page))?.includes("newer")).toBe(true);
  for (let i = 0; i < 6; i++) await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => texts(page)).toEqual(original);
  expectValidFlow(await layout(page));
});

test("selection across pages: drag, delete, undo restores the document", async ({ page }) => {
  await openLong(page, 40);
  const original = await texts(page);
  const flow = await layout(page);
  const from = flow[0]?.blocks.at(-2)?.text as string;
  await editor(page).getByText(from, { exact: true }).click();
  await page.keyboard.press("Home");
  // Extend with Shift+ArrowDown across the page gap: native, then read back.
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowDown");
  const selected = await page.evaluate(() => String(getSelection()));
  expect(selected).toContain(from.slice(0, 10));
  expect(selected).toContain(flow[1]?.blocks[0]?.text.slice(0, 10));
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await texts(page)).length).toBeLessThan(original.length);
  expectValidFlow(await layout(page));
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => texts(page)).toEqual(original);
});

test("ArrowDown from the last line of page 1 lands on page 2; clicks place the caret", async ({
  page,
}) => {
  await openLong(page, 60);
  const flow = await layout(page);
  const last = flow[0]?.blocks.at(-1)?.text as string;
  const next = flow[1]?.blocks[0]?.text as string;
  await caretAtEnd(page, last);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.type("X");
  await expect.poll(async () => (await savedTexts(page))?.includes(`X${next}`)).toBe(true);

  // A click on page 3 puts the caret there.
  const third = flow[2]?.blocks[0]?.text as string;
  const target = editor(page).getByText(third, { exact: true });
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("no block box");
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
  await page.keyboard.press("Home");
  await page.keyboard.type("Y");
  await expect.poll(async () => (await savedTexts(page))?.includes(`Y${third}`)).toBe(true);
});

test("deleting everything leaves one page", async ({ page }) => {
  await openLong(page, 40);
  await editor(page).click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Backspace");
  await expect(pages(page)).toHaveCount(1);
  await expect.poll(() => texts(page)).toEqual([""]);
});

test("a scaled ancestor (transform) does not change where pages break", async ({ page }) => {
  await openLong(page, 60);
  const perPage = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".foli-content > .foli-page")].map((p) => p.children.length),
    );
  const before = await perPage();
  // Client rects shrink by 0.8; layout (and so wrapping) is unchanged.
  await page.addStyleTag({ content: ".foli-canvas { transform: scale(0.8); }" });
  await editor(page).getByText("Pages", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!"); // a render measures again
  await expect.poll(perPage).toEqual(before);
});
