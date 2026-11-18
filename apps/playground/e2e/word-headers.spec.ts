/**
 * Headers and footers in the editable view (11.7), on the editing page (`/edit.html`): laid out in
 * their margins on every page, with their variants and page fields.
 */
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const PX_PER_TWIP = 96 / 1440;

const A5 = {
  pageSize: { width: 8391, height: 11906 },
  margins: { top: 1440, right: 1000, bottom: 1440, left: 1000, header: 500, footer: 400 },
};
const text = (value: string): Json => ({ type: "text", text: value });
const paragraph = (value: string, attrs?: Json): Json => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  ...(value ? { content: [text(value)] } : {}),
});
const pageBreak = (value: string): Json => ({
  type: "paragraph",
  content: [text(value), { type: "pageBreak" }],
});
/** A field as Word has it, `shown` being what the file stores as its result. */
const field = (code: string, shown: string): Json[] => [
  { type: "fieldStart" },
  { type: "fieldCode", attrs: { text: ` ${code} ` } },
  { type: "fieldSeparator" },
  text(shown),
  { type: "fieldEnd" },
];
const story = (kind: "header" | "footer", ...blocks: Json[]): Json => ({
  kind,
  content: { type: "doc", content: blocks },
});
const documentOf = (blocks: Json[], section: Json, more: Json = {}): Json => ({
  schemaVersion: 5,
  section,
  defaults: { paragraph: { spacing: { after: 0 } } },
  styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: { type: "doc", content: blocks },
  ...more,
});

async function load(page: Page, document: Json) {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), document);
}

interface PageInfo {
  header: string | null;
  footer: string | null;
  /** From the page's top to its header's top and to its text's top. */
  headerTop: number | null;
  textTop: number;
  /** From the page's bottom to its footer's bottom and to where its text may end. */
  footerBottom: number | null;
  textBottom: number;
}
const pages = (page: Page): Promise<PageInfo[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("section.foli-page")].map((p) => {
      const box = p.getBoundingClientRect();
      const style = getComputedStyle(p);
      const content = (name: string) =>
        p.querySelector<HTMLElement>(`:scope > .foli-${name} > .foli-region-content`);
      const header = content("header");
      const footer = content("footer");
      return {
        header: header?.textContent ?? null,
        footer: footer?.textContent ?? null,
        headerTop: header ? header.getBoundingClientRect().top - box.top : null,
        textTop: Number.parseFloat(style.paddingTop),
        footerBottom: footer ? box.bottom - footer.getBoundingClientRect().bottom : null,
        textBottom: Number.parseFloat(style.paddingBottom),
      };
    }),
  );

test("every page has its header and footer in its margins, its fields filled", async ({ page }) => {
  const section = { ...A5, headers: { default: "h" }, footers: { default: "f" } };
  await load(
    page,
    documentOf([pageBreak("one"), pageBreak("two"), paragraph("three")], section, {
      stories: {
        h: story("header", paragraph("Running head")),
        f: story("footer", {
          type: "paragraph",
          content: [
            text("Page "),
            ...field("PAGE", "9"),
            text(" of "),
            ...field("NUMPAGES", "9"),
            text(" / "),
            ...field("SECTIONPAGES \\* roman", "9"),
          ],
        }),
      },
    }),
  );
  const shown = await pages(page);
  expect(shown.map((p) => [p.header, p.footer])).toEqual([
    ["Running head", "Page 1 of 3 / iii"],
    ["Running head", "Page 2 of 3 / iii"],
    ["Running head", "Page 3 of 3 / iii"],
  ]);
  for (const p of shown) {
    expect(p.headerTop).toBeCloseTo(500 * PX_PER_TWIP, 0);
    expect(p.footerBottom).toBeCloseTo(400 * PX_PER_TWIP, 0);
    expect(p.textTop).toBeCloseTo(1440 * PX_PER_TWIP, 0);
  }
  // The fields' stored results stay as they were.
  const stored = await page.evaluate(() =>
    JSON.stringify(window.foliEdit.editor.getDocument().stories),
  );
  expect(stored).not.toContain("iii");
  expect(stored).toContain('"text":"9"');
});

test("first, even and default variants; a section inherits what it does not have", async ({
  page,
}) => {
  const first = {
    ...A5,
    titlePage: true,
    headers: { default: "d", first: "t", even: "e" },
    footers: { even: "fe" },
  };
  // Restarts at 10: its first page is even, and not the first variant (no different first page).
  const second = { ...A5, pageNumbers: { start: 10 } };
  await load(
    page,
    documentOf(
      [
        pageBreak("1"),
        pageBreak("2"),
        paragraph("3", { section: first }),
        pageBreak("4"),
        paragraph("5"),
      ],
      second,
      {
        settings: { evenAndOddHeaders: true },
        stories: {
          d: story("header", paragraph("default")),
          t: story("header", paragraph("title")),
          e: story("header", paragraph("even")),
          fe: story("footer", paragraph("even foot")),
        },
      },
    ),
  );
  expect((await pages(page)).map((p) => [p.header, p.footer])).toEqual([
    ["title", null],
    ["even", "even foot"],
    ["default", null],
    ["even", "even foot"],
    ["default", null],
  ]);
});

test("a header or footer taller than its margin pushes the text, page by page", async ({
  page,
}) => {
  const lines = (n: number, value: string) =>
    Array.from({ length: n }, (_, i) => paragraph(`${value} ${i + 1}`));
  const section = { ...A5, titlePage: true, headers: { first: "t" }, footers: { first: "b" } };
  const blocks = Array.from({ length: 80 }, (_, i) => paragraph(`Line ${i}`));
  await load(
    page,
    documentOf(blocks, section, {
      stories: {
        t: story("header", ...lines(8, "head")),
        b: story("footer", ...lines(8, "foot")),
      },
    }),
  );
  const [one, two] = await pages(page);
  const text = (top: number, bottom: number) => 11906 * PX_PER_TWIP - top - bottom;
  expect(one?.textTop).toBeGreaterThan(1440 * PX_PER_TWIP + 10);
  expect(one?.textBottom).toBeGreaterThan(1440 * PX_PER_TWIP + 10);
  // The first page's text is shorter, so it holds fewer lines; the next has the plain margins.
  expect(two?.textTop).toBeCloseTo(1440 * PX_PER_TWIP, 0);
  expect(text(two?.textTop ?? 0, two?.textBottom ?? 0)).toBeGreaterThan(
    text(one?.textTop ?? 0, one?.textBottom ?? 0),
  );
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("section.foli-page")].map((p) => {
      const blocks = [...p.children].filter((c) => !c.classList.contains("foli-region"));
      const bottom =
        p.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(p).paddingBottom);
      return (blocks.at(-1)?.getBoundingClientRect().bottom ?? 0) - bottom;
    }),
  );
  for (const over of overflow) expect(over).toBeLessThanOrEqual(1);
  // The text starts where the page says, below the header.
  const inPlace = await page.evaluate(() => {
    const first = document.querySelector<HTMLElement>("section.foli-page") as HTMLElement;
    const header = first.querySelector(".foli-header .foli-region-content") as HTMLElement;
    const text = [...first.children].find((c) => !c.classList.contains("foli-region"));
    return (text?.getBoundingClientRect().top ?? 0) - header.getBoundingClientRect().bottom;
  });
  expect(Math.abs(inPlace)).toBeLessThanOrEqual(1);
  await expect(editor(page)).toContainText("Line 79");
});
