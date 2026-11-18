/**
 * Headers and footers in the editable view (11.7), on the editing page (`/edit.html`): laid out in
 * their margins on every page, with their variants and page fields.
 */
import AxeBuilder from "@axe-core/playwright";
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

// ---------- editing in place ----------

const MOD = "ControlOrMeta";
/** The story open on its page: its editing host. */
const inStory = (page: Page) => page.locator(".foli-story-mount [contenteditable=true]");
const storyText = (page: Page, id = "h") =>
  page.evaluate((key) => window.foliEdit.editor.story(key)?.state.doc.textContent ?? null, id);
const bodyText = (page: Page) => page.evaluate(() => window.foliEdit.editor.state.doc.textContent);
const valid = (page: Page) => page.evaluate(() => window.foliEdit.validate());
const regionTexts = (page: Page, side = "header") =>
  page.evaluate(
    (name) =>
      [...document.querySelectorAll(`.foli-page > .foli-${name}`)].map(
        (r) => r.querySelector(".foli-region-content")?.textContent ?? "",
      ),
    side,
  );

/** Two pages, a header and a footer on both. */
const twoPages = (more: Json = {}) =>
  documentOf(
    [pageBreak("First page"), paragraph("Second page")],
    { ...A5, headers: { default: "h" }, footers: { default: "f" } },
    {
      stories: {
        h: story("header", paragraph("Head")),
        f: story("footer", paragraph("Foot")),
      },
      ...more,
    },
  );

/** A point in the top margin of page `index`, on the header. */
async function headerPoint(page: Page, index = 0) {
  const box = await page.evaluate((i) => {
    const p = document.querySelectorAll("section.foli-page")[i] as HTMLElement;
    const text = p.querySelector(".foli-header .foli-region-content") as HTMLElement;
    text.scrollIntoView({ block: "center" });
    const r = text.getBoundingClientRect();
    return { x: r.left + 12, y: r.top + 6 };
  }, index);
  return box;
}

async function openHeader(page: Page, index = 0) {
  const { x, y } = await headerPoint(page, index);
  await page.mouse.dblclick(x, y);
  await expect(inStory(page)).toBeFocused();
}

test("double click opens a header: typing reaches it on every page, Escape returns", async ({
  page,
}) => {
  await load(page, twoPages());
  await editor(page).click();
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press("ArrowRight");
  await openHeader(page);
  await expect(editor(page)).toHaveClass(/foli-in-story/);
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");
  await page.keyboard.press("End");
  await page.keyboard.type("er");
  expect(await storyText(page)).toBe("Header");
  expect(await bodyText(page)).toBe("First pageSecond page");
  // The other page shows it at once; the open one is being edited.
  expect((await regionTexts(page))[1]).toBe("Header");
  await expect(inStory(page)).toHaveText("Header");

  await page.keyboard.press("Escape");
  await expect(page.locator(".foli-story-mount")).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).not.toHaveClass(/foli-in-story/);
  expect(await regionTexts(page)).toEqual(["Header", "Header"]);
  // Back where the caret was.
  await page.keyboard.type("x");
  expect(await bodyText(page)).toBe("Fxirst pageSecond page");
});

test("from another page the same story opens; a click on the body leaves it there", async ({
  page,
}) => {
  await load(page, twoPages());
  await openHeader(page, 1);
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  expect(await regionTexts(page)).toEqual(["Head!", "Head!"]);
  const target = await page.evaluate(() => {
    const block = document.querySelector("section.foli-page > p") as HTMLElement;
    block.scrollIntoView({ block: "center" });
    const r = block.getBoundingClientRect();
    return { x: r.left + 1, y: r.top + r.height / 2 };
  });
  await page.mouse.click(target.x, target.y);
  await expect(page.locator(".foli-story-mount")).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("y");
  expect(await bodyText(page)).toBe("yFirst pageSecond page");
  expect(await storyText(page)).toBe("Head!");
});

test("the footer opens too, and a page without one gets it", async ({ page }) => {
  await load(page, documentOf([paragraph("Body")], A5));
  await page.evaluate(() => window.foliEdit.view.openStory("footer"));
  await expect(inStory(page)).toBeFocused();
  await page.keyboard.type("New foot");
  await page.keyboard.press("Escape");
  expect(await regionTexts(page, "footer")).toEqual(["New foot"]);
  const footers = await page.evaluate(() => window.foliEdit.editor.getDocument().section.footers);
  expect(Object.keys(footers ?? {})).toEqual(["default"]);
  // Making it and typing in it undo on their own, in order.
  await page.keyboard.press(`${MOD}+z`);
  expect(await regionTexts(page, "footer")).toEqual([""]);
  await page.keyboard.press(`${MOD}+z`);
  expect(await regionTexts(page, "footer")).toEqual([]);
});

test("undo crosses stories and the body, and a growing header moves the text", async ({ page }) => {
  await load(page, twoPages());
  await editor(page).click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type("B");
  await openHeader(page);
  await page.keyboard.press("End");
  await page.keyboard.type("H");
  await page.keyboard.press(`${MOD}+z`);
  expect(await storyText(page)).toBe("Head");
  await expect(inStory(page)).toHaveText("Head");
  await page.keyboard.press(`${MOD}+z`);
  expect(await bodyText(page)).toBe("First pageSecond page");
  await expect(inStory(page)).toBeFocused();
  await page.keyboard.press(`${MOD}+y`);
  await page.keyboard.press(`${MOD}+y`);
  expect(await storyText(page)).toBe("HeadH");
  expect(await bodyText(page)).toBe("First pageSecond pageB");

  const textTop = async () => (await pages(page))[1]?.textTop ?? 0;
  const before = await textTop();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Enter");
  await expect.poll(textTop).toBeGreaterThan(before);
  await expect(inStory(page)).toBeFocused();
  await page.keyboard.type("z");
  expect(await storyText(page)).toBe("HeadHz");
});

test("T1 in a header: typing and formatting keep the tree valid at every key", async ({ page }) => {
  await load(page, twoPages());
  await openHeader(page);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Delete");
  for (const key of ["a", "b", "Enter", "c", `${MOD}+b`, "d", `${MOD}+b`, "e", "Enter", "f"]) {
    if (key.length === 1) await page.keyboard.type(key);
    else await page.keyboard.press(key);
    expect(await valid(page)).toBe(true);
  }
  const content = await page.evaluate(
    () => window.foliEdit.editor.getDocument().stories?.h?.content,
  );
  expect(content?.content?.map((b) => (b.content ?? []).map((n) => n.text).join("|"))).toEqual([
    "ab",
    "c|d|e",
    "f",
  ]);
  expect(JSON.stringify(content?.content?.[1]?.content?.[1]?.marks)).toContain("bold");
});

test("T2 in a header: a selection across paragraphs is replaced, undo restores it", async ({
  page,
}) => {
  await load(
    page,
    documentOf(
      [paragraph("Body")],
      { ...A5, headers: { default: "h" } },
      {
        stories: {
          h: story(
            "header",
            paragraph("One"),
            { type: "paragraph", content: [{ ...text("Two"), marks: [{ type: "bold" }] }] },
            paragraph("Three"),
          ),
        },
      },
    ),
  );
  await openHeader(page);
  const snapshot = () =>
    page.evaluate(() => {
      const editor = window.foliEdit.editor.story("h");
      return {
        doc: editor?.state.doc.toJSON(),
        selection: editor?.state.selection.toJSON(),
      };
    });
  await page.evaluate(() => window.foliEdit.editor.story("h")?.select(2, 12));
  const before = await snapshot();
  await page.keyboard.type("X");
  expect(await storyText(page)).toBe("OXhree");
  await page.keyboard.press(`${MOD}+z`);
  expect(await snapshot()).toEqual(before);
  await expect(inStory(page)).toContainText("Two");
});

test("T3 in a header: pasted text and HTML go in, what a story cannot hold does not", async ({
  page,
}) => {
  await load(page, twoPages());
  await openHeader(page);
  await page.keyboard.press("End");
  const paste = (types: Record<string, string>) =>
    page.evaluate((data) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: (t: string) => data[t] ?? "", files: [], types: Object.keys(data) },
      });
      document.activeElement?.dispatchEvent(event);
    }, types);
  await paste({ "text/plain": " plain" });
  expect(await storyText(page)).toBe("Head plain");
  await paste({ "text/html": "<p>one</p><p><b>two</b></p>" });
  expect(await storyText(page)).toContain("one");
  expect(await valid(page)).toBe(true);
  // Foli's own content with a comment and a section break: they stay out of the header.
  await paste({
    "application/x-foli+json": JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { section: { titlePage: true } },
          content: [{ type: "commentStart", attrs: { id: 4 } }, text("kept")],
        },
      ],
    }),
  });
  expect(await valid(page)).toBe(true);
  expect(await bodyText(page)).toBe("First pageSecond page");
});

test("T4 in a header: a composition commits into the story, one undo step", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP IME emulation is Chromium-only");
  await load(page, twoPages());
  await openHeader(page);
  await page.keyboard.press("End");
  const cdp = await page.context().newCDPSession(page);
  for (const text of ["k", "か"])
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
  await cdp.send("Input.insertText", { text: "漢" });
  await expect.poll(() => storyText(page)).toBe("Head漢");
  expect((await regionTexts(page))[1]).toBe("Head漢");
  await page.keyboard.press(`${MOD}+z`);
  expect(await storyText(page)).toBe("Head");
  await expect(inStory(page)).toHaveText("Head");
});

test("T5 with a header: it pushes text across the page end, select and undo keep all", async ({
  page,
}) => {
  const lines = Array.from({ length: 34 }, (_, i) => paragraph(`Line ${i}`));
  await load(
    page,
    documentOf(
      lines,
      { ...A5, headers: { default: "h" } },
      {
        stories: { h: story("header", paragraph("Head")) },
      },
    ),
  );
  const count = () => page.locator("section.foli-page").count();
  const before = await count();
  const body = await bodyText(page);
  await openHeader(page);
  await page.keyboard.press("End");
  for (let i = 0; i < 14; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("tail");
  await expect.poll(count).toBeGreaterThan(before);
  expect(await bodyText(page)).toBe(body);
  // Select back across the header's paragraphs, replace, undo (a step of its own, later).
  await page.waitForTimeout(600);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type("Q");
  expect(await storyText(page)).toBe("Q");
  await expect.poll(count).toBe(before);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(count).toBeGreaterThan(before);
  expect(await storyText(page)).toBe("Headtail");
  expect(await bodyText(page)).toBe(body);
  await expect(inStory(page)).toBeFocused();
});

test("the caret and selection cross pages over their footers and headers", async ({ page }) => {
  const lines = Array.from({ length: 60 }, (_, i) => paragraph(`Line ${i}`));
  await load(
    page,
    documentOf(
      lines,
      { ...A5, headers: { default: "h" }, footers: { default: "f" } },
      {
        stories: { h: story("header", paragraph("Head")), f: story("footer", paragraph("Foot")) },
      },
    ),
  );
  /** The last line on the first page, and the first on the second. */
  const edge = () =>
    page.evaluate(() => {
      const [one, two] = [...document.querySelectorAll("section.foli-page")].map((p) =>
        [...p.children].filter((c) => c.tagName === "P"),
      );
      return { last: one?.at(-1)?.textContent ?? "", first: two?.[0]?.textContent ?? "" };
    });
  const { last, first } = await edge();
  expect(last).not.toBe("");
  const at = (text: string) =>
    page.evaluate((wanted) => {
      const doc = window.foliEdit.editor.state.doc;
      let found = -1;
      doc.forEach((node, pos) => {
        if (node.textContent === wanted) found = pos + 1;
      });
      return found;
    }, text);
  const select = (from: number) =>
    page.evaluate((pos) => {
      window.foliEdit.view.focus();
      window.foliEdit.editor.select(pos);
    }, from);
  const caret = () => page.evaluate(() => window.foliEdit.editor.state.selection.head);
  await select((await at(last)) + last.length);
  await page.keyboard.press("ArrowRight");
  await expect.poll(caret).toBe(await at(first));
  await page.keyboard.press("ArrowLeft");
  await expect.poll(caret).toBe((await at(last)) + last.length);
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await caret()) >= (await at(first))).toBe(true);
  expect(await caret()).toBeLessThanOrEqual((await at(first)) + first.length);
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(async () => (await caret()) >= (await at(last)) && (await caret()) < (await at(first)))
    .toBe(true);
  // A selection across the page end, replaced and undone.
  await select((await at(last)) + 1);
  const body = await bodyText(page);
  for (let i = 0; i < 2; i++) await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.type("Z");
  expect(await bodyText(page)).not.toContain(first);
  await page.keyboard.press(`${MOD}+z`);
  expect(await bodyText(page)).toBe(body);
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type("!");
  expect((await bodyText(page)).endsWith("Line 59!")).toBe(true);
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.type("^");
  expect((await bodyText(page)).startsWith("^Line 0")).toBe(true);
});

test("tracked in a header, accepted and rejected from the body with the rest", async ({ page }) => {
  await load(page, twoPages());
  await page.evaluate(() => window.foliEdit.editor.commands.setTrackChanges(true));
  await openHeader(page);
  await page.keyboard.press("End");
  await page.keyboard.type("X");
  const marked = () =>
    page.evaluate(() => JSON.stringify(window.foliEdit.editor.getDocument().stories?.h?.content));
  expect(await marked()).toContain('"insertion"');
  await expect(inStory(page).locator("ins")).toHaveText("X");
  await page.keyboard.press("Escape");
  await expect((await page.locator(".foli-header ins").count()) > 0).toBe(true);
  await page.evaluate(() => window.foliEdit.editor.commands.rejectAllChanges());
  expect(await storyText(page)).toBe("Head");
  await page.keyboard.press(`${MOD}+z`);
  expect(await storyText(page)).toBe("HeadX");
  await page.evaluate(() => window.foliEdit.editor.commands.acceptAllChanges());
  expect(await marked()).not.toContain('"insertion"');
  expect(await storyText(page)).toBe("HeadX");
});

test("pictures and tables go into a header, which grows and pushes the text", async ({ page }) => {
  await load(page, twoPages());
  await openHeader(page);
  const top = async () => (await pages(page))[0]?.textTop ?? 0;
  const before = await top();
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  await page.evaluate((data) => {
    const story = window.foliEdit.editor.story("h");
    const { insertPicture, insertTable } = window.foliEdit.commands;
    story?.run(
      insertPicture(
        { contentType: "image/png", data, width: 952500, height: 952500 },
        { requireAlt: false },
      ),
    );
    story?.run(insertTable(2, 2));
  }, png);
  await expect(inStory(page).locator("[data-foli-picture]")).toHaveCount(1);
  await expect(inStory(page).locator("table")).toHaveCount(1);
  await expect.poll(top).toBeGreaterThan(before);
  expect(await valid(page)).toBe(true);
  await page.keyboard.press("Escape");
  const count = await page.locator("section.foli-page").count();
  await expect(page.locator(".foli-page .foli-header table")).toHaveCount(count);
  await expect(page.locator(".foli-page .foli-header [data-foli-picture]")).toHaveCount(count);
});

test("the toolbar's menu works from the keyboard, and in a story formats the story", async ({
  page,
}) => {
  await load(
    page,
    documentOf(
      [paragraph("One", { section: { ...A5, headers: { default: "h" } } }), paragraph("Two")],
      A5,
      { stories: { h: story("header", paragraph("Head")) } },
    ),
  );
  await editor(page).click();
  await page.keyboard.press(`${MOD}+End`);
  const menu = page.getByRole("button", { name: "Header", exact: true });
  const pick = async (name: string) => {
    await menu.focus();
    await page.keyboard.press("ArrowDown");
    await page
      .getByRole("menuitem", { name })
      .or(page.getByRole("menuitemcheckbox", { name }))
      .focus();
    await page.keyboard.press("Enter");
  };
  await pick("Edit header");
  await expect(inStory(page)).toBeFocused();
  // Page 2 is section 2's, linked to section 1's header.
  await page.keyboard.press(`${MOD}+a`);
  await page.getByRole("button", { name: "Bold" }).click();
  expect(
    await page.evaluate(() => JSON.stringify(window.foliEdit.editor.getDocument().stories?.h)),
  ).toContain("bold");
  expect(
    await page.evaluate(() => JSON.stringify(window.foliEdit.editor.state.doc.toJSON())),
  ).not.toContain("bold");

  await menu.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemcheckbox", { name: "Link to previous" })).toBeChecked();
  const results = await new AxeBuilder({ page }).include(".foli-toolbar").analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press("Escape");

  await pick("Link to previous");
  // Unlinked: section 2 has a story of its own, a copy, and it is the one open.
  await expect
    .poll(() => page.evaluate(() => window.foliEdit.editor.getDocument().section.headers?.default))
    .toBeTruthy();
  await expect(inStory(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await pick("Different first page");
  expect(await page.evaluate(() => window.foliEdit.editor.getDocument().section.titlePage)).toBe(
    true,
  );
  await pick("Different odd and even pages");
  expect(
    await page.evaluate(() => window.foliEdit.editor.getDocument().settings?.evenAndOddHeaders),
  ).toBe(true);
});
