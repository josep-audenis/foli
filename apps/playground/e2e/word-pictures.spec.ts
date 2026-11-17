/**
 * Inline pictures in the editable view (10.8b): the corpus's picture report (07) opened on the
 * editing page, its pictures drawn from the package's images at their size, laid out in their
 * lines, with the text around them editable.
 */
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const editor = (page: Page) => page.getByRole("textbox", { name: "Document" });

async function open(page: Page, name: string): Promise<void> {
  await page.goto("/edit.html");
  await page.waitForFunction(() => "foliEdit" in window);
  const base64 = readFileSync(new URL(name, CORPUS)).toString("base64");
  await page.evaluate((data) => window.foliEdit.loadDocx(data), base64);
  await page.waitForFunction(() => document.querySelectorAll("section.foli-page").length >= 1);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

const pictures = (page: Page) => editor(page).locator("img[data-foli-picture]");

test("pictures are drawn from the package's images at their size, with their alt text", async ({
  page,
}) => {
  await open(page, "07-picture-report.docx");
  await expect(pictures(page)).toHaveCount(2);
  // Loaded (an object URL for the package's part), at 4572638 × 2667372 EMU.
  await expect
    .poll(() =>
      pictures(page).evaluateAll((imgs) =>
        (imgs as HTMLImageElement[]).map((img) => ({
          loaded: img.complete && img.naturalWidth > 0,
          width: Math.round(img.getBoundingClientRect().width),
          height: Math.round(img.getBoundingClientRect().height),
        })),
      ),
    )
    .toEqual([
      { loaded: true, width: 480, height: 280 },
      { loaded: true, width: 480, height: 280 },
    ]);
  await expect(pictures(page).first()).toHaveAttribute(
    "alt",
    "Bar chart of monthly readings rising from 120 to 240",
  );
  // The second has no alt text: marked.
  await expect(pictures(page).nth(1)).toHaveAttribute("data-foli-no-alt", "");
  // Not editable inside: no browser resize handles, one position in the text.
  expect(
    await pictures(page)
      .first()
      .evaluate((img) => (img.parentElement as HTMLElement).contentEditable),
  ).toBe("false");
});

test("text typed beside a picture goes around it, the picture kept", async ({ page }) => {
  await open(page, "07-picture-report.docx");
  // The caret right after the first picture, then typing.
  await page.evaluate(() => {
    const { editor } = window.foliEdit;
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === "picture") at = pos + 1;
    });
    editor.select(at);
  });
  await editor(page).focus();
  await page.keyboard.type("Fig. 1");
  const around = await page.evaluate(() => {
    let text = "";
    window.foliEdit.editor.state.doc.descendants((node) => {
      let has = false;
      node.forEach((child) => {
        if (child.type.name === "picture") has = true;
      });
      if (!text && node.isTextblock && has)
        node.forEach((child) => {
          text +=
            child.type.name === "picture" ? "[picture]" : child.isText ? (child.text ?? "") : "";
        });
    });
    return text;
  });
  expect(around).toContain("[picture]Fig. 1");
  await expect(pictures(page)).toHaveCount(2);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
});

test("pages with pictures have no axe violations", async ({ page }) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await open(page, "07-picture-report.docx");
  const violations = (await new AxeBuilder({ page }).include("#editor > .foli-page").analyze())
    .violations;
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
});

// ---------- selecting, resizing, inserting (10.8d) ----------

/** The first picture's model attributes and position. */
const firstPicture = (page: Page) =>
  page.evaluate(() => {
    let found: { pos: number; width: number; height: number } | null = null;
    window.foliEdit.editor.state.doc.descendants((node, pos) => {
      if (!found && node.type.name === "picture")
        found = { pos, width: node.attrs.width as number, height: node.attrs.height as number };
    });
    return found as unknown as { pos: number; width: number; height: number };
  });

test("a click selects a picture; dragging its handle resizes it, the aspect ratio kept", async ({
  page,
}) => {
  await open(page, "07-picture-report.docx");
  const before = await firstPicture(page);
  await pictures(page).first().click();
  await expect
    .poll(() => page.evaluate(() => window.foliEdit.editor.state.selection.toJSON()))
    .toEqual({ type: "node", anchor: before.pos, head: before.pos + 1 });
  const handle = editor(page).locator("[data-foli-resize]");
  await expect(handle).toHaveCount(1);
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await firstPicture(page)).width).toBeLessThan(before.width);
  const after = await firstPicture(page);
  // As much narrower as the pointer moved (from the handle's centre), the same shape.
  const moved = box.width / 2 + 120;
  expect(Math.abs(before.width - after.width - moved * 9525)).toBeLessThan(3 * 9525);
  expect(Math.abs(after.height / after.width - before.height / before.width)).toBeLessThan(0.01);
  expect(await page.evaluate(() => window.foliEdit.validate())).toBe(true);
  // Escape cancels a resize.
  const box2 = await handle.boundingBox();
  if (!box2) throw new Error("no handle");
  await page.mouse.move(box2.x + 5, box2.y + 5);
  await page.mouse.down();
  await page.mouse.move(box2.x + 80, box2.y + 5, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await firstPicture(page)).width).toBe(after.width);
});

test("image files are inserted through the upload hook at their natural size", async ({ page }) => {
  await open(page, "07-picture-report.docx");
  const inserted = await page.evaluate(async () => {
    // A 2×1 PNG.
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAEAG/MCAeVKGkwAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const { editor, view } = window.foliEdit;
    editor.select(1);
    const n = await view.insertFiles([new File([bytes], "dot.png", { type: "image/png" })]);
    const picture = editor.state.doc.firstChild?.firstChild;
    return {
      n,
      type: picture?.type.name,
      width: picture?.attrs.width,
      height: picture?.attrs.height,
      resource: editor.getDocument().resources?.[String(picture?.attrs.resource)],
    };
  });
  expect(inserted).toMatchObject({ n: 1, type: "picture", width: 2 * 9525, height: 9525 });
  expect(inserted.resource?.data).toMatch(/^data:image\/png;base64,/);
  // No alt text yet: marked.
  await expect(editor(page).locator("[data-foli-no-alt]").first()).toBeVisible();
});

test("an image pasted alone becomes a picture", async ({ page, browserName }) => {
  // A synthetic paste event carries its files in Chromium only (Firefox ignores the init's
  // clipboardData, WebKit's has no contents); the insert itself is tested in all three above.
  test.skip(browserName !== "chromium", "no files in a synthetic paste event");
  await open(page, "07-picture-report.docx");
  await page.evaluate(() => window.foliEdit.editor.select(1));
  await editor(page).focus();
  await editor(page).evaluate((host) => {
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAEAG/MCAeVKGkwAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    host.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.foliEdit.editor.state.doc.firstChild?.firstChild?.type.name),
    )
    .toBe("picture");
});

test("a picture goes where it was pasted, however the text changed during its upload", async ({
  page,
}) => {
  await open(page, "07-picture-report.docx");
  const result = await page.evaluate(async () => {
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAEAG/MCAeVKGkwAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const { editor, view } = window.foliEdit;
    // A slow upload: resolved by hand.
    let done = (_src: string) => {};
    view.setOptions({ upload: () => new Promise<string>((resolve) => (done = resolve)) });
    const first = editor.state.doc.firstChild?.textContent ?? "";
    editor.select(3);
    const insert = view.insertFiles([new File([bytes], "dot.png", { type: "image/png" })]);
    // Meanwhile: text typed at the start, the caret moved away.
    await new Promise((r) => setTimeout(r, 100));
    editor.select(1);
    editor.commands.insertText("XYZ");
    editor.select(1);
    done(`data:image/png;base64,${base64}`);
    const n = await insert;
    const paragraph = editor.state.doc.firstChild;
    let at = -1;
    paragraph?.forEach((child, offset) => {
      if (child.type.name === "picture") at = offset;
    });
    return {
      n,
      at,
      before: paragraph?.textBetween(0, Math.max(at, 0)),
      first,
      caret: editor.state.selection.head,
    };
  });
  expect(result.n).toBe(1);
  // Two characters in, plus the three typed before them.
  expect(result.before).toBe(`XYZ${result.first.slice(0, 2)}`);
  // The caret the user put at the start stays there.
  expect(result.caret).toBe(1);
});

test("a picture pending upload never goes into a document opened meanwhile", async ({ page }) => {
  await open(page, "07-picture-report.docx");
  const result = await page.evaluate(async () => {
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAEAG/MCAeVKGkwAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const { editor, view, sample } = window.foliEdit;
    let done = (_src: string) => {};
    view.setOptions({ upload: () => new Promise<string>((resolve) => (done = resolve)) });
    const insert = view.insertFiles([new File([bytes], "dot.png", { type: "image/png" })]);
    await new Promise((r) => setTimeout(r, 100));
    editor.setDocument(sample);
    done(`data:image/png;base64,${base64}`);
    const n = await insert;
    let pictures = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "picture") pictures++;
    });
    return { n, pictures };
  });
  expect(result).toEqual({ n: 0, pictures: 0 });
});

test("image files dropped become pictures where they are dropped", async ({
  page,
  browserName,
}) => {
  // A synthetic drop carries its files in Chromium only.
  test.skip(browserName !== "chromium", "no files in a synthetic drop event");
  await open(page, "07-picture-report.docx");
  const first = editor(page).locator("section.foli-page p").first();
  const box = await first.boundingBox();
  if (!box) throw new Error("no paragraph");
  await editor(page).evaluate(
    (host, at) => {
      const base64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAEAG/MCAeVKGkwAAAAASUVORK5CYII=";
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "dot.png", { type: "image/png" }));
      const init = {
        dataTransfer: data,
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
        cancelable: true,
      };
      host.dispatchEvent(new DragEvent("dragover", init));
      host.dispatchEvent(new DragEvent("drop", init));
    },
    { x: box.x + 2, y: box.y + box.height / 2 },
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.foliEdit.editor.state.doc.firstChild?.firstChild?.type.name),
    )
    .toBe("picture");
});

test("the toolbar inserts a picture from a file with its alt text; the dialog passes axe", async ({
  page,
}) => {
  test.slow(); // axe takes several seconds per run in Firefox
  await open(page, "07-picture-report.docx");
  await page.evaluate(() => window.foliEdit.editor.select(1));
  await page.getByRole("button", { name: "Picture…" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert picture" });
  await expect(dialog).toBeVisible();
  const violations = (await new AxeBuilder({ page }).include(".foli-picture-dialog").analyze())
    .violations;
  expect(violations.map((v) => v.id)).toEqual([]);
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAEAG/MCAeVKGkwAAAAASUVORK5CYII=";
  await page.getByLabel("Image").setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await page.getByLabel("Alt text", { exact: true }).fill("A red dot");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await expect(dialog).toHaveCount(0);
  const picture = await page.evaluate(() => {
    const node = window.foliEdit.editor.state.doc.firstChild?.firstChild;
    return { type: node?.type.name, alt: node?.attrs.alt, width: node?.attrs.width };
  });
  expect(picture).toEqual({ type: "picture", alt: "A red dot", width: 2 * 9525 });
});
