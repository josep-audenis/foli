/**
 * Pagination benchmarks (Phase 5.7): initial layout, keystroke-to-paint and full re-flow for
 * documents of 1 to 200 pages, in each engine. Not part of `pnpm check` or `pnpm test:e2e`:
 * run with `pnpm bench:layout` and read docs/benchmarks.md for the method.
 */
import { expect, test } from "@playwright/test";
import { benchDocument, loadTestFont, routeTestFont } from "../e2e/fixtures.js";

const SIZES = [1, 10, 50, 100, 200];
const MOUNTS = 5;
const TYPED = "the quick brown fox jumps over the lazy dog ".repeat(2);
const ENTERS = 10;
const REFLOWS = 5;

const median = (values: number[]) => percentile(values, 50);
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}
const round = (value: number) => Math.round(value * 10) / 10;

test.describe.configure({ mode: "serial" });

for (const sections of SIZES) {
  test(`${sections}-section document`, async ({ page, browserName }) => {
    test.setTimeout(600_000);
    await routeTestFont(page);
    await page.goto("/bench.html");
    await loadTestFont(page);
    const json = benchDocument(sections);

    const mounts: { layoutMs: number; paintMs: number; pages: number }[] = [];
    for (let i = 0; i < MOUNTS; i++) {
      mounts.push(await page.evaluate((doc) => window.foliBench.mount(doc), json));
    }
    const pages = mounts[0]?.pages ?? 0;
    expect(mounts.every((mount) => mount.pages === pages)).toBe(true);

    // Into the first paragraph of page 1: everything after it may move.
    await page
      .locator('[role="textbox"] p')
      .first()
      .click({ position: { x: 2, y: 4 } });
    const keys = async (press: () => Promise<void>, count: number) => {
      const samples: { handlerMs: number; paintMs: number }[] = [];
      for (let i = 0; i < count; i++) {
        // Real keys arrive at any point of a frame; pressed right after a paint they would
        // always wait a whole frame. 40-56 ms apart, about a fast typist's pace.
        await page.waitForTimeout(40 + ((i * 7) % 17));
        await press();
        samples.push(await page.evaluate(() => window.foliBench.lastKey()));
      }
      return samples;
    };
    let typedChars = 0;
    const typed = await keys(() => page.keyboard.type(TYPED[typedChars++] ?? ""), TYPED.length);
    const enters = await keys(() => page.keyboard.press("Enter"), ENTERS);

    const reflows: number[] = [];
    for (let i = 0; i < REFLOWS; i++) {
      reflows.push((await page.evaluate(() => window.foliBench.reflow())).ms);
    }

    const paint = (samples: { paintMs: number }[]) => samples.map((sample) => sample.paintMs);
    const handler = (samples: { handlerMs: number }[]) => samples.map((s) => s.handlerMs);
    const result = {
      browser: browserName,
      sections,
      pages,
      layoutMs: round(median(mounts.map((mount) => mount.layoutMs))),
      layoutPaintMs: round(median(mounts.map((mount) => mount.paintMs))),
      typeHandlerP50: round(median(handler(typed))),
      typePaintP50: round(median(paint(typed))),
      typePaintP95: round(percentile(paint(typed), 95)),
      enterHandlerP50: round(median(handler(enters))),
      enterPaintP50: round(median(paint(enters))),
      enterPaintP95: round(percentile(paint(enters), 95)),
      reflowMs: round(median(reflows)),
    };
    console.log(`BENCH ${JSON.stringify(result)}`);
    test.info().annotations.push({ type: "bench", description: JSON.stringify(result) });
  });
}
