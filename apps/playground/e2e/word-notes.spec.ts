/**
 * Footnotes and endnotes in the editable view (11.10), on the editing page (`/edit.html`): their
 * numbers, their place on the pages, editing them where they are, and their menu and dialog.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type Json = Record<string, unknown>;
const MOD = "ControlOrMeta";
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });
const inStory = (page: Page) => page.locator(".foli-story-mount [contenteditable=true]");

const A5 = {
  pageSize: { width: 8391, height: 11906 },
  margins: { top: 1440, right: 1000, bottom: 1440, left: 1000, header: 500, footer: 400 },
};
const text = (value: string): Json => ({ type: "text", text: value });
const reference = (story: string): Json => ({
  type: "noteReference",
  attrs: { story },
  marks: [{ type: "characterStyle", attrs: { id: "FootnoteReference" } }],
});
const paragraph = (...content: (Json | string)[]): Json => ({
  type: "paragraph",
  content: content.map((c) => (typeof c === "string" ? text(c) : c)),
});
const note = (kind: "footnote" | "endnote", ...words: string[]): Json => ({
  kind,
  content: {
    type: "doc",
    content: words.map((value, i) => ({
      type: "paragraph",
      attrs: { style: "FootnoteText" },
      content: [
        ...(i
          ? []
          : [
              {
                type: "noteMark",
                marks: [{ type: "characterStyle", attrs: { id: "FootnoteReference" } }],
              },
            ]),
        text(i ? value : ` ${value}`),
      ],
    })),
  },
});
const documentOf = (blocks: Json[], stories: Json, more: Json = {}): Json => ({
  schemaVersion: 5,
  section: A5,
  defaults: { paragraph: { spacing: { after: 0 } } },
  styles: [
    { id: "Normal", type: "paragraph", name: "Normal", isDefault: true },
    {
      id: "FootnoteText",
      type: "paragraph",
      name: "footnote text",
      basedOn: "Normal",
      run: [{ type: "fontSize", attrs: { value: 18 } }],
    },
    {
      id: "FootnoteReference",
      type: "character",
      name: "footnote reference",
      run: [{ type: "verticalAlign", attrs: { value: "superscript" } }],
    },
  ],
  numbering: { abstracts: [], instances: [] },
  comments: [],
  content: { type: "doc", content: blocks },
  stories,
  ...more,
});
const lines = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => paragraph(`Line ${from + i}`));
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

async function load(page: Page, document: Json) {
  await page.goto("/edit.html?toolbar");
  await page.waitForFunction(() => "foliEdit" in window);
  await page.evaluate((doc) => window.foliEdit.load(doc as never), document);
}

/** What each page shows of notes: at the foot, and after the text. */
const pagesOfNotes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("section.foli-page")].map((p) => {
      const box = p.getBoundingClientRect();
      const groups = [...p.querySelectorAll<HTMLElement>(".foli-notes")];
      const foot = groups.filter((g) => g.style.position === "absolute");
      const shown = (list: HTMLElement[]) =>
        list.flatMap((g) => [...g.querySelectorAll<HTMLElement>("[data-foli-note]")]);
      const rules = groups.flatMap((g) => [...g.querySelectorAll("[data-foli-separator]")]);
      const bottom = box.bottom - Number.parseFloat(getComputedStyle(p).paddingBottom);
      return {
        foot: shown(foot).map((n) => n.dataset.foliNote),
        flow: shown(groups.filter((g) => g.style.position !== "absolute")).map(
          (n) => n.dataset.foliNote,
        ),
        rules: rules.length,
        footEnd: foot.length
          ? (foot.at(-1) as HTMLElement).getBoundingClientRect().bottom - bottom
          : 0,
        text: [...p.children]
          .filter((c) => !c.classList.contains("foli-region"))
          .map((c) => c.textContent),
      };
    }),
  );
const references = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-foli-note-ref]")].map((r) => r.textContent),
  );
const marks = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-foli-note] [data-foli-note-number]")].map(
      (r) => r.textContent,
    ),
  );
const storyText = (page: Page, id: string) =>
  page.evaluate((key) => window.foliEdit.editor.story(key)?.state.doc.textContent ?? null, id);
const hasStory = (page: Page, id: string) =>
  page.evaluate(
    (key) => Object.hasOwn(window.foliEdit.editor.getDocument().stories ?? {}, key),
    id,
  );
const bodyText = (page: Page) => page.evaluate(() => window.foliEdit.editor.state.doc.textContent);
const valid = (page: Page) => page.evaluate(() => window.foliEdit.validate());
const refsInBody = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    window.foliEdit.editor.state.doc.descendants((node) => {
      if (node.type.name === "noteReference") out.push(String(node.attrs.story));
      return true;
    });
    return out;
  });
const selectAfter = (page: Page, value: string) =>
  page.evaluate((wanted) => {
    window.foliEdit.view.focus();
    const { doc } = window.foliEdit.editor.state;
    let at = -1;
    doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text?.includes(wanted))
        at = pos + (node.text.indexOf(wanted) + wanted.length);
      return true;
    });
    window.foliEdit.editor.select(at);
  }, value);

const point = (page: Page, selector: string) =>
  page.evaluate((css) => {
    const element = document.querySelector<HTMLElement>(css) as HTMLElement;
    element.scrollIntoView({ block: "center" });
    const r = element.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 40), y: r.top + Math.min(r.height / 2, 8) };
  }, selector);

const oneNote = () =>
  documentOf([paragraph("Body", reference("footnote:1"), " text"), paragraph("More")], {
    "footnote:1": note("footnote", "Note text"),
  });

test("numbers, separator and note at the foot of the reference's page", async ({ page }) => {
  await load(
    page,
    documentOf(
      [
        paragraph("One", reference("footnote:1")),
        { type: "paragraph", content: [text("Break"), { type: "pageBreak" }] },
        paragraph("Two", reference("footnote:2"), reference("endnote:1")),
      ],
      {
        "footnote:1": note("footnote", "First"),
        "footnote:2": note("footnote", "Second"),
        "endnote:1": note("endnote", "Last"),
      },
    ),
  );
  expect(await references(page)).toEqual(["1", "2", "i"]);
  expect((await marks(page)).sort()).toEqual(["1", "2", "i"]);
  const shown = await pagesOfNotes(page);
  // The separator is Word's default here: the document has none of its own.
  expect(shown[0]?.foot).toEqual(["footnote:separator", "footnote:1"]);
  expect(shown[1]?.foot.at(-1)).toBe("footnote:2");
  // Endnotes follow the text of the last page.
  expect(shown[1]?.flow.at(-1)).toBe("endnote:1");
  for (const p of shown) expect(Math.abs(p.footEnd)).toBeLessThanOrEqual(1);
  // Numbers are not document text.
  expect(await bodyText(page)).toBe("OneBreakTwo");
});

test("a note longer than its page goes on under the continuation separator", async ({ page }) => {
  await load(
    page,
    documentOf([paragraph("Start", reference("footnote:1")), ...lines(3)], {
      "footnote:1": note("footnote", words(1500)),
    }),
  );
  const shown = await pagesOfNotes(page);
  expect(shown.length).toBeGreaterThan(1);
  expect(shown[0]?.foot).toContain("footnote:1");
  expect(shown[1]?.foot).toContain("footnote:1");
  expect(shown[1]?.foot).toContain("footnote:continuationSeparator");
  // What is left of the body goes on the next page, above what is carried.
  const all = shown.flatMap((p) => p.text).join(" ");
  expect(all).toContain("Line 2");
  for (const p of shown) expect(Math.abs(p.footEnd)).toBeLessThanOrEqual(1);
});

test("a growing note pushes its reference's lines, a line goes with its note", async ({ page }) => {
  await load(
    page,
    documentOf([...lines(28), paragraph("Ref", reference("footnote:1")), ...lines(3, 28)], {
      "footnote:1": note("footnote", "Short"),
    }),
  );
  const before = await pagesOfNotes(page);
  const on = before.findIndex((p) => p.foot.includes("footnote:1"));
  expect(before[on]?.text.some((t) => t?.startsWith("Ref"))).toBe(true);
  await page.evaluate(() => {
    const story = window.foliEdit.editor.story("footnote:1");
    story?.select(story.state.doc.content.size - 1);
  });
  await page.evaluate((more) => {
    window.foliEdit.editor.story("footnote:1")?.commands.insertText(more);
  }, words(120));
  await expect
    .poll(async () => (await pagesOfNotes(page)).some((p) => p.foot.includes("footnote:1")))
    .toBe(true);
  const after = await pagesOfNotes(page);
  // The note's first line is always on the reference's page.
  const page2 = after.findIndex((p) => p.foot.includes("footnote:1"));
  expect(after[page2]?.text.some((t) => t?.startsWith("Ref"))).toBe(true);
});

test("restarts on each page and takes its format from the settings", async ({ page }) => {
  await load(
    page,
    documentOf(
      [
        { type: "paragraph", content: [text("A"), reference("footnote:1"), { type: "pageBreak" }] },
        paragraph("B", reference("footnote:2"), reference("footnote:3")),
      ],
      {
        "footnote:1": note("footnote", "x"),
        "footnote:2": note("footnote", "y"),
        "footnote:3": note("footnote", "z"),
      },
      { settings: { footnotes: { restart: "eachPage", format: "lowerLetter" } } },
    ),
  );
  await expect.poll(() => references(page)).toEqual(["a", "a", "b"]);
  expect(await marks(page)).toEqual(["a", "a", "b"]);
});

test("notes of a section with columns are set across the foot of its columns", async ({ page }) => {
  await load(
    page,
    documentOf(
      [
        ...lines(3),
        paragraph("Ref", reference("footnote:1"), reference("footnote:2")),
        ...lines(60, 3),
      ],
      { "footnote:1": note("footnote", "First"), "footnote:2": note("footnote", "Second") },
      { section: { ...A5, columns: { count: 2, space: 400 } } },
    ),
  );
  const box = await page.evaluate(() => {
    const group = document.querySelector(".foli-notes") as HTMLElement;
    const [first, second] = document.querySelectorAll<HTMLElement>(".foli-column");
    const left = (e: Element) => e.getBoundingClientRect().left;
    const notes = [...group.querySelectorAll<HTMLElement>("[data-foli-note]")];
    const of = (id: string) => notes.find((n) => n.dataset.foliNote === id) as HTMLElement;
    const a = of("footnote:1").getBoundingClientRect();
    const b = of("footnote:2").getBoundingClientRect();
    return {
      first: left(of("footnote:1")) - left(first as Element),
      second: left(of("footnote:2")) - left(second as Element),
      level: a.top - b.top,
      rules: group.querySelectorAll("[data-foli-separator]").length,
    };
  });
  // Word sets them in the section's columns, level, one separator over the first.
  expect(Math.abs(box.first)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.second)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.level)).toBeLessThanOrEqual(1);
  expect(box.rules).toBe(1);
});

test("Ctrl+Alt+F inserts a note and types in it; Escape returns; undo takes all", async ({
  page,
}) => {
  await load(page, documentOf([paragraph("Body")], {}));
  await editor(page).click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press("Control+Alt+f");
  await expect(inStory(page)).toBeFocused();
  await page.keyboard.type("Typed note");
  expect(await storyText(page, "footnote:1")).toBe(" Typed note");
  await expect(inStory(page).locator("[data-foli-note-number]")).toHaveText("1");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
  expect(await references(page)).toEqual(["1"]);
  await page.keyboard.type("!");
  expect(await bodyText(page)).toBe("Body!");
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(0);
  await page.keyboard.press(`${MOD}+z`);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => hasStory(page, "footnote:1")).toBe(false);
  expect(await refsInBody(page)).toEqual([]);
  expect(await valid(page)).toBe(true);
});

test("double click opens a note and its number too; Shift+Alt+N goes back and forth", async ({
  page,
}) => {
  await load(page, oneNote());
  const inNote = await point(page, '[data-foli-note="footnote:1"] .foli-region-content');
  await page.mouse.dblclick(inNote.x, inNote.y);
  await expect(inStory(page)).toBeFocused();
  await expect(editor(page)).toHaveClass(/foli-in-story/);
  await page.keyboard.press("Shift+Alt+KeyN");
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => window.foliEdit.editor.state.selection.head)).toBe(6);
  await page.keyboard.press("Shift+Alt+KeyN");
  await expect(inStory(page)).toBeFocused();
  await page.keyboard.press("Escape");
  const number = await point(page, "[data-foli-note-ref]");
  await page.mouse.dblclick(number.x, number.y);
  await expect(inStory(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor(page)).not.toHaveClass(/foli-in-story/);
});

test("deleting the reference deletes the note, undo restores both", async ({ page }) => {
  await load(page, oneNote());
  await selectAfter(page, "Body");
  await page.keyboard.press("Delete");
  expect(await refsInBody(page)).toEqual([]);
  expect(await hasStory(page, "footnote:1")).toBe(false);
  expect((await pagesOfNotes(page))[0]?.foot).toEqual([]);
  await page.keyboard.press(`${MOD}+z`);
  expect(await refsInBody(page)).toEqual(["footnote:1"]);
  expect(await hasStory(page, "footnote:1")).toBe(true);
  expect((await pagesOfNotes(page))[0]?.foot).toContain("footnote:1");
});

test("tracked: a deleted reference stays struck, the note with it, until accepted", async ({
  page,
}) => {
  await load(page, oneNote());
  await page.evaluate(() => window.foliEdit.editor.commands.setTrackChanges(true));
  await selectAfter(page, "Body");
  await page.keyboard.press("Delete");
  expect(await refsInBody(page)).toEqual(["footnote:1"]);
  await expect(page.locator(".foli-notes del").first()).toBeVisible();
  await expect(page.locator("del [data-foli-note-ref]")).toHaveText("1");
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await expect.poll(() => refsInBody(page)).toEqual([]);
  expect(await hasStory(page, "footnote:1")).toBe(false);
});

const clipboard = (page: Page, type: "copy" | "cut") =>
  page.evaluate((kind) => {
    const data: Record<string, string> = {};
    const event = new Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (t: string, v: string) => {
          data[t] = v;
        },
        getData: (t: string) => data[t] ?? "",
      },
    });
    document.activeElement?.dispatchEvent(event);
    return data;
  }, type);
const paste = (page: Page, data: Record<string, string>) =>
  page.evaluate((types) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (t: string) => types[t] ?? "", files: [], types: Object.keys(types) },
    });
    document.activeElement?.dispatchEvent(event);
  }, data);

test("a copy makes a new note, a cut keeps it", async ({ page }) => {
  await load(page, oneNote());
  await editor(page).focus();
  await page.evaluate(() => window.foliEdit.editor.select(4, 7));
  const copied = await clipboard(page, "copy");
  await selectAfter(page, "More");
  await paste(page, copied);
  expect(await refsInBody(page)).toEqual(["footnote:1", "footnote:2"]);
  expect(await storyText(page, "footnote:2")).toBe(" Note text");
  expect(await references(page)).toEqual(["1", "2"]);
  await page.evaluate(() => window.foliEdit.editor.select(4, 7));
  const cut = await clipboard(page, "cut");
  expect(await hasStory(page, "footnote:1")).toBe(false);
  await selectAfter(page, "More");
  await paste(page, cut);
  expect((await refsInBody(page)).length).toBe(2);
  expect(await valid(page)).toBe(true);
});

// ---------- the five editing tests, in a note ----------

async function openNote(page: Page, id = "footnote:1") {
  const at = await point(page, `[data-foli-note="${id}"] .foli-region-content`);
  await page.mouse.dblclick(at.x, at.y);
  await expect(inStory(page)).toBeFocused();
}

test("T1 in a note: typing and formatting keep the tree valid at every key", async ({ page }) => {
  await load(page, oneNote());
  await openNote(page);
  await page.keyboard.press(`${MOD}+End`);
  for (const key of [" ", "a", "Enter", "c", `${MOD}+b`, "d", `${MOD}+b`, "e", "Enter", "f"]) {
    if (key.length === 1) await page.keyboard.type(key);
    else await page.keyboard.press(key);
    expect(await valid(page)).toBe(true);
  }
  const content = await page.evaluate(
    () => window.foliEdit.editor.getDocument().stories?.["footnote:1"]?.content,
  );
  expect(content?.content?.length).toBe(3);
  expect(JSON.stringify(content?.content?.[1])).toContain("bold");
  expect(content?.content?.[0]?.content?.[0]?.type).toBe("noteMark");
});

test("T2 in a note: a selection across paragraphs is replaced, undo restores it", async ({
  page,
}) => {
  await load(
    page,
    documentOf([paragraph("Body", reference("footnote:1"))], {
      "footnote:1": note("footnote", "One", "Two", "Three"),
    }),
  );
  await openNote(page);
  const snapshot = () =>
    page.evaluate(() => {
      const story = window.foliEdit.editor.story("footnote:1");
      return { doc: story?.state.doc.toJSON(), selection: story?.state.selection.toJSON() };
    });
  await page.evaluate(() => window.foliEdit.editor.story("footnote:1")?.select(4, 13));
  const before = await snapshot();
  await page.keyboard.type("X");
  expect(await storyText(page, "footnote:1")).toBe(" OXThree");
  await page.keyboard.press(`${MOD}+z`);
  expect(await snapshot()).toEqual(before);
  await expect(inStory(page)).toContainText("Two");
});

test("T3 in a note: pasted text and HTML go in, references do not", async ({ page }) => {
  await load(page, oneNote());
  await openNote(page);
  await page.keyboard.press(`${MOD}+End`);
  await paste(page, { "text/plain": " plain" });
  expect(await storyText(page, "footnote:1")).toBe(" Note text plain");
  await paste(page, { "text/html": "<p>one</p><p><b>two</b></p>" });
  expect(await storyText(page, "footnote:1")).toContain("one");
  await paste(page, {
    "application/x-foli+json": JSON.stringify({
      content: { type: "doc", content: [paragraph("kept", reference("footnote:1"))] },
      open: true,
    }),
  });
  expect(await storyText(page, "footnote:1")).toContain("kept");
  expect(await refsInBody(page)).toEqual(["footnote:1"]);
  expect(await valid(page)).toBe(true);
});

test("T4 in a note: a composition commits into it, one undo step", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP IME emulation is Chromium-only");
  await load(page, oneNote());
  await openNote(page);
  await page.keyboard.press(`${MOD}+End`);
  const cdp = await page.context().newCDPSession(page);
  for (const value of ["k", "か"])
    await cdp.send("Input.imeSetComposition", {
      text: value,
      selectionStart: value.length,
      selectionEnd: value.length,
    });
  await cdp.send("Input.insertText", { text: "漢" });
  await expect.poll(() => storyText(page, "footnote:1")).toBe(" Note text漢");
  await page.keyboard.press(`${MOD}+z`);
  expect(await storyText(page, "footnote:1")).toBe(" Note text");
  await expect(inStory(page)).toContainText("Note text");
});

test("T5 with a note: growing, it moves text across the page end, caret and undo kept", async ({
  page,
}) => {
  await load(
    page,
    documentOf([paragraph("Ref", reference("footnote:1")), ...lines(32)], {
      "footnote:1": note("footnote", "Note"),
    }),
  );
  const count = () => page.locator("section.foli-page").count();
  const before = await count();
  const body = await bodyText(page);
  await openNote(page);
  await page.keyboard.press(`${MOD}+End`);
  for (let i = 0; i < 12; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("tail");
  await expect.poll(count).toBeGreaterThan(before);
  await expect(inStory(page)).toBeFocused();
  expect(await bodyText(page)).toBe(body);
  expect((await storyText(page, "footnote:1"))?.endsWith("tail")).toBe(true);
  await page.waitForTimeout(600);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type("Q");
  expect(await storyText(page, "footnote:1")).toBe("Q");
  await expect.poll(count).toBe(before);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(count).toBeGreaterThan(before);
  expect((await storyText(page, "footnote:1"))?.endsWith("tail")).toBe(true);
  await expect(inStory(page)).toBeFocused();
  await page.keyboard.press("Escape");
  expect(await bodyText(page)).toBe(body);
});

test("the read-only pages put notes beneath the text after the column's last paragraph", async ({
  page,
}) => {
  await page.goto("/word.html");
  await page.waitForFunction(() => "foliWord" in window);
  const order = await page.evaluate(
    (doc) => {
      window.foliWord.show(doc, "markup");
      const first = document.querySelector(".foli-word-page > div") as HTMLElement;
      return [...first.children].map((c) =>
        c.classList.contains("foli-notes") ? "notes" : (c.textContent ?? ""),
      );
    },
    documentOf(
      [paragraph("One", reference("footnote:1")), paragraph("Two"), paragraph("Three")],
      {
        "footnote:1": note("footnote", "Beneath"),
      },
      { settings: { footnotes: { position: "beneathText" } } },
    ),
  );
  expect(order.at(-1)).toBe("notes");
  expect(order.slice(0, 3).map((t) => t.replace(/\d/g, ""))).toEqual(["One", "Two", "Three"]);
});

// ---------- the menu and the dialog ----------

test("the notes menu and options dialog work from the keyboard and pass axe", async ({ page }) => {
  await load(page, documentOf([paragraph("Body")], {}));
  await selectAfter(page, "Body");
  const button = page.getByRole("button", { name: "Notes", exact: true });
  await button.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Footnotes and endnotes" });
  await expect(menu).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".foli-menu").analyze()).violations).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(inStory(page)).toBeFocused();
  await page.keyboard.type("From the menu");
  await page.keyboard.press("Escape");
  expect(await storyText(page, "footnote:1")).toBe(" From the menu");

  await button.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menuitem", { name: "Note options…" }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Note options" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Notes")).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).include(".foli-table-dialog").analyze()).violations,
  ).toEqual([]);
  await dialog.getByLabel("Number format").selectOption("upperRoman");
  await dialog.getByLabel("Start at").fill("3");
  await dialog.getByLabel("Position").selectOption("beneathText");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => references(page)).toEqual(["III"]);
  const after = await pagesOfNotes(page);
  expect(after[0]?.flow).toContain("footnote:1");
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => references(page)).toEqual(["1"]);
});
