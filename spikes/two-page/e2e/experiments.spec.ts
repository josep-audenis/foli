import { expect, type Page, test } from "@playwright/test";
import type { SpikeEditor } from "../src/editor.js";
import type { Fragment } from "../src/layout.js";
import type { Pos, Sel } from "../src/model.js";

interface SpikeHooks {
  editor: SpikeEditor;
  initialLayoutMs: number;
  state(): { paras: string[]; sel: Sel };
  fragments(): (Fragment & { page: number })[];
  domSelection(): Sel | null;
  lastUpdateMs(): number;
  warnings(): string[];
}
declare global {
  interface Window {
    __spike: SpikeHooks;
  }
}

async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__spike !== undefined);
}

/** First paragraph that is split across a page boundary: [para, offset where page 2 starts]. */
async function splitPoint(page: Page): Promise<{ para: number; split: number; text: string }> {
  return page.evaluate(() => {
    const f = window.__spike.fragments().find((x) => x.continues);
    if (!f) throw new Error("no split paragraph");
    return { para: f.para, split: f.end, text: window.__spike.state().paras[f.para] as string };
  });
}

const select = (page: Page, anchor: Pos, head: Pos = anchor) =>
  page.evaluate(([a, h]) => window.__spike.editor.select(a, h), [anchor, head] as const);
const state = (page: Page) => page.evaluate(() => window.__spike.state());
const domSelection = (page: Page) => page.evaluate(() => window.__spike.domSelection());

/** After native caret movement the model syncs on the async `selectionchange`; wait for it. */
async function settledSel(page: Page): Promise<Sel> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.stringify(window.__spike.state().sel) ===
          JSON.stringify(window.__spike.domSelection()),
      ),
    )
    .toBe(true);
  return (await state(page)).sel;
}

/** Viewport point at the left edge of the character at pos, after scrolling it into view. */
async function charPoint(page: Page, pos: Pos, centerOn?: Pos): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([p, c]) => {
      const editor = window.__spike.editor;
      const rectOf = (q: Pos) => {
        const { node, offset } = editor.modelToDom(q);
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        return range.getBoundingClientRect();
      };
      if (c) {
        const mid = (rectOf(p).top + rectOf(c).top) / 2 + window.scrollY;
        window.scrollTo(0, mid - window.innerHeight / 2);
      }
      const r = rectOf(p);
      return { x: r.left + 1, y: r.top + r.height / 2 };
    },
    [pos, centerOn ?? null] as const,
  );
}

async function caretX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const range = document.getSelection()?.getRangeAt(0);
    const rect = range?.getClientRects()[0] ?? range?.getBoundingClientRect();
    return rect ? rect.left : Number.NaN;
  });
}

/** Every page's content fits its body, and every fragment renders exactly its measured lines. */
async function expectLayoutConsistent(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const { editor } = window.__spike;
    const issues: string[] = [];
    const lineHeight = Number.parseFloat(
      getComputedStyle(editor.host.querySelector("p.frag") as Element).lineHeight,
    );
    editor.host.querySelectorAll(".page").forEach((pageEl, i) => {
      const body = (pageEl.querySelector(".page-body") as HTMLElement).getBoundingClientRect();
      const frags = [...pageEl.querySelectorAll<HTMLElement>("p.frag")];
      const last = frags[frags.length - 1]?.getBoundingClientRect();
      if (last && last.bottom > body.bottom + 1)
        issues.push(`page ${i} overflows by ${last.bottom - body.bottom}px`);
      frags.forEach((el, j) => {
        const f = editor.pages[i]?.[j];
        if (!f) return;
        const starts = editor.lineStarts(editor.paras[f.para] as string);
        const lines = Math.max(1, starts.filter((s) => s >= f.start && s < f.end).length);
        const rendered = Math.round(el.getBoundingClientRect().height / lineHeight);
        if (rendered !== lines)
          issues.push(`page ${i} frag ${j}: rendered ${rendered} lines, measured ${lines}`);
      });
    });
    return issues;
  });
  expect(problems).toEqual([]);
}

test.describe("E1 typing reflows across the page boundary", () => {
  test("typing before the split keeps caret and layout correct", async ({ page }) => {
    await open(page);
    const { para, split, text } = await splitPoint(page);
    await select(page, { p: para, o: split - 1 });
    await page.keyboard.type("XYZ ");
    const s = await state(page);
    expect(s.paras[para]).toBe(`${text.slice(0, split - 1)}XYZ ${text.slice(split - 1)}`);
    expect(s.sel.head).toEqual({ p: para, o: split + 3 });
    expect(await domSelection(page)).toEqual(s.sel);
    await expectLayoutConsistent(page);
  });

  test("typing on page 1 pushes lines onto page 2", async ({ page }) => {
    await open(page);
    const before = await splitPoint(page);
    await select(page, { p: 0, o: 0 });
    await page.keyboard.type("Lorem ipsum dolor sit amet, ".repeat(6));
    const after = await splitPoint(page);
    expect(after.para === before.para ? after.split : -1).not.toBe(before.split);
    const s = await state(page);
    expect(s.sel.head).toEqual({ p: 0, o: 168 });
    expect(await domSelection(page)).toEqual(s.sel);
    await expectLayoutConsistent(page);
  });
});

test.describe("E2 selection across the page boundary", () => {
  test("mouse drag across pages, delete, undo", async ({ page }) => {
    await open(page);
    const { para, split, text } = await splitPoint(page);
    const from = { p: para, o: split - 20 };
    const to = { p: para, o: split + 20 };
    const a = await charPoint(page, from, to);
    const b = await charPoint(page, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    const s = { sel: await settledSel(page) };
    expect(s.sel.anchor).toEqual(from);
    expect(s.sel.head).toEqual(to);
    await page.keyboard.press("Backspace");
    expect((await state(page)).paras[para]).toBe(
      text.slice(0, split - 20) + text.slice(split + 20),
    );
    await expectLayoutConsistent(page);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).paras[para]).toBe(text);
  });

  test("Shift+Arrow selection across pages, delete, undo", async ({ page }) => {
    await open(page);
    const { para, split, text } = await splitPoint(page);
    await select(page, { p: para, o: split - 5 });
    for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+ArrowRight");
    expect(await settledSel(page)).toEqual({
      anchor: { p: para, o: split - 5 },
      head: { p: para, o: split + 5 },
    });
    await page.keyboard.press("Delete");
    expect((await state(page)).paras[para]).toBe(text.slice(0, split - 5) + text.slice(split + 5));
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).paras[para]).toBe(text);
    await expectLayoutConsistent(page);
  });

  test("Shift+ArrowDown extends the selection onto the next page", async ({ page }) => {
    await open(page);
    const { para, split } = await splitPoint(page);
    await select(page, { p: para, o: split - 5 });
    await page.keyboard.press("Shift+ArrowDown");
    const s = { sel: await settledSel(page) };
    expect(s.sel.anchor).toEqual({ p: para, o: split - 5 });
    expect(s.sel.head.p).toBe(para);
    expect(s.sel.head.o).toBeGreaterThan(split);
  });
});

test.describe("E4 vertical caret movement across the page boundary", () => {
  test("ArrowDown/ArrowUp keep the horizontal position", async ({ page }) => {
    await open(page);
    const { para, split, text } = await splitPoint(page);
    const starts = await page.evaluate((t) => window.__spike.editor.lineStarts(t), text);
    const lastLineStart = Math.max(...starts.filter((s) => s < split));
    const nextLineStart = starts.find((s) => s > split) ?? text.length;
    const start = { p: para, o: lastLineStart + 10 };
    await charPoint(page, start, { p: para, o: split + 10 });
    await select(page, start);
    const x1 = await caretX(page);

    await page.keyboard.press("ArrowDown");
    const down = (await settledSel(page)).head;
    expect(down.p).toBe(para);
    expect(down.o).toBeGreaterThanOrEqual(split);
    expect(down.o).toBeLessThanOrEqual(nextLineStart);
    expect(Math.abs((await caretX(page)) - x1)).toBeLessThan(20);

    await page.keyboard.press("ArrowUp");
    const up = (await settledSel(page)).head;
    expect(up.p).toBe(para);
    expect(Math.abs(up.o - start.o)).toBeLessThanOrEqual(1);
  });
});

test.describe("E3 IME composition (Chromium, CDP)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP IME emulation is Chromium-only");

  test("compose at the end of page 1, commit, undo", async ({ page }) => {
    await open(page);
    const { para, split, text } = await splitPoint(page);
    await select(page, { p: para, o: split - 1 });
    const cdp = await page.context().newCDPSession(page);
    for (const t of ["に", "にほ", "にほん"]) {
      await cdp.send("Input.imeSetComposition", {
        text: t,
        selectionStart: t.length,
        selectionEnd: t.length,
      });
    }
    await cdp.send("Input.insertText", { text: "日本" });
    const s = await state(page);
    expect(s.paras[para]).toBe(`${text.slice(0, split - 1)}日本${text.slice(split - 1)}`);
    expect(s.sel.head).toEqual({ p: para, o: split + 1 });
    expect(await domSelection(page)).toEqual(s.sel);
    await expectLayoutConsistent(page);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).paras[para]).toBe(text);
    expect(await page.evaluate(() => window.__spike.warnings())).toEqual([]);
  });

  test("compose over a selection that spans the page boundary", async ({ page }) => {
    await open(page);
    const { para, split, text } = await splitPoint(page);
    await select(page, { p: para, o: split - 3 }, { p: para, o: split + 3 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "あ", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.insertText", { text: "亜" });
    const s = await state(page);
    expect(s.paras[para]).toBe(`${text.slice(0, split - 3)}亜${text.slice(split + 3)}`);
    expect(s.sel.head).toEqual({ p: para, o: split - 2 });
    await expectLayoutConsistent(page);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).paras[para]).toBe(text);
  });
});

test.describe("E7 performance on a 50-page document", () => {
  test("keystroke update time on page 1", async ({ page }, info) => {
    test.setTimeout(120_000);
    await open(page, "?pages=50");
    const pages = await page.evaluate(() => window.__spike.editor.pages.length);
    const initial = await page.evaluate(() => window.__spike.initialLayoutMs);
    await select(page, { p: 0, o: 0 });
    const samples: number[] = [];
    for (const ch of "the quick brown fox ") {
      await page.keyboard.type(ch);
      samples.push(await page.evaluate(() => window.__spike.lastUpdateMs()));
    }
    samples.sort((a, b) => a - b);
    const result = {
      browser: info.project.name,
      pages,
      initialLayoutMs: Math.round(initial),
      keystrokeMedianMs: Number((samples[samples.length >> 1] as number).toFixed(1)),
      keystrokeMaxMs: Number((samples[samples.length - 1] as number).toFixed(1)),
    };
    info.annotations.push({ type: "E7", description: JSON.stringify(result) });
    console.log("E7", JSON.stringify(result));
    expect(pages).toBeGreaterThanOrEqual(45);
  });
});
