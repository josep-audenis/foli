/**
 * Deterministic documents for pagination tests (visual regression, print, benchmarks), and the
 * bundled test font that makes their page breaks the same on every run.
 *
 * The font is Tinos (SIL Open Font License 1.1, from `@fontsource/tinos`, a dev dependency;
 * see THIRD_PARTY_NOTICES.md). It is only used by tests: Foli ships no font.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

const STORAGE_KEY = "foli-playground-document";
const FONT_FAMILY = "Foli Test";
const FONT_PATH = "/__foli-test-font/";
const FACES = [
  { weight: 400, style: "normal" },
  { weight: 700, style: "normal" },
  { weight: 400, style: "italic" },
  { weight: 700, style: "italic" },
];
const fontFile = (face: { weight: number; style: string }) =>
  `tinos-latin-${face.weight}-${face.style}.woff2`;
const require = createRequire(import.meta.url);

type Block = Record<string, unknown>;
interface Settings {
  pageSize: { width: number; height: number };
  margins: { top: number; right: number; bottom: number; left: number };
}
export interface Fixture {
  name: string;
  settings: Settings;
  blocks: Block[];
}

const A4: Settings = {
  pageSize: { width: 210, height: 297 },
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
};

const WORDS =
  "the quick brown fox jumps over a lazy dog while seven bright ships sail past an old harbour wall".split(
    " ",
  );
/** `count` words, the same for the same `seed` on every run. */
function words(count: number, seed = 0): string {
  return Array.from({ length: count }, (_, i) => WORDS[(i * 7 + seed * 3) % WORDS.length]).join(
    " ",
  );
}
const text = (value: string, marks?: string[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {}),
});
const paragraph = (...content: Block[]): Block => ({ type: "paragraph", content });
const heading = (level: number, value: string): Block => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
/** Paragraphs of one to five lines. */
const mixed = (count: number, seed = 0) =>
  Array.from({ length: count }, (_, i) =>
    paragraph(text(`${i + 1}. ${words(4 + ((i * 13 + seed) % 5) * 14, i + seed)}`)),
  );

export const FIXTURES: Fixture[] = [
  {
    name: "short",
    settings: A4,
    blocks: [
      heading(1, "A short document"),
      paragraph(text(words(40))),
      paragraph(text("Marks: "), text("bold", ["bold"]), text(", "), text("italic", ["italic"])),
    ],
  },
  { name: "multi-page", settings: A4, blocks: [heading(1, "Several pages"), ...mixed(40)] },
  {
    name: "long-paragraph",
    settings: A4,
    blocks: [heading(1, "One long paragraph"), paragraph(text(words(1400, 1)))],
  },
  {
    // The heading fits as the last block of page 1 (it does with keep-with-next off): it moves
    // to page 2 with its paragraph.
    name: "heading-at-boundary",
    settings: A4,
    blocks: [
      heading(1, "Heading at a page boundary"),
      ...Array.from({ length: 21 }, (_, i) => paragraph(text(`Line ${i + 1}: ${words(6, i)}`))),
      heading(2, "This heading keeps with the next paragraph"),
      paragraph(text(words(60, 2))),
      ...mixed(6, 3),
    ],
  },
  {
    name: "explicit-breaks",
    settings: A4,
    blocks: [
      heading(1, "Explicit page breaks"),
      paragraph(text(words(30))),
      paragraph(text("Before a break in the middle."), { type: "pageBreak" }, text("After it.")),
      paragraph(text(words(30, 1)), { type: "pageBreak" }),
      paragraph(text("A paragraph after a break at the end of the previous one.")),
      { type: "paragraph" },
    ],
  },
  {
    // Schema v1 has no font-size mark: sizes differ per block (headings) and by weight/style.
    name: "mixed-font-sizes",
    settings: A4,
    blocks: [1, 2, 3, 4, 5, 6].flatMap((level) => [
      heading(level, `Heading level ${level}`),
      paragraph(
        text(`${words(30, level)} `),
        text(words(12, level + 1), ["bold"]),
        text(" "),
        text(words(12, level + 2), ["italic"]),
        text(" "),
        text(words(8, level + 3), ["bold", "italic", "underline"]),
        text(` ${words(40, level + 4)}`),
      ),
      ...mixed(2, level),
    ]),
  },
  {
    name: "different-margins",
    settings: {
      pageSize: { width: 215.9, height: 279.4 },
      margins: { top: 10, right: 45, bottom: 30, left: 15 },
    },
    blocks: [heading(1, "US Letter, uneven margins"), ...mixed(30, 5)],
  },
];

/** Serves the bundled test font to the page; call before the page loads. */
export async function routeTestFont(page: Page): Promise<void> {
  await page.route(`**${FONT_PATH}*`, (route) => {
    const file = new URL(route.request().url()).pathname.slice(FONT_PATH.length);
    if (!FACES.some((face) => fontFile(face) === file)) return route.abort();
    return route.fulfill({
      contentType: "font/woff2",
      body: readFileSync(require.resolve(`@fontsource/tinos/files/${file}`)),
    });
  });
}

/** Makes the editor use the test font, and resolves once text is laid out with it. */
export async function loadTestFont(page: Page, extraCss = ""): Promise<void> {
  await page.addStyleTag({
    content: [
      ...FACES.map(
        (face) =>
          `@font-face { font-family: "${FONT_FAMILY}"; src: url("${FONT_PATH}${fontFile(face)}") format("woff2"); font-weight: ${face.weight}; font-style: ${face.style}; font-display: block; }`,
      ),
      `.foli-canvas.foli-canvas { --foli-font-family: "${FONT_FAMILY}"; }`,
      extraCss,
    ].join("\n"),
  });
  await page.evaluate(
    ([family, faces]) =>
      Promise.all(
        faces.map((face) => document.fonts.load(`${face.style} ${face.weight} 16px "${family}"`)),
      ),
    [FONT_FAMILY, FACES] as const,
  );
  // WebKit applies a loaded font to the layout a while after `load()` resolves: wait until text
  // is laid out with it, or a caller could see the fallback font's layout as final.
  await page.waitForFunction((family) => {
    const width = (font: string) => {
      const probe = document.createElement("span");
      probe.style.cssText = `position: absolute; visibility: hidden; white-space: nowrap; font: 16px ${font}`;
      probe.textContent = "The quick brown fox jumps 0123";
      document.body.append(probe);
      const result = probe.getBoundingClientRect().width;
      probe.remove();
      return result;
    };
    return width(`"${family}", monospace`) !== width("monospace");
  }, FONT_FAMILY);
}

/** The stored form of a document (what the playground keeps in localStorage). */
export function stored(settings: Settings, blocks: Block[]) {
  return { schemaVersion: 1, settings, content: { type: "doc", content: blocks } };
}

/**
 * Opens the playground on a fixture, laid out with the bundled test font. The playground first
 * lays it out with its own font, then re-flows once the test font has loaded (the path of a
 * web font on a real page); the benchmarks load the font first.
 */
export async function openFixture(page: Page, fixture: Fixture): Promise<void> {
  await routeTestFont(page);
  await page.goto("/");
  await page.evaluate(([key, doc]) => localStorage.setItem(key, doc), [
    STORAGE_KEY,
    JSON.stringify(stored(fixture.settings, fixture.blocks)),
  ] as const);
  await page.reload();
  // The sticky bar would cover pages in element screenshots of a scrolled page.
  await loadTestFont(page, ".playground-bar { position: static; }");
  await page.evaluate(() => {
    getSelection()?.removeAllRanges();
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await settled(page);
}

/**
 * A document of `sections` sections, each a heading and thirteen paragraphs of one to five lines
 * (some split across pages): about one A4 page per section with the test font.
 */
export function benchDocument(sections: number) {
  return stored(
    A4,
    Array.from({ length: sections }, (_, i) => [
      heading(2, `Section ${i + 1}`),
      ...mixed(13, i),
    ]).flat(),
  );
}

/**
 * Each page's elements as `<block>[.<fragment>] (<characters>) <first characters>`, for
 * snapshots: the page breaks of the document as laid out.
 */
export function pageBreaks(page: Page): Promise<string[][]> {
  return page.evaluate(() => {
    const host = document.querySelector('[role="textbox"]');
    let block = -1;
    return [...(host?.querySelectorAll(":scope > .foli-page") ?? [])].map((sheet) =>
      [...sheet.children].map((element) => {
        const fragment = Number(element.getAttribute("data-fragment") ?? 0);
        if (fragment === 0) block++;
        const content = element.textContent ?? "";
        return `${block}${fragment ? `.${fragment}` : ""} (${content.length}) ${content.slice(0, 24)}`;
      }),
    );
  });
}

/** Waits until the layout no longer changes between animation frames (font load re-flows). */
export async function settled(page: Page): Promise<void> {
  const frames = () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  let last = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    await frames();
    const now = JSON.stringify(await pageBreaks(page));
    if (now === last) return;
    last = now;
  }
  throw new Error("The layout did not settle");
}
