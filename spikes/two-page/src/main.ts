import { SpikeEditor } from "./editor.js";

const WORDS =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat".split(
    " ",
  );

/** Deterministic sample text: ~3000 characters per page, paragraphs of 300–1200 characters. */
function sampleParagraphs(pages: number): string[] {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const paras: string[] = [];
  let total = 0;
  while (total < pages * 3000) {
    const target = 300 + Math.floor(rand() * 900);
    const words: string[] = [];
    let length = 0;
    while (length < target) {
      const word = WORDS[Math.floor(rand() * WORDS.length)] as string;
      words.push(word);
      length += word.length + 1;
    }
    const text = words.join(" ");
    paras.push(text.charAt(0).toUpperCase() + text.slice(1) + ".");
    total += text.length;
  }
  return paras;
}

await document.fonts.ready;
const host = document.getElementById("editor");
if (!host) throw new Error("#editor missing");
const editor = new SpikeEditor(host);
const pages = Number(new URLSearchParams(location.search).get("pages") ?? 2);
const t0 = performance.now();
editor.load(sampleParagraphs(pages));
const initialLayoutMs = performance.now() - t0;

// Test hooks for Playwright (spike only).
Object.assign(window, {
  __spike: {
    editor,
    initialLayoutMs,
    load: (paras: string[]) => editor.load(paras),
    state: () => ({ paras: editor.paras, sel: editor.sel }),
    fragments: () => editor.pages.flatMap((frags, page) => frags.map((f) => ({ ...f, page }))),
    domSelection: () => editor.readDomSelection(),
    lastUpdateMs: () => editor.lastUpdateMs,
    warnings: () => editor.warnings,
  },
});
