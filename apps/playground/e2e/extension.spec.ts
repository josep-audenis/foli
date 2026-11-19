import AxeBuilder from "@axe-core/playwright";
import type { FoliDocument, NodeJSON } from "@folijs/core";
import { expect, type Page, test } from "@playwright/test";
import type { ExtensionPage } from "../src/extension.js";

// Custom nodes and marks (ADR-0008, 12.3) on /extension.html: `acme:mention` (inline),
// `acme:card` (block) and `acme:topic` (a mark) typed, drawn on the pages, undone, copied and
// pasted (also into an editor without the extension), saved and loaded, and through .docx. Their
// view hooks (12.4): node views (a chip; a card of rows split across pages), a mark view,
// decorations and a plugin view.

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
  // Pasted content is drawn by the node and mark views too (T3).
  await expect(editor(page).locator(".acme-chip")).toHaveCount(2);
  await expect(editor(page).locator(".acme-topic")).toHaveCount(2);
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
    await expect(editor(page).locator("[data-foli-custom='acme:card']").first()).toContainText(
      known ? "Card c-1, row 12" : "[acme:card]",
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

/** Opens the page with `blocks` as the document. */
async function load(page: Page, blocks: NodeJSON[]): Promise<void> {
  await page.goto("/extension.html");
  await page.evaluate(
    (content) =>
      window.__extension.load({
        ...window.__extension.save(),
        content: { type: "doc", content },
      }),
    blocks,
  );
}
const para = (...content: NodeJSON[]): NodeJSON => ({ type: "paragraph", content });
const text = (value: string, ...marks: string[]): NodeJSON => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const mention = (label: string, ...marks: string[]): NodeJSON => ({
  type: "acme:mention",
  attrs: { id: "u-1", label },
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const body = (page: Page) =>
  page.evaluate(() => window.__extension.save().content.content as NodeJSON[]);

test("T1 with a custom node: typing and formatting around it keep a valid document", async ({
  page,
}) => {
  await load(page, [para(text("Hi "), mention("Ada"), text(" there"))]);
  await editor(page).click();
  await page.keyboard.press(`${MOD}+Home`);
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  // Typed right before the chip, then after it (the chip is one position).
  await page.keyboard.type("dear ");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("!");
  await page.evaluate(() => window.__extension.check());
  // Bold over the text and the chip together.
  for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press(`${MOD}+b`);
  await page.evaluate(() => window.__extension.check());
  expect(await body(page)).toEqual([
    para(
      text("Hi "),
      text("dear ", "bold"),
      mention("Ada", "bold"),
      text("!", "bold"),
      text(" there"),
    ),
  ]);
  await expect(editor(page).locator(".acme-chip")).toHaveText("@Ada");
});

test("T2 with a custom node: a selection across it and mixed formatting is replaced and undone exactly", async ({
  page,
}) => {
  await load(page, [
    para(text("one "), text("two", "bold"), mention("Ada", "italic"), text(" three")),
    para(text("four "), text("five", "italic")),
  ]);
  const original = await body(page);
  await editor(page).click();
  await page.keyboard.press(`${MOD}+Home`);
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight"); // "one t|wo"
  for (let i = 0; i < 15; i++) await page.keyboard.press("Shift+ArrowRight"); // over the chip, to "four |five"
  await expect
    .poll(() => page.evaluate(() => window.__extension.selection()))
    .toEqual({ anchor: 6, head: 22 });
  await page.keyboard.type("X");
  expect(await body(page)).toEqual([
    para(text("one "), text("tX", "bold"), text("five", "italic")),
  ]);
  await expect(editor(page).locator(".acme-chip")).toHaveCount(0);
  await page.keyboard.press(`${MOD}+z`);
  expect(await body(page)).toEqual(original);
  expect(await page.evaluate(() => window.__extension.selection())).toEqual({
    anchor: 6,
    head: 22,
  });
  await expect(editor(page).locator(".acme-chip")).toHaveText("@Ada");
});

test("a block node view taller than the room left splits across the page end, each part once", async ({
  page,
}) => {
  const card: NodeJSON = { type: "acme:card", attrs: { id: "c-9" } };
  const parts = editor(page).locator("[data-foli-custom='acme:card']");
  // Fillers until the card no longer fits at the foot of the first page.
  let split = false;
  for (let n = 20; n <= 60 && !split; n += 2) {
    await load(page, [
      ...Array.from({ length: n }, (_, i) => para(text(`Filler ${i + 1}.`))),
      card,
      para(text("After")),
    ]);
    split = (await parts.count()) === 2;
  }
  expect(split).toBe(true);
  const facts = await parts.evaluateAll((elements) =>
    elements.map((el) => ({
      page: [...document.querySelectorAll(".foli-page")].indexOf(
        el.closest(".foli-page") as Element,
      ),
      hidden: el.getAttribute("aria-hidden"),
      height: el.getBoundingClientRect().height,
      whole: (el.querySelector(".acme-card") as Element).getBoundingClientRect().height,
      clipped: getComputedStyle(el).overflow,
    })),
  );
  const [first, second] = facts as [(typeof facts)[0], (typeof facts)[0]];
  expect(second.page).toBe(first.page + 1);
  expect([first.hidden, second.hidden]).toEqual([null, "true"]);
  expect(first.clipped).toBe("hidden");
  // The parts add up to the whole card, broken between two rows.
  expect(Math.abs(first.height + second.height - first.whole)).toBeLessThan(1.5);
  const rows = await parts
    .first()
    .locator(".acme-card-row")
    .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height));
  let sum = 0;
  const ends = rows.map((h) => {
    sum += h;
    return sum;
  });
  expect(ends.some((end) => Math.abs(end - first.height) < 1.5)).toBe(true);
  // Still one node: saved once, and the text after it on the next page.
  expect((await body(page)).filter((node) => node.type === "acme:card")).toHaveLength(1);
  await expect(editor(page).locator(".foli-page").nth(second.page)).toContainText("After");
});

test("decorations: every TODO and the paragraph holding the caret, never saved", async ({
  page,
}) => {
  await page.goto("/extension.html");
  await editor(page).click();
  await page.keyboard.type("Fix TODO now and TODO later");
  await expect(editor(page).locator(".acme-todo")).toHaveText(["TODO", "TODO"]);
  const current = editor(page).locator(".acme-current");
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("Fix TODO now");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second");
  await expect(current).toHaveText("Second");
  await page.keyboard.press("ArrowUp");
  await expect(current).toContainText("Fix TODO now");
  const saved = await page.evaluate(() => JSON.stringify(window.__extension.save()));
  expect(saved).not.toContain("acme-");
});

test("a plugin view: mounted with the view, updated by each change, destroyed with it", async ({
  page,
}) => {
  await page.goto("/extension.html");
  const status = page.getByRole("status");
  await expect(status).toHaveText("0 words");
  await editor(page).click();
  await page.keyboard.type("one two three");
  await expect(status).toHaveText("3 words");
  expect(await page.evaluate(() => window.__extension.lifecycle.updates)).toBeGreaterThan(0);
  await page.evaluate(() => window.__extension.destroy());
  await expect(status).toHaveCount(0);
  expect(await page.evaluate(() => window.__extension.lifecycle)).toMatchObject({
    mounted: 1,
    destroyed: 1,
  });
});

test("the page with every view hook is axe-clean", async ({ page }) => {
  await typeSample(page);
  await page.keyboard.type(" TODO");
  await page.evaluate(() => {
    const saved = window.__extension.save();
    window.__extension.load({
      ...saved,
      content: {
        ...saved.content,
        content: [...(saved.content.content ?? []), { type: "acme:card", attrs: { id: "c-2" } }],
      },
    });
  });
  await expect(editor(page).locator(".acme-card")).toHaveCount(1);
  await expect(editor(page).locator(".acme-todo")).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
