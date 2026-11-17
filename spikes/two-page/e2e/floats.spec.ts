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

/**
 * Where the caret is: its focus node (a text node, outside the floats, or `text: false`), the
 * paragraph holding it, and the rect of the character after it (before it at a text node's
 * end). A collapsed caret at a soft line break reports the previous line's end in Firefox; the
 * character after it is on the line the caret is on.
 */
const caret = (page: Page) =>
  page.evaluate(() => {
    const sel = getSelection() as Selection;
    const node = sel.focusNode as Node;
    const offset = sel.focusOffset;
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    const base = {
      id: element?.closest("p")?.id ?? null,
      offset,
      text: node.nodeType === Node.TEXT_NODE,
      inFloat: !!element?.closest(".float, .spacer, .behind, .front"),
    };
    if (!base.text) return { ...base, left: 0, top: 0, bottom: 0 };
    const length = (node as Text).length;
    const range = document.createRange();
    const after = offset < length;
    range.setStart(node, after ? offset : offset - 1);
    range.setEnd(node, after ? offset + 1 : offset);
    const r = range.getClientRects()[0] as DOMRect;
    return { ...base, left: after ? r.left : r.right, top: r.top, bottom: r.bottom };
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
  const column = await rectOf(page, "#anchor");
  const anchor = await lines(page, "anchor");
  const below = await lines(page, "below");
  info.annotations.push({
    type: "observed",
    description: JSON.stringify({ float, anchor, below }),
  });
  for (const paragraph of [anchor, below]) {
    const beside = paragraph.filter((l) => overlapsVertically(l, float));
    expect(beside.length).toBeGreaterThan(0);
    // No text over the picture: every line beside it starts after its right edge and its
    // 12px distance from the text.
    for (const line of beside) expect(Math.abs(line.left - (float.right + 12))).toBeLessThan(2);
  }
  // Lines under the float are back at the column's left edge.
  const under = [...anchor, ...below].filter((l) => l.top >= float.bottom + 6);
  expect(under.length).toBeGreaterThan(0);
  for (const line of under) expect(Math.abs(line.left - column.left)).toBeLessThan(2);
  // Offset down by the spacer and across by the margin: 24px and 40px.
  expect(Math.round(float.top - column.top)).toBe(24);
  expect(Math.round(float.left - column.left)).toBe(40);
});

test("ArrowDown walks every line beside the float, never into it", async ({ page }, info) => {
  const float = await rectOf(page, "#square .picture");
  const besideTops = [...(await lines(page, "anchor")), ...(await lines(page, "below"))]
    .filter((l) => overlapsVertically(l, float))
    .map((l) => l.top);
  await caretAt(page, "above", 3);
  const seen: string[] = [];
  const tops: number[] = [];
  let reached = false;
  for (let i = 0; i < 16 && !reached; i++) {
    await page.keyboard.press("ArrowDown");
    const at = await caret(page);
    seen.push(`${at.id}:${at.offset}@${Math.round(at.top)}`);
    expect(at.text).toBe(true);
    expect(at.inFloat).toBe(false);
    expect(inside(at.left, (at.top + at.bottom) / 2, float)).toBe(false);
    tops.push(at.top);
    reached = at.id === "tb";
  }
  info.annotations.push({ type: "observed", description: seen.join(" -> ") });
  expect(reached).toBe(true);
  // No line beside the float skipped.
  for (const top of besideTops) expect(tops.some((t) => Math.abs(t - top) < 3)).toBe(true);
});

test("a click beside the float puts the caret on that line, after the float", async ({
  page,
}, info) => {
  const float = await rectOf(page, "#square .picture");
  const line = (await lines(page, "anchor")).find((l) => overlapsVertically(l, float)) as Rect;
  await page.mouse.click(line.left + 30, (line.top + line.bottom) / 2);
  const at = await caret(page);
  expect(at.id).toBe("anchor");
  expect(at.text).toBe(true);
  expect(Math.abs(at.top - line.top)).toBeLessThan(4);
  expect(at.left).toBeGreaterThan(float.right);
  // Recorded only: clicks on the picture and in the margin left of it (the view handles a
  // click on a picture itself).
  const observed: Record<string, unknown> = { beside: at };
  await page.mouse.click((float.left + float.right) / 2, (float.top + float.bottom) / 2);
  observed.onPicture = await caret(page);
  await page.mouse.click(float.left - 20, (float.top + float.bottom) / 2);
  observed.leftMargin = await caret(page);
  info.annotations.push({ type: "observed", description: JSON.stringify(observed) });
});

test("Home on a line beside the float goes to its start, after the float", async ({
  page,
}, info) => {
  const float = await rectOf(page, "#square .picture");
  const line = (await lines(page, "anchor")).find((l) => overlapsVertically(l, float)) as Rect;
  await page.mouse.click(line.left + 60, (line.top + line.bottom) / 2);
  const before = await caret(page);
  await page.keyboard.press("Home");
  const at = await caret(page);
  info.annotations.push({ type: "observed", description: JSON.stringify({ before, at }) });
  expect(before.left - line.left).toBeGreaterThan(30);
  expect(at.text).toBe(true);
  expect(Math.abs(at.left - line.left)).toBeLessThan(2);
  expect(at.left).toBeGreaterThanOrEqual(float.right);
  expect(Math.abs(at.top - line.top)).toBeLessThan(4);
});

test("typing beside the float and right after it leaves it in place", async ({ page }) => {
  const before = await rectOf(page, "#square .picture");
  const line = (await lines(page, "anchor")).find((l) => overlapsVertically(l, before)) as Rect;
  await page.mouse.click(line.left + 30, (line.top + line.bottom) / 2);
  await page.keyboard.type("XYZ ");
  // At the paragraph's text start: just after the spacer and the float.
  await caretAt(page, "anchor", 0);
  await page.keyboard.type("Q");
  const after = await rectOf(page, "#square .picture");
  expect(after).toEqual(before);
  const anchor = await page.evaluate(() => {
    const p = document.getElementById("anchor") as HTMLElement;
    return {
      order: [...p.childNodes].map((n) =>
        n.nodeType === Node.TEXT_NODE ? "text" : (n as Element).className,
      ),
      text: [...p.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join(""),
    };
  });
  expect(anchor.order.slice(0, 2)).toEqual(["spacer", "float"]);
  expect(anchor.text.startsWith("QThe anchor")).toBe(true);
  expect(anchor.text).toContain("XYZ ");
  const beside = (await lines(page, "anchor")).filter((l) => overlapsVertically(l, after));
  expect(beside.length).toBeGreaterThan(0);
  for (const l of beside) expect(l.left).toBeGreaterThanOrEqual(after.right);
});

test("no line goes beside a top-and-bottom float", async ({ page }) => {
  const float = await rectOf(page, "#topbottom");
  const tb = await lines(page, "tb");
  expect(tb.some((l) => l.top >= float.bottom)).toBe(true);
  const beside = [...tb, ...(await lines(page, "behindp"))].filter((l) =>
    overlapsVertically(l, float),
  );
  expect(beside).toEqual([]);
});

for (const [name, id, picture] of [
  ["behind", "behindp", "#behind .picture"],
  ["in front of", "frontp", "#front .picture"],
] as const) {
  test(`a picture ${name} text leaves the lines at full width`, async ({ page }, info) => {
    const rect = await rectOf(page, picture);
    const column = await rectOf(page, `#${id}`);
    const over = (await lines(page, id)).filter((l) => overlapsVertically(l, rect));
    info.annotations.push({ type: "observed", description: JSON.stringify({ rect, over }) });
    expect(over.length).toBeGreaterThan(0);
    for (const line of over) expect(Math.abs(line.left - column.left)).toBeLessThan(2);
    // Hit testing tells the paint order: behind text, the text's paragraph is on top; in
    // front, the picture is.
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x as number, y as number);
        return { picture: !!el?.closest(".behind, .front"), paragraph: el?.closest("p")?.id };
      },
      [(rect.left + rect.right) / 2, ((over[0] as Rect).top + (over[0] as Rect).bottom) / 2],
    );
    if (name === "behind") expect(hit).toEqual({ picture: false, paragraph: id });
    else expect(hit.picture).toBe(true);
  });
}
