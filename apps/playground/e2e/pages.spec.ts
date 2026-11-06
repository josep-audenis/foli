import { expect, type Page, test } from "@playwright/test";

const STORAGE_KEY = "foli-playground-document";
const MOD = "ControlOrMeta";

const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const pages = (page: Page) => editor(page).locator(":scope > .foli-page");
/** Each block's text, its fragments on several pages joined. */
const texts = (page: Page) =>
  editor(page).evaluate((host) => {
    const result: string[] = [];
    for (const el of host.querySelectorAll(":scope > .foli-page > *")) {
      if (Number(el.getAttribute("data-fragment")) > 0) result[result.length - 1] += el.textContent;
      else result.push(el.textContent ?? "");
    }
    return result;
  });

/** Each saved block as its plain text. Saving is debounced (300 ms): poll it. */
async function savedTexts(page: Page): Promise<string[] | null> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  if (!raw) return null;
  const blocks: { content?: { text?: string }[] }[] = JSON.parse(raw).content.content;
  return blocks.map((b) => (b.content ?? []).map((i) => i.text ?? "\n").join(""));
}

/** Paragraphs of one to four lines. */
const line = (i: number) => `Paragraph ${i}: ${"lorem ipsum dolor sit amet ".repeat(i % 4)}`;
/** One-line paragraphs: never split, so each is one element. */
const short = (i: number) => `Paragraph ${i}`;

/** Opens the playground on a heading and `count` paragraphs (mixed lengths by default). */
async function openLong(page: Page, count: number, text = line): Promise<void> {
  await openDoc(page, [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Pages" }] },
    ...Array.from({ length: count }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: text(i) }],
    })),
  ]);
}

/** Opens the playground on the given blocks (A4, 25.4 mm margins). */
async function openDoc(page: Page, blocks: unknown[]): Promise<void> {
  await page.goto("/");
  const content = { type: "doc", content: blocks };
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
  await expect(editor(page).locator(".foli-page").first()).toBeVisible();
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
  /** The page's elements: whole blocks, or fragments of a split one (`fragment` >= 0). */
  blocks: {
    text: string;
    fragment: number;
    heading: boolean;
    /** Holds an explicit page break. */
    pageBreak: boolean;
    top: number;
    bottom: number;
    marginTop: number;
    marginBottom: number;
    lineHeight: number;
  }[];
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
              fragment: Number(block.getAttribute("data-fragment") ?? -1),
              heading: /^H[1-6]$/.test(block.tagName),
              pageBreak: block.querySelector("br[data-page-break]") !== null,
              lineHeight: Number.parseFloat(blockStyle.lineHeight),
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
 * The page-flow invariants: every page holds at least one element and keeps its A4 height;
 * nothing ends below the content box; and no page could have taken more of the next page,
 * given the rules: a page that ends with a page break or before a heading (kept with its next
 * block) may end early; otherwise the next element's first lines would have had to fit (one
 * line of a continuation that keeps two, two lines of a block that can leave two, else the
 * whole block with its bottom margin).
 */
function expectValidFlow(pagesLayout: PageLayout[]): void {
  pagesLayout.forEach((p, i) => {
    expect(p.blocks.length, `page ${i} is empty`).toBeGreaterThan(0);
    for (const block of p.blocks)
      expect(
        block.bottom + block.marginBottom,
        `"${block.text.slice(0, 30)}" overflows page ${i}`,
      ).toBeLessThanOrEqual(p.contentBottom + 0.5);
    expect(p.height, `page ${i} grew`).toBeCloseTo(PAGE_HEIGHT, 0);
    const next = pagesLayout[i + 1]?.blocks[0];
    const last = p.blocks[p.blocks.length - 1];
    if (!next || !last || last.pageBreak) return;
    const lines = Math.round((next.bottom - next.top) / next.lineHeight);
    /** What a page needs to take the start of `block` after `above` (with the rules). */
    const start = (above: PageLayout["blocks"][number], block: PageLayout["blocks"][number]) => {
      const count = Math.round((block.bottom - block.top) / block.lineHeight);
      const gap = Math.max(above.marginBottom, block.marginTop);
      // A split first fragment could have given up to its last two lines; else whole, or two.
      if (block.fragment === 0) return gap + Math.min(count, 2) * block.lineHeight;
      return count >= 4
        ? gap + 2 * block.lineHeight
        : gap + count * block.lineHeight + block.marginBottom;
    };
    let needed: number;
    if (next.heading) {
      // Kept with its next block: the heading and the start of that block would have to fit.
      const after = pagesLayout[i + 1]?.blocks[1];
      if (!after) return;
      needed =
        Math.max(last.marginBottom, next.marginTop) + (next.bottom - next.top) + start(next, after);
    } else if (next.fragment > 0) {
      if (lines <= 2) return; // moving a line back would leave a widow
      needed = next.lineHeight;
    } else {
      needed = start(last, next);
    }
    const free = p.contentBottom - last.bottom;
    // Same rule as the flow: a line fits if it ends at most half a pixel below the box.
    expect(free + 0.5, `page ${i} could take more of "${next.text.slice(0, 30)}"`).toBeLessThan(
      needed + 0.05,
    );
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
  await openLong(page, 120, short);
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
  await openLong(page, 80, short);
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
  await openLong(page, 120, short);
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

// ---------- a paragraph split across pages (T5) ----------

const words = (n: number) =>
  Array.from({ length: n }, (_, i) => ["alpha", "beta", "gamma", "delta"][i % 4]).join(" ");
const LONG = `Long ${words(500)}.`;

/** A heading, short paragraphs, then one long paragraph that crosses the end of page 1. */
async function openSplit(page: Page): Promise<void> {
  await openDoc(page, [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Split" }] },
    ...Array.from({ length: 12 }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: short(i) }],
    })),
    { type: "paragraph", content: [{ type: "text", text: LONG }] },
    { type: "paragraph", content: [{ type: "text", text: "After" }] },
  ]);
}

/** The long paragraph's fragments: page index and text of each. */
const fragmentsOf = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".foli-page > [data-fragment]")].map((el) => ({
      page: [...document.querySelectorAll(".foli-page")].indexOf(el.parentElement as Element),
      index: Number(el.getAttribute("data-fragment")),
      text: el.textContent ?? "",
    })),
  );

/** The saved text of the long paragraph (the one that starts with "Long"). */
async function savedLong(page: Page): Promise<string | undefined> {
  return (await savedTexts(page))?.find((t) => t.startsWith("Long"));
}

/** Focuses the editor with the caret `offset` characters into fragment `index`. */
async function caretInFragment(page: Page, index: number, offset: number): Promise<void> {
  await editor(page).locator(`[data-fragment="${index}"]`).click();
  await page.evaluate(
    ([i, at]) => {
      const fragment = document.querySelector(`[data-fragment="${i}"]`) as Element;
      const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
      let left = at;
      for (
        let node = walker.nextNode() as Text | null;
        node;
        node = walker.nextNode() as Text | null
      ) {
        if (left <= node.length) {
          getSelection()?.collapse(node, left);
          return;
        }
        left -= node.length;
      }
    },
    [index, offset] as const,
  );
}

test("a paragraph that crosses the page end is split at a line onto both pages", async ({
  page,
}) => {
  await openSplit(page);
  const parts = await fragmentsOf(page);
  expect(parts.length).toBeGreaterThanOrEqual(2);
  expect(parts.map((p) => p.index)).toEqual(parts.map((_, i) => i));
  expect(parts.map((p) => p.page)).toEqual(parts.map((_, i) => (parts[0]?.page ?? 0) + i));
  expect(parts.map((p) => p.text).join("")).toBe(LONG);
  // Split at a line start: the first fragment ends at a word boundary (pre-wrap keeps the space).
  expect(parts[0]?.text.endsWith(" ")).toBe(true);
  expectValidFlow(await layout(page));
  expect(await texts(page)).toContain(LONG);

  // The same split after a reload: measuring the fragments gives the lines of the whole block.
  await page.reload();
  await expect.poll(() => fragmentsOf(page)).toEqual(parts);
});

test("typing at the end of page 1 inside a split paragraph keeps text and caret", async ({
  page,
}) => {
  await openSplit(page);
  const split = ((await fragmentsOf(page))[0]?.text ?? "").length;
  await caretInFragment(page, 0, split);
  await page.keyboard.type("XYZ");
  await page.keyboard.type("W");
  await expect.poll(() => savedLong(page)).toBe(`${LONG.slice(0, split)}XYZW${LONG.slice(split)}`);
  expectValidFlow(await layout(page));
  expect((await fragmentsOf(page)).map((p) => p.text).join("")).toBe(
    `${LONG.slice(0, split)}XYZW${LONG.slice(split)}`,
  );
});

test("ArrowRight and ArrowLeft cross the page break one character per press", async ({ page }) => {
  await openSplit(page);
  const split = ((await fragmentsOf(page))[0]?.text ?? "").length;
  await caretInFragment(page, 0, split - 1);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("#");
  await expect
    .poll(() => savedLong(page))
    .toBe(`${LONG.slice(0, split + 1)}#${LONG.slice(split + 1)}`);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => savedLong(page)).toBe(LONG);

  await caretInFragment(page, 1, 1);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("%");
  await expect
    .poll(() => savedLong(page))
    .toBe(`${LONG.slice(0, split - 1)}%${LONG.slice(split - 1)}`);
});

test("Backspace and Delete at the page break remove one character", async ({ page }) => {
  await openSplit(page);
  const split = ((await fragmentsOf(page))[0]?.text ?? "").length;
  await caretInFragment(page, 1, 0);
  await page.keyboard.press("Backspace");
  await expect.poll(() => savedLong(page)).toBe(`${LONG.slice(0, split - 1)}${LONG.slice(split)}`);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => savedLong(page)).toBe(LONG);

  const again = ((await fragmentsOf(page))[0]?.text ?? "").length;
  await caretInFragment(page, 0, again);
  await page.keyboard.press("Delete");
  await expect.poll(() => savedLong(page)).toBe(`${LONG.slice(0, again)}${LONG.slice(again + 1)}`);
});

test("select across the page break, replace, undo: exact text and selection back", async ({
  page,
}) => {
  await openSplit(page);
  const split = ((await fragmentsOf(page))[0]?.text ?? "").length;
  await caretInFragment(page, 0, split - 3);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
  // Browsers serialize the break between fragments as a newline (Firefox adds spaces too).
  const selected = () => page.evaluate(() => String(getSelection()).replace(/\s+/g, " "));
  expect(await selected()).toBe(LONG.slice(split - 3, split + 3));
  await page.keyboard.type("Q");
  await expect
    .poll(() => savedLong(page))
    .toBe(`${LONG.slice(0, split - 3)}Q${LONG.slice(split + 3)}`);
  expectValidFlow(await layout(page));
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => savedLong(page)).toBe(LONG);
  await expect.poll(selected).toBe(LONG.slice(split - 3, split + 3));
  // The model selection is back too: typing replaces exactly those characters again.
  await page.keyboard.type("Q");
  await expect
    .poll(() => savedLong(page))
    .toBe(`${LONG.slice(0, split - 3)}Q${LONG.slice(split + 3)}`);
});

test("a mouse drag across the page break selects into page 2; delete and undo", async ({
  page,
}) => {
  await openSplit(page);
  const original = await texts(page);
  const first = editor(page).locator('[data-fragment="0"]');
  const second = editor(page).locator('[data-fragment="1"]');
  await first.scrollIntoViewIfNeeded();
  const from = await first.boundingBox();
  if (!from) throw new Error("no fragment box");
  await page.mouse.move(from.x + 40, from.y + from.height - 8);
  await page.mouse.down();
  await second.scrollIntoViewIfNeeded();
  const to = await second.boundingBox();
  if (!to) throw new Error("no fragment box");
  await page.mouse.move(to.x + 60, to.y + 8, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press("Backspace");
  await expect
    .poll(async () => (await texts(page)).join("").length)
    .toBeLessThan(original.join("").length);
  expectValidFlow(await layout(page));
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => texts(page)).toEqual(original);
});

test("at a break after a hard break, ArrowLeft and Shift+ArrowLeft move one character", async ({
  page,
}) => {
  // Short lines joined by hard breaks: every line start, so every split, follows a <br>.
  const lines = Array.from({ length: 80 }, (_, i) => `line${i}`);
  await openDoc(page, [
    {
      type: "paragraph",
      content: lines.flatMap((text, i) => [
        ...(i ? [{ type: "hardBreak" }] : []),
        { type: "text", text },
      ]),
    },
  ]);
  const first = (await fragmentsOf(page))[0]?.text ?? "";
  const onFirst = first.match(/line\d+/g)?.length ?? 0;
  expect(onFirst).toBeGreaterThan(1);
  const before = lines.slice(0, onFirst).join("\n");
  const after = lines.slice(onFirst).join("\n");
  const saved = async () => (await savedTexts(page))?.[0];

  await caretInFragment(page, 1, 0);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("#");
  await expect.poll(saved).toBe(`${before}#\n${after}`);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(saved).toBe(`${before}\n${after}`);

  await caretInFragment(page, 1, 0);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.type("Q");
  await expect.poll(saved).toBe(`${before}Q${after}`);
});

test("a line height smaller than the font's glyph boxes still splits inside the page", async ({
  page,
}) => {
  await openSplit(page);
  await page.addStyleTag({ content: ".foli-page p { line-height: 1; }" });
  await editor(page).getByText("Split", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!"); // a render measures again
  await expect.poll(async () => (await texts(page))[0]).toBe("Split!");
  expectValidFlow(await layout(page));
});

test("an IME composition just before the break, then typing: exact text", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP IME emulation is Chromium-only");
  await openSplit(page);
  const split = ((await fragmentsOf(page))[0]?.text ?? "").length;
  await caretInFragment(page, 0, split - 3);
  const cdp = await page.context().newCDPSession(page);
  // Long enough to push text over the break while composing (no reflow until it ends).
  let composed = "";
  for (let i = 0; i < 40; i++) {
    composed += "か";
    await cdp.send("Input.imeSetComposition", {
      text: composed,
      selectionStart: composed.length,
      selectionEnd: composed.length,
    });
  }
  await cdp.send("Input.insertText", { text: composed });
  const expected = `${LONG.slice(0, split - 3)}${composed}${LONG.slice(split - 3)}`;
  await expect.poll(() => savedLong(page)).toBe(expected);
  expectValidFlow(await layout(page));
  await page.keyboard.type("Q");
  await expect
    .poll(() => savedLong(page))
    .toBe(`${LONG.slice(0, split - 3)}${composed}Q${LONG.slice(split - 3)}`);
});

// ---------- rules (5.3) ----------

/** Each page's elements, as `tag:text` (fragments marked with their index). */
const pageContents = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".foli-page")].map((section) =>
      [...section.children].map(
        (el) =>
          `${el.tagName.toLowerCase()}${el.getAttribute("data-fragment") ? `#${el.getAttribute("data-fragment")}` : ""}:${el.textContent}`,
      ),
    ),
  );

test("Mod+Enter inserts a page break: the rest starts the next page; undo, redo, Backspace", async ({
  page,
}) => {
  await openDoc(page, [
    { type: "paragraph", content: [{ type: "text", text: "before break after" }] },
    { type: "paragraph", content: [{ type: "text", text: "next" }] },
  ]);
  const broken = [["p#0:before break"], ["p#1: after", "p:next"]];
  const whole = [["p:before break after", "p:next"]];
  await editor(page).getByText("before break after").click();
  await page.keyboard.press("Home");
  for (let i = 0; i < "before break".length; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press(`${MOD}+Enter`);
  await expect.poll(() => pageContents(page)).toEqual(broken);
  const savedBreak = async () =>
    JSON.parse((await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)) ?? "{}")
      .content?.content?.[0]?.content?.[1];
  await expect.poll(savedBreak).toEqual({ type: "pageBreak" });
  expectValidFlow(await layout(page));
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => pageContents(page)).toEqual(whole);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => pageContents(page)).toEqual(broken);

  // The caret is after the break, on page 2: typing goes there; Backspace removes the break.
  await page.keyboard.type("X");
  await expect
    .poll(() => pageContents(page))
    .toEqual([["p#0:before break"], ["p#1:X after", "p:next"]]);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect.poll(() => pageContents(page)).toEqual(whole);
});

test("a page break at the end of a paragraph starts the next block on a new page", async ({
  page,
}) => {
  await openDoc(page, [
    { type: "paragraph", content: [{ type: "text", text: "one" }] },
    { type: "paragraph", content: [{ type: "text", text: "two" }] },
  ]);
  await caretAtEnd(page, "one");
  await page.keyboard.press(`${MOD}+Enter`);
  // The break's line ends page 1; the paragraph's empty last line and "two" are on page 2.
  await expect.poll(() => pageContents(page)).toEqual([["p#0:one"], ["p#1:", "p:two"]]);
  expectValidFlow(await layout(page));
});

test("a heading never ends a page: it moves to the next page with its paragraph", async ({
  page,
}) => {
  let moved = 0;
  // Slide a heading over the end of page 1 by adding short paragraphs before it.
  for (let count = 14; count <= 30; count++) {
    await openDoc(page, [
      ...Array.from({ length: count }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: short(i) }],
      })),
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading" }] },
      { type: "paragraph", content: [{ type: "text", text: "Body" }] },
    ]);
    const flow = await layout(page);
    const where = (text: string) => flow.findIndex((p) => p.blocks.some((b) => b.text === text));
    expect(where("Heading"), `count ${count}`).toBe(where("Body"));
    expectValidFlow(flow);
    // The rule did something when the heading starts a page that is not the first.
    if (where("Heading") > 0 && flow[where("Heading")]?.blocks[0]?.text === "Heading") moved++;
  }
  expect(moved).toBeGreaterThan(0);
});

test("a split paragraph leaves at least two lines on each page", async ({ page }) => {
  test.slow(); // many reloads
  let split = 0;
  // A three-to-four-line paragraph slid over the end of page 1 line by line: without the
  // rules some positions leave one line on a page.
  const middle = `Middle ${words(45)}.`;
  for (let count = 0; count <= 30; count++) {
    await openDoc(page, [
      ...Array.from({ length: count }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: short(i) }],
      })),
      { type: "paragraph", content: [{ type: "text", text: middle }] },
      { type: "paragraph", content: [{ type: "text", text: LONG }] },
    ]);
    const flow = await layout(page);
    expectValidFlow(flow);
    for (const p of flow)
      for (const block of p.blocks)
        if (block.fragment >= 0) {
          split++;
          expect(
            Math.round((block.bottom - block.top) / block.lineHeight),
            `count ${count}: "${block.text.slice(0, 20)}"`,
          ).toBeGreaterThanOrEqual(2);
        }
  }
  expect(split).toBeGreaterThan(0);
});

// ---------- incremental reflow (5.4) ----------

test("split blocks are left alone while nothing changes (no re-flow every frame)", async ({
  page,
}) => {
  // One paragraph of 80 hard-broken lines over two pages: its fragments add up to its height
  // only within a pixel per split, and the zoom scale must be exact (a rounded one is 0.05% off,
  // about a pixel here) or each frame would find it resized and render it again.
  await openDoc(page, [
    {
      type: "paragraph",
      content: Array.from({ length: 80 }, (_, i) => [
        ...(i ? [{ type: "hardBreak" }] : []),
        { type: "text", text: `line${i}` },
      ]).flat(),
    },
  ]);
  await expect.poll(async () => (await fragmentsOf(page)).length).toBe(2);
  await page.waitForTimeout(300);
  const mutations = await editor(page).evaluate(
    (host) =>
      new Promise<number>((resolve) => {
        let count = 0;
        const observer = new MutationObserver((records) => {
          count += records.length;
        });
        observer.observe(host, { childList: true, subtree: true, characterData: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 500);
      }),
  );
  expect(mutations).toBe(0);
});

test("a CSS change that resizes blocks re-flows the pages without an edit", async ({ page }) => {
  await openLong(page, 60);
  const before = await pages(page).count();
  // Measurements are cached by node; the ResizeObserver notices the blocks grew.
  await page.addStyleTag({ content: ".foli-page p { font-size: 20px; }" });
  await expect.poll(() => pages(page).count()).toBeGreaterThan(before);
  expectValidFlow(await layout(page));
  expect(await texts(page)).toEqual(["Pages", ...Array.from({ length: 60 }, (_, i) => line(i))]);
});

test("typing on page 1 of a long document keeps every page valid", async ({ page }) => {
  await openLong(page, 200);
  await editor(page).getByText("Pages", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A new first paragraph that pushes every later block down.");
  expectValidFlow(await layout(page));
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
  expectValidFlow(await layout(page));
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await texts(page)).length).toBeLessThan(205);
  expectValidFlow(await layout(page));
});
