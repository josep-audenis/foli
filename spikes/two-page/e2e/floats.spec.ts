/**
 * Phase 10.9 spike (ADR-0006, "Floating pictures"): what browsers do natively with floating
 * pictures as CSS floats inside one contenteditable host. Each experiment measures lines and
 * carets around the floats; the asserted facts are the ones ADR-0006's decision rests on, the
 * rest is written to the test output.
 */
import { expect, type Page, test } from "@playwright/test";

type Rect = { left: number; right: number; top: number; bottom: number };

/** The line boxes of a paragraph's text (one rect per line, from its text nodes). */
const lines = (page: Page, id: string) =>
  page.evaluate((target) => {
    const p = document.getElementById(target) as HTMLElement;
    const out: Rect[] = [];
    for (const node of p.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects())
        out.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    return out;
  }, id);

const rectOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const r = (document.querySelector(s) as HTMLElement).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }, selector);

/** The caret's rect and the paragraph holding it. */
const caret = (page: Page) =>
  page.evaluate(() => {
    const sel = getSelection() as Selection;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    let r = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) {
      // A caret at a text node's end has no rect in some engines: the character before it.
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
        const before = document.createRange();
        before.setStart(node, range.startOffset - 1);
        before.setEnd(node, range.startOffset);
        const b = before.getClientRects()[0] as DOMRect;
        r = new DOMRect(b.right, b.top, 0, b.height);
      }
    }
    const node = sel.focusNode as Node;
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    return {
      id: element?.closest("p")?.id ?? null,
      offset: sel.focusOffset,
      left: r.left,
      top: r.top,
      bottom: r.bottom,
    };
  });

const overlapsVertically = (a: Rect, b: Rect) => a.top < b.bottom - 1 && a.bottom > b.top + 1;
const inside = (x: number, y: number, r: Rect) =>
  x > r.left + 1 && x < r.right - 1 && y > r.top + 1 && y < r.bottom - 1;

/** The caret in paragraph `id`'s first text node at `offset`. */
async function caretAt(page: Page, id: string, offset: number) {
  await page.evaluate(
    ([target, at]) => {
      const p = document.getElementById(target as string) as HTMLElement;
      const text = [...p.childNodes].find((n) => n.nodeType === Node.TEXT_NODE) as Text;
      getSelection()?.collapse(text, at as number);
    },
    [id, offset] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/floats.html");
  await page.locator("#editor").focus();
});

test("lines beside a square-wrapped float are shortened, in its paragraph and the next", async ({
  page,
}, info) => {
  const float = await rectOf(page, "#square .picture");
  const beside = [...(await lines(page, "anchor")), ...(await lines(page, "below"))].filter((l) =>
    overlapsVertically(l, float),
  );
  info.annotations.push({ type: "observed", description: JSON.stringify({ float, beside }) });
  expect(beside.length).toBeGreaterThan(0);
  // No text over the picture: every line beside it starts after its right edge (and margin).
  for (const line of beside) expect(line.left).toBeGreaterThanOrEqual(float.right);
  // Offset down by the spacer: the picture starts 24px under its paragraph's top.
  const paragraph = await rectOf(page, "#anchor");
  expect(Math.round(float.top - paragraph.top)).toBe(24);
});

test("ArrowDown walks the lines beside the float, never into it", async ({ page }, info) => {
  const float = await rectOf(page, "#square .picture");
  await caretAt(page, "above", 3);
  const seen: string[] = [];
  let reached = false;
  for (let i = 0; i < 14 && !reached; i++) {
    await page.keyboard.press("ArrowDown");
    const at = await caret(page);
    seen.push(`${at.id}:${at.offset}@${Math.round(at.top)}`);
    expect(inside(at.left, (at.top + at.bottom) / 2, float)).toBe(false);
    reached = at.id === "tb" || at.id === "behindp";
  }
  info.annotations.push({ type: "observed", description: seen.join(" -> ") });
  expect(reached).toBe(true);
});

test("a click beside the float puts the caret on that line", async ({ page }, info) => {
  const float = await rectOf(page, "#square .picture");
  const line = (await lines(page, "anchor")).find((l) => overlapsVertically(l, float)) as Rect;
  await page.mouse.click(line.left + 30, (line.top + line.bottom) / 2);
  const at = await caret(page);
  info.annotations.push({ type: "observed", description: JSON.stringify(at) });
  expect(at.id).toBe("anchor");
  expect(Math.abs(at.top - line.top)).toBeLessThan(4);
});

test("Home on a line beside the float goes to its start, after the float", async ({
  page,
}, info) => {
  const float = await rectOf(page, "#square .picture");
  const line = (await lines(page, "anchor")).find((l) => overlapsVertically(l, float)) as Rect;
  await page.mouse.click(line.left + 60, (line.top + line.bottom) / 2);
  await page.keyboard.press("Home");
  const at = await caret(page);
  // The character after the caret: a collapsed caret at a soft line break reports the previous
  // line's end in Firefox (the same offset is both).
  const next = await page.evaluate(() => {
    const sel = getSelection() as Selection;
    const range = document.createRange();
    range.setStart(sel.focusNode as Node, sel.focusOffset);
    range.setEnd(sel.focusNode as Node, sel.focusOffset + 1);
    const r = range.getClientRects()[0] as DOMRect;
    return { left: r.left, top: r.top };
  });
  info.annotations.push({ type: "observed", description: JSON.stringify({ at, next }) });
  expect(next.left).toBeGreaterThanOrEqual(float.right - 1);
  expect(Math.abs(next.top - line.top)).toBeLessThan(4);
});

test("typing beside the float leaves it in place", async ({ page }) => {
  const before = await rectOf(page, "#square .picture");
  await caretAt(page, "anchor", 10);
  await page.keyboard.type("XYZ ");
  const after = await rectOf(page, "#square .picture");
  expect(after).toEqual(before);
  const beside = (await lines(page, "anchor")).filter((l) => overlapsVertically(l, after));
  for (const line of beside) expect(line.left).toBeGreaterThanOrEqual(after.right);
});

test("no line goes beside a top-and-bottom float", async ({ page }) => {
  const float = await rectOf(page, "#topbottom");
  const beside = [...(await lines(page, "tb")), ...(await lines(page, "behindp"))].filter((l) =>
    overlapsVertically(l, float),
  );
  expect(beside).toEqual([]);
});

test("a picture behind text leaves the lines at full width", async ({ page }) => {
  const picture = await rectOf(page, "#behind .picture");
  const column = await rectOf(page, "#behindp");
  const over = (await lines(page, "behindp")).filter((l) => overlapsVertically(l, picture));
  for (const line of over) expect(Math.abs(line.left - column.left)).toBeLessThan(2);
});
