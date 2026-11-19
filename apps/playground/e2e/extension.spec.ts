import type { FoliDocument, NodeJSON } from "@folijs/core";
import { expect, type Page, test } from "@playwright/test";
import type { ExtensionPage } from "../src/extension.js";

// Custom nodes and marks (ADR-0008, 12.3) on /extension.html: `acme:mention` (inline),
// `acme:card` (block) and `acme:topic` (a mark) typed, drawn on the pages, undone, copied and
// pasted (also into an editor without the extension), saved and loaded, and through .docx.

const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
declare global {
  interface Window {
    __extension: ExtensionPage;
  }
}

/** Custom nodes, and text under custom marks, in document order. */
const customs = (page: Page) =>
  page.evaluate(() => {
    const found: unknown[] = [];
    const walk = (node: NodeJSON) => {
      const marks = (node.marks ?? []).filter((m) => m.type.includes(":"));
      if (node.type.includes(":")) found.push({ node: node.type, attrs: node.attrs });
      else if (marks.length) found.push({ text: node.text, marks });
      node.content?.forEach(walk);
    };
    walk(window.__extension.save().content);
    return found;
  });

const MENTION = { node: "acme:mention", attrs: { id: "u-42", label: "Ada Lovelace" } };
const TOPIC = { text: "budget", marks: [{ type: "acme:topic", attrs: { topic: "finance" } }] };
const chip = (page: Page) => editor(page).locator(".foli-page [data-foli-custom='acme:mention']");

/** Presses `key` until the custom content is `wanted` (undo steps group typing by time). */
async function pressUntil(page: Page, key: string, wanted: unknown[]): Promise<void> {
  for (let n = 0; n < 8; n++) {
    await page.keyboard.press(key);
    if (JSON.stringify(await customs(page)) === JSON.stringify(wanted)) return;
  }
  throw new Error(`${key} never gave ${JSON.stringify(wanted)}`);
}

async function typeSample(page: Page, url = "/extension.html"): Promise<void> {
  await page.goto(url);
  await editor(page).click();
  await page.keyboard.type("Ask ");
  await page.keyboard.press(`${MOD}+Shift+m`);
  await page.keyboard.type(" about the budget");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press(`${MOD}+Shift+k`);
  await page.keyboard.press("End");
}

test("typed, drawn on the page, undone and redone", async ({ page }) => {
  await typeSample(page);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC]);
  await expect(chip(page)).toHaveText("@Ada Lovelace");
  await expect(editor(page)).toContainText("Ask @Ada Lovelace about the budget");
  // Typing after the mark does not extend it (inclusive: false); the chip is one position.
  await page.keyboard.type("!");
  await expect
    .poll(() => page.evaluate(() => window.__extension.save().content.content?.[0]?.content))
    .toEqual([
      { type: "text", text: "Ask " },
      { type: "acme:mention", attrs: MENTION.attrs },
      { type: "text", text: " about the " },
      { type: "text", text: "budget", marks: TOPIC.marks },
      { type: "text", text: "!" },
    ]);
  await pressUntil(page, `${MOD}+z`, [MENTION]);
  await pressUntil(page, `${MOD}+z`, []);
  await expect(chip(page)).toHaveCount(0);
  await pressUntil(page, `${MOD}+y`, [MENTION, TOPIC]);
  await expect(chip(page)).toHaveText("@Ada Lovelace");
  // Backspace after the chip deletes it whole.
  await page.keyboard.press("Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Backspace");
  await expect.poll(() => customs(page)).toEqual([TOPIC]);
});

test("copied and pasted, into an editor with and without the extension", async ({
  page,
  context,
  browserName,
}) => {
  // As the playground's clipboard tests: Playwright's WebKit on Windows gives no clipboard data.
  test.skip(browserName === "webkit", "no clipboard contents in Playwright WebKit paste events");
  await typeSample(page);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC]);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press("Enter");
  await page.keyboard.press(`${MOD}+v`);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC, MENTION, TOPIC]);
  await expect(chip(page)).toHaveCount(2);
  // Without the extension: kept, foreign, drawn as its type, saved back the same.
  const other = await context.newPage();
  await other.goto("/extension.html?extension=0");
  await editor(other).click();
  await other.keyboard.press(`${MOD}+v`);
  await expect.poll(() => customs(other)).toEqual([MENTION, TOPIC]);
  await expect(chip(other)).toHaveText("[acme:mention]");
});

test("saved and loaded as JSON, with a block node, on a later page; foreign without the extension", async ({
  page,
}) => {
  await typeSample(page);
  const saved = await page.evaluate(() => window.__extension.save());
  const filler = Array.from({ length: 80 }, (_, i) => ({
    type: "paragraph",
    content: [{ type: "text", text: `Filler paragraph ${i + 1}.` }],
  }));
  const card = { type: "acme:card", attrs: { id: "c-1" } };
  // Through a string, as an app stores it; the mention ends up past the first page.
  const stored = JSON.stringify({
    ...saved,
    content: { ...saved.content, content: [...filler, card, ...(saved.content.content ?? [])] },
  });
  for (const url of ["/extension.html", "/extension.html?extension=0"]) {
    await page.goto(url);
    await page.evaluate(
      (json) => window.__extension.load(JSON.parse(json) as FoliDocument),
      stored,
    );
    const pages = editor(page).locator(".foli-page");
    await expect.poll(() => pages.count()).toBeGreaterThan(1);
    await expect(pages.first().locator("[data-foli-custom]")).toHaveCount(0);
    const known = !url.includes("=0");
    await expect(pages.last().locator("[data-foli-custom='acme:mention']")).toHaveText(
      known ? "@Ada Lovelace" : "[acme:mention]",
    );
    await expect(pages.last().locator("[data-foli-custom='acme:card']")).toHaveText(
      known ? "Card c-1" : "[acme:card]",
    );
    const again = await page.evaluate(() => JSON.stringify(window.__extension.save()));
    expect(JSON.parse(again)).toEqual(JSON.parse(stored));
  }
});

test("through .docx and back", async ({ page }) => {
  await typeSample(page);
  const bytes = await page.evaluate(() => window.__extension.toDocx());
  await page.evaluate((b) => window.__extension.fromDocx(b), bytes);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC]);
  await expect(chip(page)).toHaveText("@Ada Lovelace");
  // Read without the extension: foreign, showing the text the control had.
  await page.goto("/extension.html?extension=0");
  await page.evaluate((b) => window.__extension.fromDocx(b), bytes);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC]);
  await expect(chip(page)).toHaveText("@Ada Lovelace");
});
