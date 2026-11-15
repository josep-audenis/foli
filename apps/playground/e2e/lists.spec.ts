import { expect, type Page, test } from "@playwright/test";
import { FIXTURES, openFixture } from "./fixtures.js";

/**
 * Lists on pages, in Word's model (8.7d1): a 0.2.0 document's nested lists migrate to numbered
 * paragraphs (Word's numbering), which number on across pages; list editing with the keys.
 */

const STORAGE_KEY = "foli-playground-document";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const PX_PER_MM = 96 / 25.4;
const CONTENT_HEIGHT = (297 - 2 * 25.4) * PX_PER_MM;

const text = (t: string) => ({ type: "text", text: t });
const p = (t: string) => ({ type: "paragraph", content: [text(t)] });
const item = (...content: unknown[]) => ({ type: "listItem", content });
/** Items of one or two lines. */
const itemText = (i: number) => `Item ${i + 1}: ${"lorem ipsum dolor sit amet ".repeat(i % 3)}`;

/** A long ordered list starting at 5 (one item holds a nested bulleted list), then a rule. */
const longList = [
  p("Before the list"),
  {
    type: "orderedList",
    attrs: { start: 5 },
    content: Array.from({ length: 70 }, (_, i) =>
      i === 3
        ? item(p(itemText(i)), {
            type: "bulletList",
            content: [item(p("nested one")), item(p("nested two"))],
          })
        : item(p(itemText(i))),
    ),
  },
  { type: "horizontalRule" },
  {
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "a link",
        marks: [{ type: "link", attrs: { href: "https://example.test/" } }],
      },
    ],
  },
];

async function openDoc(page: Page, blocks: unknown[]): Promise<void> {
  await page.goto("/");
  await page.evaluate(([key, doc]) => localStorage.setItem(key, doc), [
    STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 2,
      settings: {
        pageSize: { width: 210, height: 297 },
        margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
      },
      content: { type: "doc", content: blocks },
    }),
  ] as const);
  await page.reload();
  await expect(editor(page).locator(".foli-page").first()).toBeVisible();
}

/**
 * Per page: its blocks (text without the list number, bottom), its numbered paragraphs (the
 * number shown and the text), and its content box bottom, in viewport px.
 */
function pageBlocks(page: Page) {
  return page.evaluate((contentHeight) => {
    /** A block's text without what is shown but not text (its list number). */
    const own = (el: Element) => {
      const copy = el.cloneNode(true) as Element;
      for (const shown of copy.querySelectorAll("[contenteditable=false]")) shown.remove();
      return copy.textContent ?? "";
    };
    return [...document.querySelectorAll(".foli-content > .foli-page")].map((section) => {
      const rect = section.getBoundingClientRect();
      const top = rect.top + Number.parseFloat(getComputedStyle(section).paddingTop);
      const blocks = [...section.children];
      return {
        contentBottom: top + contentHeight,
        top,
        blocks: blocks.map((el) => ({
          text: own(el),
          bottom: el.getBoundingClientRect().bottom,
          marginBottom: Number.parseFloat(getComputedStyle(el).marginBottom),
        })),
        items: blocks.flatMap((el) => {
          const marker = el.querySelector(":scope > [contenteditable=false]");
          return marker ? [{ marker: (marker.textContent ?? "").trim(), text: own(el) }] : [];
        }),
      };
    });
  }, CONTENT_HEIGHT);
}

/** Each saved paragraph as `level:text` (level "-" when not numbered). Saving is debounced. */
async function levels(page: Page): Promise<string[]> {
  const raw = await page.evaluate((key) => localStorage.getItem(key) ?? "", STORAGE_KEY);
  if (!raw) return [];
  const blocks: {
    attrs?: { numbering?: { id?: number; level?: number } | null };
    content?: { text?: string }[];
  }[] = JSON.parse(raw).content.content;
  return blocks.map((b) => {
    const n = b.attrs?.numbering;
    const text = (b.content ?? []).map((i) => i.text ?? "").join("");
    return `${n?.id ? (n.level ?? 0) : "-"}:${text}`;
  });
}

test("a list across pages: numbering goes on from page to page, nothing overflows", async ({
  page,
}) => {
  await openDoc(page, longList);
  const pages = await pageBlocks(page);
  expect(pages.length).toBeGreaterThan(1);
  for (const [i, p] of pages.entries()) {
    for (const block of p.blocks) {
      expect(
        block.bottom + block.marginBottom,
        `"${block.text.slice(0, 20)}" overflows page ${i}`,
      ).toBeLessThanOrEqual(p.contentBottom + 0.5);
    }
  }
  // Numbers follow the items across pages: item k (from 0) shows start + k.
  const items = pages.flatMap((p) => p.items);
  const numbered = items.filter((it) => it.text.startsWith("Item "));
  expect(numbered).toHaveLength(70);
  for (const it of numbered) {
    const k = Number(/^Item (\d+)/.exec(it.text)?.[1]) - 1;
    expect(it.marker, it.text.slice(0, 12)).toBe(`${5 + k}.`);
  }
  // The second page starts inside the list.
  expect(pages[1]?.items[0]?.text).toBe(pages[1]?.blocks[0]?.text);
  // The nested list is a list of its own one level down: bullets.
  expect(items.filter((it) => it.text.startsWith("nested")).map((it) => it.marker)).toEqual([
    "\u25e6",
    "\u25e6",
  ]);
});

test("typing in a list item on the second page edits that item", async ({ page }) => {
  await openDoc(page, longList);
  const second = (await pageBlocks(page))[1];
  const before = second?.items[0]?.text ?? "";
  expect(before).toMatch(/^Item /);
  await editor(page).locator(".foli-page").nth(1).getByText(before).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect.poll(async () => (await pageBlocks(page))[1]?.items[0]?.text).toBe(`${before}!`);
  // Saved: the same item holds the new text.
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key) ?? "", STORAGE_KEY))
    .toContain(`${before}!`);
});

test("a click on a link does not navigate", async ({ page }) => {
  await openDoc(page, longList);
  const link = editor(page).getByRole("link", { name: "a link" });
  await link.scrollIntoViewIfNeeded();
  const url = page.url();
  await link.click();
  expect(page.url()).toBe(url);
});

test("an item split across pages shows its number once; a split justified paragraph stays justified", async ({
  page,
}) => {
  const fixture = FIXTURES.find((f) => f.name === "lists");
  if (!fixture) throw new Error("no lists fixture");
  await openFixture(page, fixture);
  const styles = await page.evaluate(() => {
    const fragments = [...document.querySelectorAll(".foli-page > p[data-fragment]")];
    const marker = (p: Element) => p.querySelector(":scope > [contenteditable=false]") !== null;
    const numbered = fragments.filter((p) => p.getAttribute("data-fragment") === "0" && marker(p));
    const justified = fragments.filter((p) => getComputedStyle(p).textAlign === "justify");
    return {
      // Whether each continued fragment (on a later page) shows a number.
      continued: fragments.filter((p) => p.getAttribute("data-fragment") !== "0").map(marker),
      started: numbered.length,
      alignLast: justified.map((p) => getComputedStyle(p).textAlignLast),
    };
  });
  expect(styles.started).toBeGreaterThan(0);
  expect(styles.continued.length).toBeGreaterThan(0);
  expect(styles.continued.every((shown) => !shown)).toBe(true);
  expect(styles.alignLast.length).toBeGreaterThanOrEqual(2); // the paragraph is split
  // Every fragment but the last justifies its last line.
  expect(styles.alignLast.slice(0, -1).every((value) => value === "justify")).toBe(true);
  expect(styles.alignLast.at(-1)).not.toBe("justify");
});

test("list editing with the keyboard, as in Word, then undo back to the start", async ({
  page,
}) => {
  await openDoc(page, [p("start")]);
  await editor(page).getByText("start").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+Shift+Digit8");
  await expect.poll(() => levels(page)).toEqual(["0:start"]);
  // Tab at the start of a list paragraph goes a level deeper.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("two");
  await expect.poll(() => levels(page)).toEqual(["0:start", "1:two"]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("three");
  await expect.poll(() => levels(page)).toEqual(["0:start", "1:two", "0:three"]);
  // Enter on an empty item at the top level ends the list.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");
  await expect.poll(() => levels(page)).toEqual(["0:start", "1:two", "0:three", "-:after"]);
  // Backspace at the start of "three" takes its number away.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await expect.poll(() => levels(page)).toEqual(["0:start", "1:two", "-:three", "-:after"]);
  for (let i = 0; i < 30; i++) await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => levels(page)).toEqual(["-:start"]);
});

test("the toolbar makes a numbered list; Escape then Shift+Tab leaves the editor", async ({
  page,
}) => {
  await openDoc(page, [p("one"), p("two")]);
  await editor(page).getByText("one").click();
  await page.keyboard.press("ControlOrMeta+a");
  const numbered = page.getByRole("button", { name: "Numbered list" });
  await numbered.click();
  await expect.poll(() => levels(page)).toEqual(["0:one", "0:two"]);
  await expect(numbered).toHaveAttribute("aria-pressed", "true");
  await numbered.click();
  await expect.poll(() => levels(page)).toEqual(["-:one", "-:two"]);
  // Tab types a tab (as in Word); after Escape, Shift+Tab goes back to the toolbar.
  await editor(page).getByText("two").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Tab");
  await expect(editor(page)).not.toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[role="toolbar"]') !== null))
    .toBe(true);
  await expect.poll(() => levels(page)).toEqual(["-:one", "-:two"]);
});
