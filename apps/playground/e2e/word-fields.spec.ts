/**
 * Fields in the editable view (11.8), on the editing page (`/edit.html`): results shown, codes
 * hidden and toggled, a field selected and deleted whole, updated with F9 from the pages, inserted
 * from the toolbar.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const text = (value: string): Json => ({ type: "text", text: value });
const paragraph = (...content: (Json | string)[]): Json => ({
  type: "paragraph",
  content: content.map((c) => (typeof c === "string" ? text(c) : c)),
});
const heading = (level: number, value: string): Json => ({
  type: "paragraph",
  attrs: { style: `Heading${level}` },
  content: [text(value)],
});
const field = (code: string, shown: string): Json[] => [
  { type: "fieldStart" },
  { type: "fieldCode", attrs: { text: ` ${code} ` } },
  { type: "fieldSeparator" },
  ...(shown ? [text(shown)] : []),
  { type: "fieldEnd" },
];
const pageBreak = (value: string): Json => ({
  type: "paragraph",
  content: [text(value), { type: "pageBreak" }],
});
const documentOf = (blocks: Json[], more: Json = {}): Json => ({
  schemaVersion: 5,
  section: {
    pageSize: { width: 8391, height: 11906 },
    margins: { top: 1440, right: 1000, bottom: 1440, left: 1000 },
  },
  defaults: { paragraph: { spacing: { after: 0 } } },
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
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: { type: "doc", content: blocks },
  ...more,
});

async function load(page: Page, document: Json) {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), document);
}
const shownText = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("section.foli-page")]
      .map((p) => p.innerText.replace(/\n+/g, "|").replace(/^\||\|$/g, ""))
      .join(" / "),
  );
/** Each field of the body: its instruction and result. */
const fields = (page: Page) =>
  page.evaluate(() => {
    const out: { code: string; result: string; from: number; to: number }[] = [];
    const stack: { code: string; result: string; from: number; open: boolean }[] = [];
    window.foliEdit.editor.state.doc.descendants((node, pos) => {
      const top = stack[stack.length - 1];
      const name = node.type.name;
      if (name === "fieldStart") stack.push({ code: "", result: "", from: pos, open: true });
      else if (name === "fieldCode" && top) top.code += String(node.attrs.text).trim();
      else if (name === "fieldSeparator" && top) top.open = false;
      else if (name === "fieldEnd" && top) {
        stack.pop();
        out.push({ code: top.code, result: top.result, from: top.from, to: pos + 1 });
      } else if (node.isText && top && !top.open) top.result += node.text;
      return true;
    });
    return out.sort((a, b) => a.from - b.from);
  });
const selection = (page: Page) =>
  page.evaluate(() => {
    const { from, to } = window.foliEdit.editor.state.selection;
    return { from, to };
  });
const select = (page: Page, anchor: number, head = anchor) =>
  page.evaluate(
    ([a, h]) => window.foliEdit.editor.select(a as number, h as number),
    [anchor, head],
  );

test("a field shows its result; its code and a nested field's result stay hidden", async ({
  page,
}) => {
  await load(
    page,
    documentOf([
      paragraph(
        "Dear ",
        { type: "fieldStart" },
        { type: "fieldCode", attrs: { text: " IF " } },
        ...field("MERGEFIELD Title", "NESTED"),
        { type: "fieldCode", attrs: { text: ' = "x" "a" "b" ' } },
        { type: "fieldSeparator" },
        "Result",
        { type: "fieldEnd" },
        " end",
      ),
    ]),
  );
  await expect.poll(() => shownText(page)).toBe("Dear Result end");
  expect(await shownText(page)).not.toContain("NESTED");
  expect(await shownText(page)).not.toContain("MERGEFIELD");
});

test("the caret passes over the code, a press lands outside it, typing stays out", async ({
  page,
}) => {
  await load(page, documentOf([paragraph("ab", ...field("SEQ x", "12"), "cd")]));
  await editor(page).click();
  await page.keyboard.press("Control+Home");
  // Across "a", "b", then "1" of the result (the code takes no key press).
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  const [one] = await fields(page);
  await expect.poll(async () => (await selection(page)).from).toBe((one?.to ?? 0) - 2);
  await page.keyboard.type("9");
  const [after] = await fields(page);
  expect(after?.result).toBe("192");
  expect(after?.code).toBe("SEQ x");
  await page.evaluate(() => window.foliEdit.validate());
});

test("what is typed after a trailing field, or before a leading one, stays outside", async ({
  page,
}) => {
  await load(page, documentOf([paragraph("Page ", ...field("SEQ x", "7"))]));
  await editor(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" of 9");
  await expect.poll(() => shownText(page)).toBe("Page 7 of 9");
  await page.keyboard.press("F9");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("F9");
  await expect.poll(() => shownText(page)).toBe("Page 1 of 9");
  await load(page, documentOf([paragraph(...field("SEQ x", "7"), " end")]));
  await editor(page).click();
  await page.keyboard.press("Home");
  await page.keyboard.type("No ");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("F9");
  await expect.poll(() => shownText(page)).toBe("No 1 end");
  // A click past the end of the line, and Right after the last digit, are outside too.
  await load(page, documentOf([paragraph("Page ", ...field("SEQ x", "7"))]));
  const box = await page.locator("section.foli-page p").first().boundingBox();
  await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) - 4, (box?.y ?? 0) + 4);
  const [one] = await fields(page);
  await expect.poll(async () => (await selection(page)).from).toBe(one?.to);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await selection(page)).from).toBe(one?.to);
  await page.evaluate(() => window.foliEdit.validate());
});

test("a composition after a trailing field goes outside it", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "IME through CDP");
  await load(page, documentOf([paragraph("Page ", ...field("SEQ x", "7"))]));
  await editor(page).click();
  await page.keyboard.press("End");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "x", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.insertText", { text: "x" });
  await expect.poll(async () => (await fields(page))[0]?.result).toBe("7");
  await expect.poll(() => shownText(page)).toBe("Page 7x");
});

test("with codes shown, typing goes beside the field and leaves its code alone", async ({
  page,
}) => {
  await load(page, documentOf([paragraph("a", ...field("SEQ x", "7"), "b")]));
  await editor(page).click();
  await page.keyboard.press("Alt+F9");
  await expect(editor(page)).toContainText("{ SEQ x }");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("C");
  await page.keyboard.press("Alt+F9");
  expect((await fields(page))[0]?.code).toBe("SEQ x");
  await expect.poll(() => shownText(page)).toBe("a7Cb");
});

test("Backspace after a field selects it, shaded; the next one deletes it, undo restores", async ({
  page,
}) => {
  await load(page, documentOf([paragraph("ab", ...field("SEQ x", "12"), "cd")]));
  await editor(page).click();
  const [one] = await fields(page);
  await select(page, one?.to as number);
  await page.keyboard.press("Backspace");
  expect(await selection(page)).toEqual({ from: one?.from, to: one?.to });
  await expect(page.locator("[data-foli-field-selected]")).toHaveText("12");
  const background = await page
    .locator("[data-foli-field-selected]")
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  await page.keyboard.press("Backspace");
  await expect.poll(() => shownText(page)).toBe("abcd");
  expect(await fields(page)).toEqual([]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => shownText(page)).toBe("ab12cd");
  expect(await fields(page)).toHaveLength(1);
});

test("the caret in a field shades it, and leaving takes the shading off", async ({ page }) => {
  await load(page, documentOf([paragraph("ab", ...field("SEQ x", "12"), "cd")]));
  await editor(page).click();
  const [one] = await fields(page);
  await select(page, (one?.to as number) - 2);
  await expect(page.locator("[data-foli-field-selected]")).toHaveText("12");
  await select(page, 1);
  await expect(page.locator("[data-foli-field-selected]")).toHaveCount(0);
});

test("a drag or Shift+arrow across a marker takes the field whole", async ({ page }) => {
  await load(page, documentOf([paragraph("ab", ...field("SEQ x", "12"), "cd")]));
  await editor(page).click();
  const [one] = await fields(page);
  await select(page, 3);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => selection(page)).toEqual({ from: 3, to: one?.to });
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => selection(page)).toEqual({ from: 3, to: (one?.to as number) + 1 });
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(() => selection(page)).toEqual({ from: 3, to: one?.to });
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(async () => (await selection(page)).to).toBe(one?.from);
});

test("Alt+F9 shows the codes in braces and hides results, for the whole document", async ({
  page,
}) => {
  await load(
    page,
    documentOf(
      [
        paragraph("one ", ...field("SEQ x", "7"), " two"),
        paragraph(...field('TOC \\o "1-1"', "entry"), { type: "hardBreak" }, "after"),
        pageBreak("page"),
        paragraph("last"),
      ],
      {
        section: {
          pageSize: { width: 8391, height: 11906 },
          margins: { top: 1440, right: 1000, bottom: 1440, left: 1000, header: 500 },
          headers: { default: "h" },
        },
        stories: {
          h: {
            kind: "header",
            content: { type: "doc", content: [paragraph("Head ", ...field("PAGE", "9"))] },
          },
        },
      },
    ),
  );
  await expect.poll(() => shownText(page)).toContain("one 7 two");
  await editor(page).click();
  await page.keyboard.press("Alt+F9");
  await expect(editor(page)).toContainText("{ SEQ x }");
  await expect(editor(page)).toContainText('{ TOC \\o "1-1" }');
  await expect.poll(() => shownText(page)).not.toContain("one 7 two");
  await expect(page.locator(".foli-header").first()).toContainText("{ PAGE }");
  // The document is what it was.
  await page.keyboard.press("Alt+F9");
  await expect.poll(() => shownText(page)).toContain("one 7 two");
  await expect(page.locator(".foli-header").first()).toContainText("Head 1");
  await page.evaluate(() => window.foliEdit.validate());
});

test("with codes shown, a table of contents collapses to its code", async ({ page }) => {
  await load(
    page,
    documentOf([paragraph("x"), heading(1, "One"), pageBreak("b"), heading(1, "Two")]),
  );
  await editor(page).click();
  await select(page, 1);
  await page.getByRole("button", { name: "Fields" }).click();
  await page.getByRole("menuitem", { name: "Table of contents" }).click();
  await expect(editor(page)).toContainText("One");
  const before = await page.locator("section.foli-page").count();
  await page.keyboard.press("Alt+F9");
  await expect(editor(page)).toContainText("TOC");
  await expect.poll(() => shownText(page)).not.toContain("\t");
  // The entries take no room, and no block is left between pages to catch the caret.
  expect(await page.locator("section.foli-page").count()).toBeLessThanOrEqual(before);
  await page.keyboard.press("Alt+F9");
  await expect(editor(page)).toContainText("Two");
});

test("F9 updates the field at the caret from the pages, Ctrl+A then F9 updates all", async ({
  page,
}) => {
  await load(
    page,
    documentOf([
      pageBreak("first"),
      paragraph("on page ", ...field("PAGE", "?")),
      paragraph("of ", ...field("NUMPAGES", "?")),
      paragraph(...field("SEQ t", "?"), " ", ...field("SEQ t", "?")),
    ]),
  );
  await editor(page).click();
  const [page1] = await fields(page);
  await select(page, (page1?.to as number) - 2);
  await page.keyboard.press("F9");
  await expect
    .poll(async () => (await fields(page)).map((f) => f.result))
    .toEqual(["2", "?", "?", "?"]);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("F9");
  await expect
    .poll(async () => (await fields(page)).map((f) => f.result))
    .toEqual(["2", "2", "1", "2"]);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await fields(page)).map((f) => f.result))
    .toEqual(["2", "?", "?", "?"]);
});

test("a table of contents is built with the headings' pages, and follows them", async ({
  page,
}) => {
  await load(
    page,
    documentOf([
      paragraph("start"),
      heading(1, "Alpha"),
      pageBreak("text"),
      heading(1, "Beta"),
      pageBreak("more"),
      heading(1, "Gamma"),
    ]),
  );
  await editor(page).click();
  await select(page, 1);
  await page.getByRole("button", { name: "Fields" }).click();
  await page.getByRole("menuitem", { name: "Table of contents" }).click();
  const results = async () =>
    (await fields(page)).filter((f) => f.code.startsWith("PAGEREF")).map((f) => f.result);
  await expect.poll(results).toEqual(["1", "2", "3"]);
  await expect(page.locator("a[href]").or(page.locator("[data-href]"))).toHaveCount(0);
  await expect(editor(page)).toContainText("Beta");
  // A heading pushed on a page: F9 over everything renumbers the entry.
  await page.evaluate(() => {
    const { editor } = window.foliEdit;
    let at = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.textContent === "text") at = pos;
      return !node.isTextblock;
    });
    const { schema } = editor.state;
    editor.dispatch(
      editor.state.tr.insert(
        at,
        schema.nodes.paragraph.create(null, [schema.text("x"), schema.nodes.pageBreak.create()]),
      ),
    );
  });
  await page.keyboard.press("Control+a");
  await page.keyboard.press("F9");
  await expect.poll(results).toEqual(["1", "3", "4"]);
  await page.evaluate(() => window.foliEdit.validate());
  // Undo takes the update as one step.
  await page.keyboard.press("Control+z");
  await expect.poll(results).toEqual(["1", "2", "3"]);
});

test("the fields menu inserts by keyboard, the cross-reference dialog is axe-clean", async ({
  page,
}) => {
  await load(page, documentOf([heading(1, "Chapter"), paragraph("see ")]));
  await editor(page).click();
  const size = await page.evaluate(() => window.foliEdit.editor.state.doc.content.size);
  await select(page, size - 1);
  const menu = page.getByRole("button", { name: "Fields" });
  await menu.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Page number" })).toBeFocused();
  expect((await new AxeBuilder({ page }).include(".foli-menu").analyze()).violations).toEqual([]);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await fields(page)).map((f) => f.code)).toEqual(["PAGE"]);
  await expect.poll(async () => (await fields(page))[0]?.result).toBe("1");

  await menu.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await fields(page)).map((f) => f.code)[1] ?? "").toContain("DATE");

  await menu.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Insert cross-reference" });
  await expect(dialog.getByLabel("Refer to")).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).include(".foli-table-dialog").analyze()).violations,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await fields(page)).at(-1)?.result).toBe("Chapter");
  expect((await fields(page)).at(-1)?.code).toMatch(/^REF _Ref\d+ \\h$/);
  await page.evaluate(() => window.foliEdit.validate());
});

test("the toolbar shows and hides the codes, updates all, keeps the checked state", async ({
  page,
}) => {
  await load(page, documentOf([paragraph(...field("SEQ a", "5"))]));
  const open = page.getByRole("button", { name: "Fields" });
  await open.click();
  await page.getByRole("menuitem", { name: "Update all fields" }).click();
  await expect.poll(async () => (await fields(page))[0]?.result).toBe("1");
  await open.click();
  await page.getByRole("menuitemcheckbox", { name: "Show field codes" }).click();
  await expect(editor(page)).toContainText("{ SEQ a }");
  await open.click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Show field codes" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("while a header is open F9 updates its field; its page fields stay the view's", async ({
  page,
}) => {
  await load(
    page,
    documentOf([paragraph("body")], {
      section: {
        pageSize: { width: 8391, height: 11906 },
        margins: { top: 1440, right: 1000, bottom: 1440, left: 1000, header: 500 },
        headers: { default: "h" },
      },
      stories: {
        h: {
          kind: "header",
          content: {
            type: "doc",
            content: [paragraph(...field("SEQ h", "old"), " ", ...field("PAGE", "9"))],
          },
        },
      },
    }),
  );
  const box = await page.locator(".foli-header .foli-region-content").first().boundingBox();
  await page.mouse.dblclick((box?.x ?? 0) + 3, (box?.y ?? 0) + 3);
  const header = page.locator(".foli-story-mount [contenteditable=true]");
  await expect(header).toBeFocused();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("F9");
  await expect(header).toContainText("1 9");
  await page.keyboard.press("Escape");
  await expect(page.locator(".foli-header").first()).toContainText("1 1");
});

test("print updates the fields first", async ({ page }) => {
  await load(page, documentOf([pageBreak("a"), paragraph(...field("PAGE", "?"))]));
  const printed = await page.evaluate(() => {
    window.print = () => {
      (window as unknown as { printed: boolean }).printed = true;
    };
    window.foliEdit.view.print();
    return (window as unknown as { printed: boolean }).printed;
  });
  expect(printed).toBe(true);
  await expect.poll(async () => (await fields(page))[0]?.result).toBe("2");
});
