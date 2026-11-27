/**
 * Text boxes drawn (33.2, ADR-0016): the corpus's text box flyer (11) on the editing page, each
 * box with its text where Word puts it (its reference measurements), the lines going around a
 * square one, none beside a top-and-bottom one, one in front of the text fixed on the page, one
 * in the header; and in `renderDocument`'s pages. Edited (33.3): a click puts the caret in a box,
 * Escape leaves it selected, undo takes the typing back; Insert ▸ Text Box draws a new one.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const REFERENCE = new URL("../../../corpus/reference/word/", import.meta.url);
const NAME = "11-text-box-flyer.docx";

type WordBox = {
  page: number;
  paragraph: number;
  left: number;
  top: number;
  width: number;
  height: number;
  alt: string;
  wrap: number;
  horizontalTo: number;
  verticalTo: number;
  text: string;
};
const reference = JSON.parse(
  readFileSync(new URL("11-text-box-flyer.json", REFERENCE), "utf8").replace(/^﻿/, ""),
) as { textBoxes: WordBox[] };
/** CSS px per point. */
const PX = 96 / 72;

async function open(page: Page, ribbon = false): Promise<void> {
  await page.goto(ribbon ? "/edit.html" : "/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL(NAME, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(() => document.querySelectorAll("[data-foli-text-box]").length >= 4);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

type Rect = { left: number; right: number; top: number; bottom: number };

/** A box's place: from its page's corner, its column and its paragraph; the lines beside it. */
const placed = (page: Page, alt: string) =>
  page.evaluate((name) => {
    const box = document.querySelector(`[data-foli-text-box][aria-label="${name}"]`) as HTMLElement;
    const section = box.closest("section.foli-page") as HTMLElement;
    const holder = box.closest("[data-foli-float]") as HTMLElement | null;
    const fragment = holder?.parentElement as HTMLElement;
    const r = box.getBoundingClientRect();
    const s = section.getBoundingClientRect();
    const scale = s.width / section.offsetWidth;
    const contentLeft = s.left + Number.parseFloat(getComputedStyle(section).paddingLeft) * scale;
    const rect = (x: DOMRect) => ({ left: x.left, right: x.right, top: x.top, bottom: x.bottom });
    const lines: Rect[] = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest("[data-foli-text-box]"))
        continue;
      range.selectNodeContents(node);
      for (const x of range.getClientRects()) lines.push(rect(x));
    }
    return {
      wrap: holder?.getAttribute("data-foli-float") ?? null,
      text: [...box.querySelectorAll("p")].map((p) => p.textContent).join("\n"),
      fromColumn: (r.left - contentLeft) / scale,
      fromParagraph: fragment ? (r.top - fragment.getBoundingClientRect().top) / scale : null,
      fromPage: { left: (r.left - s.left) / scale, top: (r.top - s.top) / scale },
      width: r.width / scale,
      height: r.height / scale,
      box: rect(r),
      lines,
    };
  }, alt);

const overlaps = (a: Rect, b: Rect) => a.top < b.bottom - 1 && a.bottom > b.top + 1;

test("text boxes show their text where Word puts them, at its size", async ({ page }, info) => {
  await open(page);
  for (const word of reference.textBoxes) {
    const at = await placed(page, word.alt);
    info.annotations.push({ type: word.alt, description: JSON.stringify({ word, at }) });
    expect(at.text).toBe(word.text);
    expect(Math.abs(at.width - word.width * PX)).toBeLessThan(1);
    expect(Math.abs(at.height - word.height * PX)).toBeLessThan(1);
    if (word.horizontalTo === 1) {
      // Against the page (WdRelativeHorizontalPosition 1): from its corner.
      expect(Math.abs(at.fromPage.left - word.left * PX)).toBeLessThan(1.5);
      expect(Math.abs(at.fromPage.top - word.top * PX)).toBeLessThan(1.5);
    } else {
      expect(Math.abs(at.fromColumn - word.left * PX)).toBeLessThan(1.5);
      expect(Math.abs((at.fromParagraph ?? 0) - word.top * PX)).toBeLessThan(1.5);
    }
  }
});

test("lines go around a square box, not beside a top-and-bottom one", async ({ page }) => {
  await open(page);
  const square = await placed(page, "Programme box");
  expect(square.wrap).toBe("square");
  const beside = square.lines.filter((l) => overlaps(l, square.box));
  expect(beside.length).toBeGreaterThan(0);
  for (const line of beside) expect(line.right).toBeLessThanOrEqual(square.box.left + 1);
  const quote = await placed(page, "Pull quote");
  expect(quote.wrap).toBe("topAndBottom");
  expect(quote.lines.filter((l) => overlaps(l, quote.box))).toEqual([]);
  const badge = await placed(page, "Free entry badge");
  expect(badge.wrap).toBe("inFront");
});

test("the header's box shows on the page, and the boxes pass axe", async ({ page }) => {
  await open(page);
  const header = page.locator(".foli-region [data-foli-text-box]");
  await expect(header).toHaveCount(1);
  await expect(header).toHaveText("Saturday 14 March");
  const results = await new AxeBuilder({ page }).include("section.foli-page").analyze();
  expect(results.violations).toEqual([]);
});

test("renderDocument draws the boxes too (print, exportPdf)", async ({ page }) => {
  await page.goto("/word.html");
  await page.waitForFunction(() => "foliWord" in window);
  const base64 = readFileSync(new URL(NAME, CORPUS)).toString("base64");
  await page.evaluate(
    (data) =>
      (
        window as unknown as { foliWord: { render(d: string, r: string): Promise<unknown> } }
      ).foliWord.render(data, "markup"),
    base64,
  );
  const texts = await page.evaluate(() =>
    [...document.querySelectorAll("[data-foli-text-box]")].map((b) => b.textContent),
  );
  expect([...texts].sort()).toEqual(
    [
      "ProgrammeWorkshops, talks and a lunch for every visitor.",
      "Everyone is welcome: bring a friend.",
      "Free entry",
      "Saturday 14 March",
    ].sort(),
  );
});

const boxText = (page: Page, story: string) =>
  page.evaluate(
    (id) =>
      (
        window as unknown as {
          foliEdit: {
            editor: { getDocument(): { stories?: Record<string, { content: unknown }> } };
          };
        }
      ).foliEdit.editor.getDocument().stories?.[id],
    story,
  );
const textOf = (node: unknown): string => {
  const n = node as { text?: string; content?: unknown[] } | undefined;
  return n?.text ?? (n?.content ?? []).map(textOf).join("");
};

test("a click puts the caret in a box; Escape leaves it selected; undo takes the typing back", async ({
  page,
}) => {
  await open(page);
  const box = page.locator('[data-foli-text-box="textbox:1"]').first();
  const line = box.locator("p").nth(1);
  const at = await line.boundingBox();
  if (!at) throw new Error("no box line");
  // On its first line.
  await page.mouse.click(at.x + 2, at.y + 4);
  await expect(page.locator(".foli-story-mount")).toHaveCount(1);
  await page.keyboard.press("Home");
  await page.keyboard.type("New: ");
  expect(textOf((await boxText(page, "textbox:1"))?.content)).toContain("New: Workshops, talks");
  await page.keyboard.press("Escape");
  await expect(page.locator(".foli-story-mount")).toHaveCount(0);
  await expect(page.locator('[data-foli-text-box="textbox:1"]').first()).toContainText(
    "New: Workshops",
  );
  const selected = await page.evaluate(
    () =>
      (
        window as unknown as {
          foliEdit: { editor: { state: { selection: { node?: { type: { name: string } } } } } };
        }
      ).foliEdit.editor.state.selection.node?.type.name,
  );
  expect(selected).toBe("textBox");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator('[data-foli-text-box="textbox:1"]').first()).not.toContainText("New:");
});

test("Insert ▸ Text Box draws a new box, the caret in it", async ({ page }) => {
  await open(page, true);
  const before = await page.locator("[data-foli-text-box]").count();
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Insert text box" }).click();
  await expect(page.locator(".foli-story-mount")).toHaveCount(1);
  await page.keyboard.type("Typed in a new box");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-foli-text-box]")).toHaveCount(before + 1);
  await expect(page.locator("[data-foli-text-box]", { hasText: "Typed in a new box" })).toHaveCount(
    1,
  );
});

test("find goes into a text box: its match revealed opens the box", async ({ page }) => {
  await open(page);
  const opened = await page.evaluate(() => {
    const { editor } = (
      window as unknown as {
        foliEdit: {
          editor: {
            storyView: {
              reveal(t: { story: string; from: number; to: number }, o: object): boolean;
            } | null;
          };
        };
      }
    ).foliEdit;
    return editor.storyView?.reveal({ story: "textbox:2", from: 1, to: 9 }, { focus: true });
  });
  expect(opened).toBe(true);
  await expect(page.locator(".foli-story-mount")).toHaveCount(1);
  await page.keyboard.type("All");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-foli-text-box="textbox:2"]').first()).toContainText(
    "All is welcome",
  );
});

test("a press in another box after typing in one opens that one", async ({ page }) => {
  await open(page);
  const first = await page.locator('[data-foli-text-box="textbox:1"] p').first().boundingBox();
  if (!first) throw new Error("no first box");
  await page.mouse.click(first.x + 2, first.y + 4);
  await page.keyboard.type("Q");
  const second = await page.locator('[data-foli-text-box="textbox:2"] p').first().boundingBox();
  if (!second) throw new Error("no second box");
  await page.mouse.click(second.x + second.width / 2, second.y + 4);
  await expect(page.locator(".foli-story-mount")).toHaveCount(1);
  await page.keyboard.type("Z");
  await page.keyboard.press("Escape");
  expect(textOf((await boxText(page, "textbox:2"))?.content)).toContain("Z");
  expect(textOf((await boxText(page, "textbox:1"))?.content)).toContain("Q");
});
