/**
 * Floating pictures in the editable view (10.9, ADR-0006): the corpus's picture report (07)
 * opened on the editing page, its three anchored pictures drawn as CSS floats at their
 * paragraphs' start: placed where Word places them (its reference measurements), the lines
 * going around them as their wrapping says, and selected by a click.
 */
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const REFERENCE = new URL("../../../corpus/reference/word/", import.meta.url);
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

type WordPicture = {
  float: boolean;
  page: number;
  paragraph?: number;
  left: number;
  top: number;
  width: number;
  height: number;
  alt: string;
};
const reference = JSON.parse(
  readFileSync(new URL("07-picture-report.json", REFERENCE), "utf8").replace(/^﻿/, ""),
) as { pictures: WordPicture[] };
const floating = reference.pictures.filter((p) => p.float);
/** CSS px per point. */
const PX = 96 / 72;

async function open(page: Page, name: string): Promise<void> {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL(name, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(() => document.querySelectorAll("section.foli-page").length >= 1);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

type Rect = { left: number; right: number; top: number; bottom: number };

/** Where a floating picture is drawn: its page, paragraph, offsets and the lines beside it. */
const placed = (page: Page, alt: string) =>
  page.evaluate((name) => {
    const img = [...document.querySelectorAll("img[data-foli-picture]")].find(
      (el) => (el as HTMLImageElement).alt === name,
    ) as HTMLElement;
    const holder = img.closest("[data-foli-float]") as HTMLElement;
    const fragment = holder.parentElement as HTMLElement;
    const section = fragment.parentElement as HTMLElement;
    const pages = [...document.querySelectorAll("section.foli-page")];
    // Top-level paragraphs' first fragments, in order (the corpus document has no tables).
    const firsts = [...document.querySelectorAll("section.foli-page > *")].filter(
      (el) => !(el as HTMLElement).dataset.fragment || (el as HTMLElement).dataset.fragment === "0",
    );
    const box = img.getBoundingClientRect();
    const sectionBox = section.getBoundingClientRect();
    const scale = sectionBox.width / section.offsetWidth;
    const contentLeft =
      sectionBox.left + Number.parseFloat(getComputedStyle(section).paddingLeft) * scale;
    const rect = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    // The lines of the pages' text: one rect per text node line.
    const lines: { left: number; right: number; top: number; bottom: number }[] = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) lines.push(rect(r));
    }
    return {
      wrap: holder.getAttribute("data-foli-float"),
      page: pages.indexOf(section) + 1,
      paragraph: firsts.indexOf(fragment) + 1,
      left: (box.left - contentLeft) / scale,
      top: (box.top - fragment.getBoundingClientRect().top) / scale,
      width: box.width / scale,
      height: box.height / scale,
      picture: rect(box),
      column: {
        left: contentLeft,
        right: sectionBox.right - Number.parseFloat(getComputedStyle(section).paddingRight) * scale,
      },
      lines,
    };
  }, alt);

const overlaps = (a: Rect, b: Rect) => a.top < b.bottom - 1 && a.bottom > b.top + 1;

test("floating pictures are where Word puts them, on its page, at its offsets", async ({
  page,
}, info) => {
  await open(page, "07-picture-report.docx");
  await expect(editor(page).locator("[data-foli-float]")).toHaveCount(3);
  for (const word of floating) {
    const at = await placed(page, word.alt);
    info.annotations.push({ type: word.alt, description: JSON.stringify({ word, at }) });
    expect(at.page).toBe(word.page);
    expect(at.paragraph).toBe(word.paragraph);
    expect(Math.abs(at.left - word.left * PX)).toBeLessThan(1.5);
    expect(Math.abs(at.top - word.top * PX)).toBeLessThan(1.5);
    expect(Math.abs(at.width - word.width * PX)).toBeLessThan(1);
    expect(Math.abs(at.height - word.height * PX)).toBeLessThan(1);
  }
});

test("lines go around a square picture, not beside a top-and-bottom one, over one behind", async ({
  page,
}) => {
  await open(page, "07-picture-report.docx");
  // Square, on the right of the column: lines beside it end before it.
  const square = await placed(page, "Northwind logo");
  expect(square.wrap).toBe("square");
  const beside = square.lines.filter((l) => overlaps(l, square.picture));
  expect(beside.length).toBeGreaterThan(0);
  for (const line of beside) expect(line.right).toBeLessThanOrEqual(square.picture.left + 1);
  // Top and bottom: no line beside it.
  const topAndBottom = await placed(page, "Chart of readings, placed between paragraphs");
  expect(topAndBottom.wrap).toBe("topAndBottom");
  expect(topAndBottom.lines.filter((l) => overlaps(l, topAndBottom.picture))).toEqual([]);
  // Behind text: the lines over it at the column's full width, the text on top.
  const behind = await placed(page, "Northwind logo as a watermark");
  expect(behind.wrap).toBe("behind");
  const over = behind.lines.filter((l) => overlaps(l, behind.picture));
  expect(over.length).toBeGreaterThan(0);
  expect(over.some((l) => l.left < behind.picture.left && l.right > behind.picture.right)).toBe(
    true,
  );
  const hit = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x as number, y as number)?.closest("[data-foli-float]"),
    [
      (behind.picture.left + behind.picture.right) / 2,
      ((over[0] as Rect).top + (over[0] as Rect).bottom) / 2,
    ],
  );
  expect(hit).toBe(false);
});

test("a click on a floating picture selects it, at its place in the text", async ({ page }) => {
  await open(page, "07-picture-report.docx");
  const img = editor(page).locator('img[alt="Northwind logo"]');
  await img.click();
  const selected = await page.evaluate(() => {
    const { selection, doc } = window.foliEdit.editor.state;
    const node = doc.nodeAt(selection.from);
    return { type: node?.type.name, alt: node?.attrs.alt, to: selection.to - selection.from };
  });
  expect(selected).toEqual({ type: "picture", alt: "Northwind logo", to: 1 });
  await expect(editor(page).locator("[data-foli-float] [data-foli-resize]")).toHaveCount(1);
  // Typing replaces it, as with an inline picture.
  await page.keyboard.type("X");
  await expect(editor(page).locator("[data-foli-float]")).toHaveCount(2);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

test("the pages settle with a floating picture in a paragraph split across them", async ({
  page,
}) => {
  await open(page, "07-picture-report.docx");
  // Paragraphs added before the logo's until its paragraph runs over a page end.
  const split = await page.evaluate(async () => {
    const { editor } = window.foliEdit;
    const holder = () =>
      [...document.querySelectorAll("[data-foli-float]")].find(
        (el) => el.querySelector("img")?.getAttribute("alt") === "Northwind logo",
      ) as HTMLElement;
    for (let i = 0; i < 60; i++) {
      if (holder().parentElement?.dataset.fragment !== undefined) return i;
      let at = -1;
      editor.state.doc.forEach((node, offset) => {
        let has = false;
        node.descendants((child) => {
          if (child.attrs.alt === "Northwind logo") has = true;
        });
        if (has && at < 0) at = offset;
      });
      const { schema } = editor.state;
      const filler = schema.nodes.paragraph.create(
        null,
        schema.text("A paragraph added to move the logo's paragraph down the page."),
      );
      editor.dispatch(editor.state.tr.insert(at, filler));
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)));
    }
    return -1;
  });
  expect(split).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  // No relayout after that: the view's DOM stays as it is.
  const changes = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let count = 0;
        const observer = new MutationObserver((records) => {
          count += records.length;
        });
        observer.observe(document.querySelector("[role=textbox]") as Element, {
          subtree: true,
          childList: true,
          attributes: true,
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 1500);
      }),
  );
  expect(changes).toBe(0);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});
