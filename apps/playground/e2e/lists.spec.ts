import { expect, type Page, test } from "@playwright/test";

/** Nested blocks on pages (task 7.3, ADR-0004): lists, list items, a rule, a link. */

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

/** Per page: its leaf blocks (text, bottom, margin) and its content box bottom, in viewport px. */
function pageBlocks(page: Page) {
  return page.evaluate((contentHeight) => {
    return [...document.querySelectorAll(".foli-content > .foli-page")].map((section) => {
      const rect = section.getBoundingClientRect();
      const top = rect.top + Number.parseFloat(getComputedStyle(section).paddingTop);
      return {
        contentBottom: top + contentHeight,
        top,
        blocks: [...section.querySelectorAll("p, h1, h2, h3, h4, h5, h6, hr")].map((el) => ({
          text: el.textContent ?? "",
          tag: el.tagName,
          top: el.getBoundingClientRect().top,
          bottom: el.getBoundingClientRect().bottom,
          marginBottom: Number.parseFloat(getComputedStyle(el).marginBottom),
        })),
        items: [...section.querySelectorAll("ol > li")].map((li) => ({
          value: li.getAttribute("value"),
          marker: getComputedStyle(li).listStyleType,
          text: li.querySelector("p")?.textContent ?? "",
        })),
      };
    });
  }, CONTENT_HEIGHT);
}

test("a list across pages: every page holds its own list, numbering continues, nothing overflows", async ({
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
  const numbered = pages.flatMap((p) => p.items).filter((it) => it.text.startsWith("Item "));
  for (const it of numbered) {
    const k = Number(/^Item (\d+)/.exec(it.text)?.[1]) - 1;
    expect(it.value, it.text.slice(0, 12)).toBe(String(5 + k));
  }
  // The second page starts inside the list: its first block is in an <ol>.
  const secondFirst = await page.evaluate(() => {
    const second = document.querySelectorAll(".foli-content > .foli-page")[1];
    return second?.firstElementChild?.tagName;
  });
  expect(secondFirst).toBe("OL");
  // The nested list is a real nested list inside its item.
  await expect(
    editor(page).locator("ol > li > ul > li > p", { hasText: "nested two" }),
  ).toHaveCount(1);
});

test("typing in a list item on the second page edits that item", async ({ page }) => {
  await openDoc(page, longList);
  const target = editor(page).locator(".foli-page").nth(1).locator("ol > li > p").first();
  const before = (await target.textContent()) ?? "";
  await target.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(target).toHaveText(`${before}!`);
  // Saved: the same item holds the new text.
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key) ?? "", STORAGE_KEY))
    .toContain(`${before}!`);
});

test("a click on a rule selects it; a click on a link does not navigate", async ({ page }) => {
  await openDoc(page, longList);
  const hr = editor(page).locator("hr");
  await hr.scrollIntoViewIfNeeded();
  await hr.click();
  await expect(hr).toHaveClass(/foli-selected-node/);
  const url = page.url();
  await editor(page).getByText("a link").click();
  await expect(hr).not.toHaveClass(/foli-selected-node/);
  expect(page.url()).toBe(url);
});
