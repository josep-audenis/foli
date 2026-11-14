/**
 * Editing a schema v3 document in the view (8.7a): T1, T2 and T5 on Word's model, on the
 * editing page (`/edit.html`). The document is read from the editor itself (no storage).
 */
import { expect, type Page, test } from "@playwright/test";

const MOD = "ControlOrMeta";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

/** Word's Normal and Heading 1, A4 with inch margins, the given paragraphs. */
function documentOf(blocks: Json[]): Json {
  return {
    schemaVersion: 3,
    section: {
      pageSize: { width: 11906, height: 16838 },
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
    defaults: { paragraph: { spacing: { after: 160 } } },
    styles: [
      { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
      {
        id: "Heading1",
        type: "paragraph",
        name: "heading 1",
        basedOn: "Normal",
        next: "Normal",
        paragraph: { keepNext: true, outlineLevel: 0 },
        run: [{ type: "bold" }, { type: "fontSize", attrs: { value: 32 } }],
      },
    ],
    numbering: { abstracts: [], instances: [] },
    comments: [],
    content: { type: "doc", content: blocks },
  };
}

const text = (value: string, ...marks: string[]): Json => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const paragraph = (...content: Json[]): Json => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});

/** Opens the editing page on `blocks` (a document of Normal paragraphs) and focuses it. */
async function open(page: Page, blocks: Json[]): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), documentOf(blocks));
  await editor(page).focus();
}

/** The editor's paragraphs. */
const content = (page: Page) =>
  page.evaluate(() => window.foliEdit.editor.getDocument().content.content ?? []);
const selection = (page: Page) =>
  page.evaluate(() => {
    const { anchor, head } = window.foliEdit.editor.state.selection;
    return { anchor, head };
  });

test("T1 on v3: typing and formatting keep a valid document after every keystroke", async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
  });
  await open(page, [paragraph()]);
  // Pages hold only blocks; no stray DOM (what the browser would add) survives a keystroke.
  const valid = () =>
    page.evaluate(() => {
      window.foliEdit.validate();
      const host = document.getElementById("editor") as HTMLElement;
      return [...host.childNodes].every(
        (p) =>
          p instanceof Element &&
          p.matches("section.foli-page") &&
          [...p.children].every((block) => /^(P|H[1-6])$/.test(block.tagName)),
      );
    });
  const steps = [
    "Title",
    "Enter",
    "Some ",
    `${MOD}+b`,
    "bold",
    `${MOD}+i`,
    " both",
    `${MOD}+b`,
    `${MOD}+i`,
    " plain",
    "Shift+Enter",
    "next line",
    "Enter",
    `${MOD}+u`,
    "under",
    "Backspace",
    "Backspace",
    `${MOD}+u`,
    "lined",
    "ArrowLeft",
    "Enter",
    "Backspace",
    "Delete",
  ];
  const keys = new Set(["Enter", "Shift+Enter", "Backspace", "Delete", "ArrowLeft"]);
  for (const step of steps) {
    const presses = keys.has(step) || step.startsWith(MOD) ? [step] : [...step];
    for (const press of presses) {
      if (press.length === 1) await page.keyboard.type(press);
      else await page.keyboard.press(press);
      expect(await valid(), `after ${press}`).toBe(true);
    }
  }
  expect(await content(page)).toEqual([
    paragraph(text("Title")),
    paragraph(
      text("Some "),
      text("bold", "bold"),
      text(" both", "bold", "italic"),
      text(" plain"),
      { type: "hardBreak" },
      text("next line"),
    ),
    paragraph(text("und", "underline"), text("line")),
  ]);
  expect(warnings).toEqual([]);
});

test("T1 on v3: Enter after a heading starts its next style, and bold toggles what shows", async ({
  page,
}) => {
  await open(page, [{ type: "paragraph", attrs: { style: "Heading1" }, content: [text("Head")] }]);
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Body");
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("Shift+End");
  // The heading's style is bold: Mod+B turns it off with a direct "not bold".
  await page.keyboard.press(`${MOD}+b`);
  expect(await content(page)).toEqual([
    {
      type: "paragraph",
      attrs: { style: "Heading1" },
      content: [{ type: "text", text: "Head", marks: [{ type: "bold", attrs: { value: false } }] }],
    },
    { type: "paragraph", attrs: { style: "Normal" }, content: [text("Body")] },
  ]);
  const weights = await editor(page).evaluate((host) =>
    [...host.querySelectorAll("h1 span, p span")].map((s) => getComputedStyle(s).fontWeight),
  );
  expect(weights).toEqual(["400", "400"]);
  await expect(editor(page).locator("h1")).toHaveText("Head");
});

test("T2 on v3: replacing a selection across mixed formatting and undoing restores doc and selection", async ({
  page,
}) => {
  await open(page, [
    paragraph(text("one "), text("two", "bold"), text(" three")),
    paragraph(text("four "), text("five", "italic")),
    paragraph(text("six")),
  ]);
  const original = await content(page);
  await page.keyboard.press(`${MOD}+Home`);
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight"); // "one t|wo"
  for (let i = 0; i < 15; i++) await page.keyboard.press("Shift+ArrowRight"); // to "four f|ive"
  // The model reads the DOM selection on selectionchange, which comes asynchronously.
  await expect.poll(() => selection(page)).toEqual({ anchor: 6, head: 22 });
  const before = await selection(page);
  await page.keyboard.type("X");
  expect(await content(page)).toEqual([
    paragraph(text("one "), text("tX", "bold"), text("ive", "italic")),
    paragraph(text("six")),
  ]);
  await page.keyboard.press(`${MOD}+z`);
  expect(await content(page)).toEqual(original);
  expect(await selection(page)).toEqual(before);
  // The DOM shows it too.
  const shown = await page.evaluate(() => getSelection()?.toString().replace(/\s+/g, " "));
  expect(shown).toBe("wo three four f");
});

// ---------- T5: a paragraph split across pages ----------

const words = (n: number) =>
  Array.from({ length: n }, (_, i) => ["alpha", "beta", "gamma", "delta"][i % 4]).join(" ");
// Word's default font (Times New Roman, 10 pt): about 1.8 pages of text.
const LONG = `Long ${words(1200)}.`;

/** Short paragraphs, then one long paragraph that crosses the end of page 1. */
async function openSplit(page: Page): Promise<void> {
  await open(page, [
    ...Array.from({ length: 14 }, (_, i) => paragraph(text(`Paragraph ${i}`))),
    paragraph(text(LONG)),
    paragraph(text("After")),
  ]);
}

/** The long paragraph's fragments: page index and text of each. */
const fragmentsOf = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".foli-page > [data-fragment]")].map((el) => ({
      page: [...document.querySelectorAll(".foli-page")].indexOf(el.parentElement as Element),
      index: Number(el.getAttribute("data-fragment")),
      text: el.textContent ?? "",
    })),
  );

/** The long paragraph's text in the model. */
const longText = (page: Page) =>
  page.evaluate(() => {
    const doc = window.foliEdit.editor.state.doc;
    let found = "";
    doc.forEach((node) => {
      if (node.textContent.startsWith("Long")) found = node.textContent;
    });
    return found;
  });

/** Puts the caret `offset` characters into fragment `index`. */
async function caretInFragment(page: Page, index: number, offset: number): Promise<void> {
  await editor(page).locator(`[data-fragment="${index}"]`).click();
  await page.evaluate(
    ([i, at]) => {
      const fragment = document.querySelector(`[data-fragment="${i}"]`) as Element;
      const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
      let left = at;
      for (
        let node = walker.nextNode() as Text | null;
        node;
        node = walker.nextNode() as Text | null
      ) {
        if (left <= node.length) {
          getSelection()?.collapse(node, left);
          return;
        }
        left -= node.length;
      }
    },
    [index, offset] as const,
  );
}

test("T5 on v3: a paragraph crossing the page end is split at a line, Word's spacing kept", async ({
  page,
}) => {
  await openSplit(page);
  const parts = await fragmentsOf(page);
  expect(parts.length).toBe(2);
  expect(parts.map((p) => p.page)).toEqual([0, 1]);
  expect(parts.map((p) => p.text).join("")).toBe(LONG);
  expect(parts[0]?.text.endsWith(" ")).toBe(true);
  // Word adds the space after a paragraph and before the next (here 8 pt after, 0 before), and
  // a page the text flowed onto starts without space; the continuation has none.
  const margins = await page.evaluate(() =>
    [...document.querySelectorAll(".foli-page > *")].map((el) =>
      Number.parseFloat(getComputedStyle(el).marginTop),
    ),
  );
  expect(margins[0]).toBe(0);
  expect(margins[1]).toBeCloseTo((160 * 96) / 1440, 1); // WebKit: to 1/64 px
  const continuation = await page.evaluate(
    () => getComputedStyle(document.querySelector('[data-fragment="1"]') as Element).marginTop,
  );
  expect(continuation).toBe("0px");
});

test("T5 on v3: Word's page rules: keep with next, keep lines, page break before", async ({
  page,
}) => {
  const heading = (attrs: Json, value: string): Json => ({
    type: "paragraph",
    attrs: { style: "Heading1", spacing: { before: 240 }, ...attrs },
    content: [text(value)],
  });
  await open(page, [
    ...Array.from({ length: 30 }, (_, i) => paragraph(text(`Paragraph ${i}`))),
    // Near the end of page 1: the kept paragraph does not fit there, the heading goes with it.
    heading({}, "Moved"),
    { type: "paragraph", attrs: { keepLines: true }, content: [text(words(400))] },
    heading({ pageBreakBefore: true }, "Broken"),
  ]);
  const placed = await page.evaluate(() =>
    [...document.querySelectorAll(".foli-page")].map((p) =>
      [...p.children].map((el) => ({
        text: (el.textContent ?? "").slice(0, 12),
        top: Number.parseFloat(getComputedStyle(el).marginTop),
      })),
    ),
  );
  expect(placed).toHaveLength(3);
  expect(placed[0]?.at(-1)?.text).toBe("Paragraph 29");
  expect(placed[1]?.map((b) => b.text)).toEqual(["Moved", "alpha beta g"]);
  // A page the text flowed onto starts without the space before; a page break keeps it.
  expect(placed[1]?.[0]?.top).toBe(0);
  expect(placed[2]?.map((b) => b.text)).toEqual(["Broken"]);
  expect(placed[2]?.[0]?.top).toBeCloseTo((240 * 96) / 1440, 1);
});

test("T5 on v3: typing at the end of page 1 inside a split paragraph keeps text and caret", async ({
  page,
}) => {
  await openSplit(page);
  const split = ((await fragmentsOf(page))[0]?.text ?? "").length;
  await caretInFragment(page, 0, split);
  await page.keyboard.type("XYZ");
  await page.keyboard.type("W");
  const expected = `${LONG.slice(0, split)}XYZW${LONG.slice(split)}`;
  expect(await longText(page)).toBe(expected);
  expect((await fragmentsOf(page)).map((p) => p.text).join("")).toBe(expected);
  await page.keyboard.press(`${MOD}+z`);
  expect(await longText(page)).toBe(LONG);
});

test("T5 on v3: arrows cross the page break one character per press", async ({ page }) => {
  await openSplit(page);
  const split = ((await fragmentsOf(page))[0]?.text ?? "").length;
  await caretInFragment(page, 0, split - 1);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("#");
  expect(await longText(page)).toBe(`${LONG.slice(0, split + 1)}#${LONG.slice(split + 1)}`);
  await page.keyboard.press(`${MOD}+z`);
  await caretInFragment(page, 1, 1);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("%");
  expect(await longText(page)).toBe(`${LONG.slice(0, split - 1)}%${LONG.slice(split - 1)}`);
});

test("T5 on v3: a selection across the page break is replaced and undone exactly", async ({
  page,
}) => {
  await openSplit(page);
  const original = await content(page);
  const split = ((await fragmentsOf(page))[0]?.text ?? "").length;
  await caretInFragment(page, 0, split - 3);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(async () => (await selection(page)).head)
    .toBe((await selection(page)).anchor + 6);
  const before = await selection(page);
  await page.keyboard.type("!");
  expect(await longText(page)).toBe(`${LONG.slice(0, split - 3)}!${LONG.slice(split + 3)}`);
  await page.keyboard.press(`${MOD}+z`);
  expect(await content(page)).toEqual(original);
  expect(await selection(page)).toEqual(before);
});
