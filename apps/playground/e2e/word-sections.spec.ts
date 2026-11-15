/**
 * Sections with their own page setups in the editable view (8.7d4), on the editing page
 * (`/edit.html`): each section's pages have its size and margins, its blocks are measured and
 * split in its own page's width, and a section starts a new page.
 */
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

// A narrow page (4 x 5 inches, half-inch margins) and A4 with inch margins.
const NARROW = {
  pageSize: { width: 5760, height: 7200 },
  margins: { top: 720, right: 720, bottom: 720, left: 720 },
};
const A4 = {
  pageSize: { width: 11906, height: 16838 },
  margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
};
const PX_PER_TWIP = 96 / 1440;

const words = (n: number, word: string) => Array.from({ length: n }, () => word).join(" ");
const paragraph = (text: string, section?: Json): Json => ({
  type: "paragraph",
  ...(section ? { attrs: { section } } : {}),
  content: [{ type: "text", text }],
});

function documentOf(blocks: Json[]): Json {
  return {
    schemaVersion: 3,
    section: A4,
    defaults: { paragraph: { spacing: { after: 160 } } },
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}

interface PageInfo {
  width: number;
  height: number;
  /** How far the page's content reaches below its content box (0: it fits). */
  overflow: number;
  /** The space left below the page's last line. */
  room: number;
  text: string;
}

/** Loads `blocks` and reads the pages at once, before any resize observer could re-flow them. */
async function loadAndRead(page: Page, blocks: Json[]): Promise<PageInfo[]> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  return page.evaluate((doc) => {
    window.foliEdit.load(doc as never);
    return readPages();
    function readPages() {
      return [...document.querySelectorAll<HTMLElement>("section.foli-page")].map((p) => {
        const box = p.getBoundingClientRect();
        const style = getComputedStyle(p);
        const bottom = box.bottom - Number.parseFloat(style.paddingBottom);
        const last = p.lastElementChild?.getBoundingClientRect().bottom ?? box.top;
        return {
          width: box.width,
          height: box.height,
          overflow: Math.max(0, last - bottom),
          room: Math.max(0, bottom - last),
          text: p.textContent ?? "",
        };
      });
    }
  }, documentOf(blocks));
}

const readPages = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("section.foli-page")].map((p) => {
      const box = p.getBoundingClientRect();
      const bottom = box.bottom - Number.parseFloat(getComputedStyle(p).paddingBottom);
      const last = p.lastElementChild?.getBoundingClientRect().bottom ?? box.top;
      return {
        width: box.width,
        height: box.height,
        overflow: Math.max(0, last - bottom),
        room: Math.max(0, bottom - last),
        text: p.textContent ?? "",
      };
    }),
  );

function expectLaidOut(pages: PageInfo[], narrow: number) {
  const narrowSize = [NARROW.pageSize.width * PX_PER_TWIP, NARROW.pageSize.height * PX_PER_TWIP];
  const a4Size = [A4.pageSize.width * PX_PER_TWIP, A4.pageSize.height * PX_PER_TWIP];
  pages.forEach((p, i) => {
    const [width, height] = (i < narrow ? narrowSize : a4Size) as [number, number];
    expect(p.width, `page ${i} width`).toBeCloseTo(width, 0);
    // A page no taller than its sheet, its content inside its margins (a line's rounding aside).
    expect(p.height, `page ${i} height`).toBeCloseTo(height, 0);
    expect(p.overflow, `page ${i} overflow`).toBeLessThan(2);
    // A page the section's text goes on from is filled (less than two lines of room left).
    const next = pages[i + 1];
    if (next && i + 1 !== narrow) expect(p.room, `page ${i} room`).toBeLessThan(40);
  });
}

test("each section's pages have its setup, and its text is split in its width", async ({
  page,
}) => {
  const first = paragraph(words(500, "narrow"), NARROW);
  const second = paragraph(words(3000, "wide"));
  const pages = await loadAndRead(page, [first, second]);
  const narrow = pages.filter((p) => p.text.includes("narrow")).length;
  // Measured in the narrow page's width: split over several pages, none overflowing, even
  // before anything re-flowed.
  expect(narrow).toBeGreaterThan(2);
  expect(pages.length).toBeGreaterThan(narrow + 1);
  expect(pages[narrow]?.text.startsWith("wide")).toBe(true);
  expectLaidOut(pages, narrow);
  // And once settled.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  expectLaidOut(await readPages(page), narrow);
});

test("typing in a section keeps its pages; deleting its break joins the sections", async ({
  page,
}) => {
  await loadAndRead(page, [paragraph(words(30, "narrow"), NARROW), paragraph("wide")]);
  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("Typed ");
  let pages = await readPages(page);
  expect(pages[0]?.text.startsWith("Typed narrow")).toBe(true);
  const narrow = pages.filter((p) => p.text.includes("narrow")).length;
  expectLaidOut(pages, narrow);
  // Delete at the end of the section's last paragraph removes its mark, and with it the
  // section break (as in Word): one section, on A4.
  await page.keyboard.press("ControlOrMeta+End");
  const endOfFirst = await page.evaluate(() => {
    const { doc } = window.foliEdit.editor.state;
    return (doc.firstChild?.nodeSize ?? 2) - 1;
  });
  await page.evaluate((pos) => window.foliEdit.editor.select(pos), endOfFirst);
  await page.keyboard.press("Delete");
  pages = await readPages(page);
  expect(pages.map((p) => p.text).join("")).toContain("narrowwide");
  expect(pages).toHaveLength(1);
  expectLaidOut(pages, 0);
});
