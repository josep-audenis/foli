import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FoliDocument, NodeJSON } from "@folijs/core";
import { expect, type Page, test } from "@playwright/test";
import type { Spike } from "../src/main.js";

// ADR-0008's spike: a custom inline node (`acme:mention`) and a custom mark (`acme:topic`)
// declared outside the packages, typed, drawn on the pages, undone, copied and pasted, saved and
// loaded as JSON, and through .docx (Foli to Foli here; Word in word.ps1 / word.mjs).

const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
declare global {
  interface Window {
    __spike: Spike;
  }
}

/** The first paragraph's inline content as saved. */
const firstParagraph = async (page: Page) =>
  page.evaluate(() => window.__spike.save().content.content?.[0]?.content ?? []);

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
    walk(window.__spike.save().content);
    return found;
  });

const MENTION = { node: "acme:mention", attrs: { id: "u-42", label: "Ada Lovelace" } };
const TOPIC = { text: "budget", marks: [{ type: "acme:topic", attrs: { topic: "finance" } }] };

/** Presses `key` until the custom content is `wanted` (undo steps group typing by time). */
async function pressUntil(page: Page, key: string, wanted: unknown[]): Promise<void> {
  for (let n = 0; n < 8; n++) {
    await page.keyboard.press(key);
    if (JSON.stringify(await customs(page)) === JSON.stringify(wanted)) return;
  }
  throw new Error(`${key} never gave ${JSON.stringify(wanted)}`);
}

async function typeSample(page: Page): Promise<void> {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.type("Ask ");
  await page.keyboard.press(`${MOD}+Shift+m`);
  await page.keyboard.type(" about the budget");
  // Select "budget" and mark it.
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press(`${MOD}+Shift+k`);
  await page.keyboard.press("End");
}

test("typed, drawn on the page, undone and redone", async ({ page }) => {
  await typeSample(page);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC]);
  const chip = editor(page).locator(".foli-page [data-mention='u-42']");
  await expect(chip).toHaveText("@Ada Lovelace");
  await expect(editor(page).locator(".foli-page [data-topic='finance']")).toHaveText("budget");
  await expect(editor(page)).toContainText("Ask @Ada Lovelace about the budget");
  // Typing after the mark does not extend it (inclusive: false), and the chip is one position.
  await page.keyboard.type("!");
  await expect
    .poll(() => firstParagraph(page))
    .toEqual([
      { type: "text", text: "Ask " },
      { type: "acme:mention", attrs: MENTION.attrs },
      { type: "text", text: " about the " },
      { type: "text", text: "budget", marks: TOPIC.marks },
      { type: "text", text: "!" },
    ]);
  // Undo takes the mark off, then the mention; redo brings both back.
  await pressUntil(page, `${MOD}+z`, [MENTION]);
  await pressUntil(page, `${MOD}+z`, []);
  await expect(chip).toHaveCount(0);
  await pressUntil(page, `${MOD}+y`, [MENTION, TOPIC]);
  await expect(chip).toHaveText("@Ada Lovelace");
  // Backspace after the chip deletes it whole.
  await page.keyboard.press("Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Backspace");
  await expect.poll(() => customs(page)).toEqual([TOPIC]);
});

test("copied and pasted", async ({ page, browserName }) => {
  // As the playground's clipboard tests: Playwright's WebKit on Windows gives no clipboard data.
  test.skip(browserName === "webkit", "no clipboard contents in Playwright WebKit paste events");
  // Measured: Playwright's Firefox on Windows pastes only text/html and text/plain, not Foli's
  // JSON, so the HTML is read: the mention comes back as its text, shaded, the mark not at all.
  // 12.3 has to carry custom nodes and marks in the HTML too (ADR-0008).
  test.fail(browserName === "firefox", "Foli JSON does not reach paste in Playwright's Firefox");
  await typeSample(page);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC]);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press("Enter");
  await page.keyboard.press(`${MOD}+v`);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC, MENTION, TOPIC]);
  await expect(editor(page).locator("[data-mention='u-42']")).toHaveCount(2);
});

test("saved and loaded as JSON, on a later page", async ({ page }) => {
  await typeSample(page);
  const saved = await page.evaluate(() => window.__spike.save());
  const filler = Array.from({ length: 80 }, (_, i) => ({
    type: "paragraph",
    content: [{ type: "text", text: `Filler paragraph ${i + 1}.` }],
  }));
  // Through a string, as an app stores it; the mention ends up past the first page.
  const stored = JSON.stringify({
    ...saved,
    content: { ...saved.content, content: [...filler, ...(saved.content.content ?? [])] },
  });
  await page.evaluate((json) => window.__spike.load(JSON.parse(json) as FoliDocument), stored);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC]);
  const pages = editor(page).locator(".foli-page");
  expect(await pages.count()).toBeGreaterThan(1);
  await expect(pages.first().locator("[data-mention]")).toHaveCount(0);
  await expect(pages.last().locator("[data-mention='u-42']")).toHaveText("@Ada Lovelace");
  const again = await page.evaluate(() => JSON.stringify(window.__spike.save()));
  expect(JSON.parse(again)).toEqual(JSON.parse(stored));
});

test("through .docx and back", async ({ page, browserName }) => {
  await typeSample(page);
  const bytes = await page.evaluate(() => window.__spike.toDocx());
  // Kept for the Word round trip (src/word.test.ts), where Playwright does not clear it.
  const dir = join("spikes", "extension", "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `editor-${browserName}.docx`), Uint8Array.from(bytes));
  await page.evaluate((b) => window.__spike.fromDocx(b), bytes);
  await expect.poll(() => customs(page)).toEqual([MENTION, TOPIC]);
  await expect(editor(page).locator("[data-mention='u-42']")).toHaveText("@Ada Lovelace");
});
