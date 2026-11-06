import { expect, test } from "@playwright/test";
import { FIXTURES, openFixture } from "./fixtures.js";

const PT_PER_MM = 72 / 25.4;

/** The pages of a PDF and each one's size in points (`/MediaBox`), from its uncompressed objects. */
function pdfPages(pdf: Buffer): { width: number; height: number }[] {
  const text = pdf.toString("latin1");
  const pages = [...text.matchAll(/\/Type\s*\/Page(?![s\w])[\s\S]*?\/MediaBox\s*\[([^\]]+)\]/g)];
  return pages.map((match) => {
    const [x0, y0, x1, y1] = (match[1] ?? "").trim().split(/\s+/).map(Number);
    return { width: (x1 ?? 0) - (x0 ?? 0), height: (y1 ?? 0) - (y0 ?? 0) };
  });
}

// Only Chromium prints to PDF in Playwright.
test.skip(({ browserName }) => browserName !== "chromium", "page.pdf() is Chromium-only");

for (const fixture of FIXTURES) {
  test(`fixture "${fixture.name}" prints one sheet of its page size per page`, async ({ page }) => {
    await openFixture(page, fixture);
    const screenPages = await page.locator(".foli-page").count();
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const sheets = pdfPages(pdf);
    expect(sheets).toHaveLength(screenPages);
    const { width, height } = fixture.settings.pageSize;
    for (const sheet of sheets) {
      expect(sheet.width).toBeCloseTo(width * PT_PER_MM, 0);
      expect(sheet.height).toBeCloseTo(height * PT_PER_MM, 0);
    }
  });
}
