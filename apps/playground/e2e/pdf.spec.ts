/**
 * PDF (11.12): `exportPdf` (`@folijs/pdf`, built: `pnpm build`) run from Node through a page of
 * this run's Chromium, its PDF read back by pdf.js on the Word pages page (`/word.html`, its
 * `readPdf`): pages, sizes, text, the outline and links. And the editor's print gives the same
 * pages. Chromium only: `page.pdf()` is Chromium's.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { importDocx } from "@folijs/docx";
import { exportPdf } from "@folijs/pdf";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
type Json = Record<string, unknown>;

interface PdfContents {
  pages: { width: number; height: number; text: string }[];
  outline: { title: string; depth: number }[];
  links: { page: number; url: string | null; internal: boolean }[];
}

/** What pdf.js reads in `pdf`. */
async function read(page: Page, pdf: Uint8Array): Promise<PdfContents> {
  await page.goto("/word.html");
  await page.waitForFunction(() => "foliWord" in window);
  return page.evaluate(
    (data) =>
      (
        window as unknown as { foliWord: { readPdf(d: string): Promise<PdfContents> } }
      ).foliWord.readPdf(data),
    Buffer.from(pdf).toString("base64"),
  );
}

const words = (text: string) => text.replace(/\s+/g, " ").trim();

async function exportCorpus(context: BrowserContext, name: string) {
  const { document, package: pkg } = await importDocx(
    new Uint8Array(readFileSync(new URL(name, CORPUS))),
  );
  const printing = await context.newPage();
  const exported = await exportPdf(document, {
    page: printing,
    resources: (_key, resource) => (resource.part ? pkg.part(`/${resource.part}`) : undefined),
  });
  await printing.close();
  return exported;
}

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== "chromium", "page.pdf() is Chromium's");
});

test("04 exported: Word's four pages, the landscape one too, its text and headings as bookmarks", async ({
  page,
  context,
}) => {
  const exported = await exportCorpus(context, "04-board-report.docx");
  expect(exported.pages).toBe(4);
  // Every field already shows what Foli's pages give: the table of contents' page numbers too.
  expect(exported.fields).toMatchObject({ updated: 0, skipped: [] });
  const pdf = await read(page, exported.pdf);
  expect(pdf.pages.map((p) => [Math.round(p.width), Math.round(p.height)])).toEqual([
    [595, 842],
    [595, 842],
    [595, 842],
    [842, 595],
  ]);
  const text = pdf.pages.map((p) => words(p.text));
  expect(text[0]).toContain("Quarterly Board Report");
  expect(text[1]).toContain("Contents");
  expect(text[1]).toContain("Page 2 of 4");
  expect(text[2]).toContain("Revenue grew by 14%");
  // The footnotes at the page's foot.
  expect(text[2]).toContain("Operating margin before exceptional items");
  expect(text[3]).toContain("Appendix: capital expenditure");
  expect(text[3]).toContain("Page 4 of 4");
  expect(pdf.outline).toEqual([
    { title: "Executive summary", depth: 0 },
    { title: "Trading performance", depth: 0 },
    { title: "Sales by region", depth: 1 },
    { title: "Costs", depth: 1 },
    { title: "Staff costs", depth: 2 },
    { title: "Decisions requested", depth: 0 },
    { title: "Appendix: capital expenditure", depth: 0 },
  ]);
});

test("a document makes the exporting page request nothing: no picture, font or style URL", async ({
  context,
}) => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const local = (path: string) => `http://127.0.0.1:${port}/${path}`;
  const picture = (resource: string) => ({
    type: "picture",
    attrs: { resource, width: 914400, height: 457200 },
  });
  const document = {
    schemaVersion: 5,
    section: { pageSize: { width: 11906, height: 16838 } },
    defaults: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    resources: {
      own: { contentType: "image/png", url: local("own.png") },
      given: { contentType: "image/png", part: "word/media/image1.png" },
    },
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [picture("own"), picture("given")] }],
    },
  };
  const printing = await context.newPage();
  try {
    const exported = await exportPdf(document as never, {
      page: printing,
      // A URL given for a picture is refused as the document's own is.
      resources: (key) => (key === "given" ? local("given.png") : undefined),
      styles: `@import url("${local("import.css")}"); @font-face { font-family: X; src: url("${local("font.ttf")}"); } body { background: url("${local("bg.png")}"); font-family: X; }`,
    });
    expect(exported.pages).toBe(1);
  } finally {
    await printing.close();
    await new Promise((resolve) => server.close(resolve));
  }
  expect(requests).toEqual([]);
});

test("custom nodes and marks print with the app's extensions (19.3)", async ({ page, context }) => {
  const document = {
    schemaVersion: 5,
    section: {},
    styles: [{ id: "Normal", type: "paragraph", name: "Normal", isDefault: true }],
    defaults: {},
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ask " },
            { type: "acme:mention", attrs: { label: "Ada" } },
          ],
        },
        { type: "acme:card", attrs: { id: "c-1" } },
      ],
    },
  };
  // The app's own code, bundled for the page: plain objects, no module of Foli's.
  const extensions = `globalThis.foliPdfExtensions = [{
    name: "acme",
    nodes: {
      "acme:mention": { inline: true, attrs: { label: {} }, text: (a) => "@" + a.label },
      "acme:card": { attrs: { id: {} }, text: (a) => "Card " + a.id },
    },
    nodeViews: {
      "acme:mention": { render: (node, { h }) => h("b", null, "Mention of " + node.attrs.label) },
      "acme:card": { render: (node, { h }) => h("div", null, h("p", null, "Drawn card " + node.attrs.id)) },
    },
  }];`;
  const printing = await context.newPage();
  const drawn = await exportPdf(document as never, { page: printing, extensions });
  const plain = await exportPdf(document as never, { page: printing });
  await printing.close();
  const text = words((await read(page, drawn.pdf)).pages[0]?.text ?? "");
  expect(text).toContain("Ask Mention of Ada");
  expect(text).toContain("Drawn card c-1");
  expect(words((await read(page, plain.pdf)).pages[0]?.text ?? "")).not.toContain("Mention of");
});

test("fields are updated from the pages first; links are links, internal ones too", async ({
  page,
  context,
}) => {
  const text = (value: string, marks?: Json[]): Json => ({
    type: "text",
    text: value,
    ...(marks ? { marks } : {}),
  });
  const link = (href: string | null, anchor: string | null = null): Json[] => [
    { type: "link", attrs: { href, anchor } },
  ];
  const document = {
    schemaVersion: 5,
    section: {
      pageSize: { width: 11906, height: 16838 },
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
    styles: [
      { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
      {
        id: "Heading1",
        type: "paragraph",
        name: "heading 1",
        basedOn: "Normal",
        paragraph: { outlineLevel: 0 },
      },
    ],
    defaults: {},
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            text("See the "),
            text("site", link("https://example.com/")),
            text(", the "),
            text("terms", link(null, "terms")),
            text(" and "),
            text("this", link("javascript:alert(1)")),
            text(" or "),
            text("that", link("relative/page.html")),
            { type: "pageBreak" },
          ],
        },
        {
          type: "paragraph",
          attrs: { style: "Heading1" },
          content: [
            { type: "bookmarkStart", attrs: { id: 1, name: "terms" } },
            text("Terms"),
            { type: "bookmarkEnd", attrs: { id: 1 } },
          ],
        },
        {
          type: "paragraph",
          content: [
            text("This is page "),
            { type: "fieldStart" },
            { type: "fieldCode", attrs: { text: " PAGE " } },
            { type: "fieldSeparator" },
            text("9"),
            { type: "fieldEnd" },
            text(" of "),
            { type: "fieldStart" },
            { type: "fieldCode", attrs: { text: " NUMPAGES " } },
            { type: "fieldSeparator" },
            text("9"),
            { type: "fieldEnd" },
            text("."),
          ],
        },
      ],
    },
  };
  const printing = await context.newPage();
  const exported = await exportPdf(document as never, { page: printing });
  await printing.close();
  expect(exported.fields.updated).toBe(2);
  const pdf = await read(page, exported.pdf);
  expect(pdf.pages).toHaveLength(2);
  expect(words(pdf.pages[1]?.text ?? "")).toContain("This is page 2 of 2.");
  // The web link and the bookmark's; a script, or a relative target, is no link.
  expect(pdf.links).toEqual([
    { page: 1, url: "https://example.com/", internal: false },
    { page: 1, url: null, internal: true },
  ]);
  expect(pdf.outline).toEqual([{ title: "Terms", depth: 0 }]);
});

/**
 * Where the editing renderer draws differently from the read-only one, the pages are the same but
 * their ink is not: a table's header rows repeated on a continuation page are plain text in the
 * editor (its shortcut, `table.ts`), and the editor draws change bars beside tracked changes.
 */
const DRAWN_OTHERWISE = new Set(["02-services-agreement-redlined.docx", "06-price-schedule.docx"]);
/**
 * Where a paragraph continues in a column of another width, the read-only renderer can repeat or
 * lose a few words (its shortcut, 11.6): 08's PDF shows "the floor" twice.
 */
const WORDS_OTHERWISE = new Set(["08-newsletter.docx"]);

for (const name of readdirSync(CORPUS).filter((n) => n.endsWith(".docx")))
  test(`${name}: the editor's print gives the pages exportPdf gives`, async ({ page, context }) => {
    const exported = await exportCorpus(context, name);
    await page.goto("/edit.html?toolbar");
    await page.waitForFunction(() => "foliEdit" in window);
    await page.evaluate(
      (data) => window.foliEdit.loadDocx(data),
      readFileSync(new URL(name, CORPUS)).toString("base64"),
    );
    await page.locator(".foli-page").first().waitFor();
    // The playground's own page around the editor is not printed (styling.md, "Print").
    await page.addStyleTag({
      content:
        "@media print{header,#toolbar,#navigation,#comments{display:none!important}#editor{display:block!important;padding:0!important}}",
    });
    // What `view.print()` does before the browser's dialog.
    await page.evaluate(() => window.foliEdit.view.updateFields());
    const printed = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const fromEditor = await read(page, printed);
    const fromExport = await read(page, exported.pdf);
    // Each page's size and characters (the text's order differs: the editor draws footers last).
    const shape = (pdf: PdfContents) =>
      pdf.pages.map((p) => ({
        size: [Math.round(p.width), Math.round(p.height)],
        text: WORDS_OTHERWISE.has(name) ? "" : [...p.text.replace(/\s/g, "")].sort().join(""),
      }));
    expect(shape(fromEditor)).toEqual(shape(fromExport));
    if (DRAWN_OTHERWISE.has(name)) return;
    // The same ink where it falls.
    const { compared } = await page.evaluate(
      ([a, b]) =>
        (
          window as unknown as {
            foliWord: {
              comparePdfs(
                a: string,
                b: string,
              ): Promise<{ compared: { page: { score: number } }[] }>;
            };
          }
        ).foliWord.comparePdfs(a, b),
      [Buffer.from(printed).toString("base64"), Buffer.from(exported.pdf).toString("base64")],
    );
    for (const { page: score } of compared) expect(score.score).toBeGreaterThan(0.995);
  });
