/**
 * Schema v3 on pages (8.6b, `renderDocumentV3`): page geometry by section, splitting with
 * widow and orphan control, keep with next, Word's paragraph spacing at page tops, explicit
 * breaks, repeated table headers, line numbers, and the final view of tracked changes. Lines
 * are exactly 20 px (`exact` line spacing) in the bundled test font, so every engine lays the
 * pages out the same way.
 */
import { expect, type Page, test } from "@playwright/test";
import { loadTestFont, routeTestFont } from "./fixtures.js";

type Json = Record<string, unknown>;
interface Shown {
  type: string;
  page: number | null;
  line: number | null;
  text: string;
}

const A4 = {
  pageSize: { width: 11906, height: 16838 },
  margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
};
/** Content height of an A4 page with 1 inch margins: 930.5 px, room for 46 lines of 20 px. */
const LINES_PER_PAGE = 46;

const text = (value: string): Json => ({ type: "text", text: value });
const p = (attrs: Json, ...content: Json[]): Json => ({
  type: "paragraph",
  ...(Object.keys(attrs).length ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
/** A paragraph of `count` lines (short lines ended by line breaks). */
const lines = (count: number, attrs: Json = {}): Json =>
  p(
    attrs,
    ...Array.from({ length: count }, (_, i) => [text(`line ${i + 1}`), { type: "hardBreak" }])
      .flat()
      .slice(0, -1),
  );

function documentOf(content: Json[], section: Json = A4): Json {
  return {
    schemaVersion: 3,
    section,
    defaults: {},
    styles: [
      {
        id: "Normal",
        type: "paragraph",
        isDefault: true,
        paragraph: { spacing: { after: 0, line: 300, lineRule: "exact" } },
        run: [
          { type: "font", attrs: { ascii: "Foli Test", hAnsi: "Foli Test" } },
          { type: "fontSize", attrs: { value: 22 } },
        ],
      },
      {
        id: "Heading1",
        type: "paragraph",
        basedOn: "Normal",
        paragraph: { outlineLevel: 0, keepNext: true },
      },
    ],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content },
  };
}

async function show(page: Page, content: Json[], section?: Json, review = "markup") {
  return page.evaluate(
    ([json, view]) =>
      (window as unknown as { foliWord: { show(j: unknown, r: string): Shown[] } }).foliWord.show(
        json,
        view,
      ),
    [documentOf(content, section), review] as const,
  );
}

/** Each page's size and the top margins and heights of the elements in its content box. */
function pages(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".foli-word-page")].map((element) => ({
      width: Math.round(element.getBoundingClientRect().width * 10) / 10,
      height: Math.round(element.getBoundingClientRect().height * 10) / 10,
      blocks: [
        ...((element.firstElementChild as HTMLElement).children as HTMLCollectionOf<HTMLElement>),
      ].map((b) => {
        // A fragment of a split block: the whole block moved up inside its clip (the last
        // child; a repeated table header comes before it).
        const last = b.lastElementChild as HTMLElement | null;
        const clip = last?.localName === "div" && last.style.overflow === "hidden" ? last : b;
        const inner = clip.style.overflow === "hidden" && clip.firstElementChild;
        return {
          marginTop: b.style.marginTop,
          height: Math.round(b.getBoundingClientRect().height),
          offset: inner ? (inner as HTMLElement).style.marginTop : null,
          tables: b.querySelectorAll("table").length,
        };
      }),
    })),
  );
}

test.beforeEach(async ({ page }) => {
  await routeTestFont(page);
  await page.goto("/word.html");
  await loadTestFont(page);
});

test("pages take each section's size; a continuous section goes on", async ({ page }) => {
  const landscape = { ...A4, pageSize: { width: 16838, height: 11906 } };
  const shown = await show(
    page,
    [p({ section: A4 }, text("portrait")), p({}, text("wide"))],
    landscape,
  );
  expect(shown.map((s) => s.page)).toEqual([0, 1]);
  const [first, second] = await pages(page);
  expect([first?.width, first?.height]).toEqual([793.7, 1122.5]);
  expect([second?.width, second?.height]).toEqual([1122.5, 793.7]);
  const continuous = await show(page, [p({ section: A4 }, text("a")), p({}, text("b"))], {
    ...A4,
    type: "continuous",
  });
  expect(continuous.map((s) => s.page)).toEqual([0, 0]);
});

test("a long paragraph splits at a line, keeping two lines on each side", async ({ page }) => {
  await show(page, [lines(LINES_PER_PAGE + 10)]);
  let result = await pages(page);
  expect(result.map((r) => r.blocks.map((b) => b.height))).toEqual([[920], [200]]);
  // Page 2 shows the block from its 47th line.
  expect(result[1]?.blocks[0]?.offset).toBe("-920px");
  // One line more than fits: two go to the next page, not one.
  await show(page, [lines(LINES_PER_PAGE + 1)]);
  result = await pages(page);
  expect(result.map((r) => r.blocks.map((b) => b.height))).toEqual([[900], [40]]);
});

test("a paragraph kept together moves whole to the next page", async ({ page }) => {
  const filler = lines(LINES_PER_PAGE - 3);
  // Five lines where three fit: split (3 + 2) unless kept together.
  let shown = await show(page, [filler, lines(5), p({}, text("after"))]);
  expect(shown.map((s) => [s.page, s.line])).toEqual([
    [0, 1],
    [0, LINES_PER_PAGE - 2],
    [1, 3],
  ]);
  shown = await show(page, [filler, lines(5, { keepLines: true }), p({}, text("after"))]);
  expect(shown.map((s) => [s.page, s.line])).toEqual([
    [0, 1],
    [1, 1],
    [1, 6],
  ]);
  // Taller than a page: split anyway (60 lines: 46 + 14), not cut off.
  shown = await show(page, [lines(60, { keepLines: true }), p({}, text("after"))]);
  expect(shown.map((s) => [s.page, s.line])).toEqual([
    [0, 1],
    [1, 15],
  ]);
  // A page break inside it still ends the page.
  shown = await show(page, [
    p({ keepLines: true }, text("a"), { type: "hardBreak" }, text("b"), { type: "pageBreak" }),
    p({}, text("after")),
  ]);
  expect(shown.map((s) => [s.page, s.line])).toEqual([
    [0, 1],
    [1, 1],
  ]);
});

test("a heading keeps with the paragraph after it", async ({ page }) => {
  const filler = Array.from({ length: LINES_PER_PAGE - 1 }, (_, i) => p({}, text(`p${i}`)));
  const shown = await show(page, [
    ...filler,
    p({ style: "Heading1" }, text("Heading")),
    p({}, text("after")),
  ]);
  expect(shown.slice(-2).map((s) => [s.page, s.line])).toEqual([
    [1, 1],
    [1, 2],
  ]);
  expect(await page.locator(".foli-word-page h1").count()).toBe(1);
  expect(await page.locator(".foli-word-page").nth(1).locator("h1").count()).toBe(1);
});

test("space before is dropped at the top of a page the text flowed onto, kept after a break", async ({
  page,
}) => {
  const before = { spacing: { before: 600 } };
  await show(page, [lines(LINES_PER_PAGE), p(before, text("flowed"))]);
  let result = await pages(page);
  expect(result[1]?.blocks[0]?.marginTop).toBe("0px");
  await show(page, [p({}, text("a"), { type: "pageBreak" }), p(before, text("after a break"))]);
  result = await pages(page);
  expect(result).toHaveLength(2);
  expect(result[1]?.blocks[0]?.marginTop).toBe("40px");
  await show(page, [
    p({}, text("a")),
    p({ ...before, pageBreakBefore: true }, text("break before")),
  ]);
  result = await pages(page);
  expect(result.map((r) => r.blocks[0]?.marginTop)).toEqual(["0px", "40px"]);
  // Between paragraphs the space after one and the space before the next add up: 20 + 40.
  await show(page, [p({ spacing: { after: 300 } }, text("a")), p(before, text("b"))]);
  result = await pages(page);
  expect(result[0]?.blocks.map((b) => b.marginTop)).toEqual(["0px", "60px"]);
  // On the first page, and between paragraphs, it is kept: after 0 + before 40.
  await show(page, [p(before, text("first")), p(before, text("second"))]);
  result = await pages(page);
  expect(result[0]?.blocks.map((b) => b.marginTop)).toEqual(["40px", "40px"]);
});

test("a page break inside a paragraph ends its page; lines are numbered per page", async ({
  page,
}) => {
  const shown = await show(page, [
    p({}, text("one")),
    p({}, text("two"), { type: "pageBreak" }, text("three")),
    lines(3),
    p({}, text("after")),
  ]);
  expect(shown.map((s) => [s.page, s.line])).toEqual([
    [0, 1],
    [0, 2],
    [1, 2],
    [1, 5],
  ]);
  const result = await pages(page);
  expect(result[1]?.blocks[0]?.offset).toBe("-20px");
});

test("a table split across pages repeats its header rows", async ({ page }) => {
  const rows = Array.from(
    { length: 60 },
    (_, i) => `<w:tr><w:tc><w:p><w:r><w:t>row ${i + 1}</w:t></w:r></w:p></w:tc></w:tr>`,
  ).join("");
  const xml = `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Head</w:t></w:r></w:p></w:tc></w:tr>${rows}</w:tbl>`;
  const shown = await show(page, [
    { type: "opaqueBlock", attrs: { xml, label: "Table" } },
    p({}, text("after")),
  ]);
  const result = await pages(page);
  expect(result).toHaveLength(2);
  // The header again, above the rows that continue.
  expect(result[1]?.blocks[0]?.tables).toBe(2);
  // The header (20 px) and the rows that did not fit on page 1 (46 lines: the header and 45 rows).
  expect(result[1]?.blocks[0]?.height).toBe(20 + 15 * 20);
  expect(shown[1]?.page).toBe(1);
  // The repeated header takes room: 90 rows fill page 2 with it (1 + 45 lines), so the
  // paragraph after the table goes to page 3; without it, it would fit on page 2.
  const full = Array.from(
    { length: 90 },
    (_, i) => `<w:tr><w:tc><w:p><w:r><w:t>row ${i + 1}</w:t></w:r></w:p></w:tc></w:tr>`,
  ).join("");
  const fullXml = xml.replace(rows, full);
  const after = await show(page, [
    { type: "opaqueBlock", attrs: { xml: fullXml, label: "Table" } },
    p({}, text("after")),
  ]);
  expect(after[1]?.page).toBe(2);
  // Two header rows, the first holding a nested table (its row and an empty paragraph: 40 px):
  // the header is 60 px, not cut at the nested table's row. Page 1: 3 header lines and 43 rows.
  const header = "<w:trPr><w:tblHeader/></w:trPr>";
  const nested = `<w:tr>${header}<w:tc><w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:tc></w:tr><w:tr>${header}<w:tc><w:p><w:r><w:t>Head 2</w:t></w:r></w:p></w:tc></w:tr>`;
  await show(page, [
    {
      type: "opaqueBlock",
      attrs: {
        xml: `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${nested}${rows}</w:tbl>`,
      },
    },
  ]);
  expect((await pages(page))[1]?.blocks[0]?.height).toBe(60 + 17 * 20);
});

test("the final view merges a paragraph whose mark was deleted into the next", async ({ page }) => {
  const deleted = { revision: { deletion: { id: 1, author: "Ana" } } };
  const content = [p(deleted, text("first ")), p({}, text("second"))];
  expect((await show(page, content, A4, "final")).map((s) => [s.page, s.line])).toEqual([
    [0, 1],
    [0, 1],
  ]);
  expect((await page.locator(".foli-word-page").first().textContent())?.trim()).toBe(
    "first second",
  );
  expect((await show(page, content, A4, "markup")).map((s) => s.line)).toEqual([1, 2]);
});
