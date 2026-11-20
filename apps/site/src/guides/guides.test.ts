import { readdirSync, readFileSync } from "node:fs";
import { createEditor } from "@folijs/core";
import { describe, expect, it } from "vitest";
import { insertCard } from "./card.js";
import { acme, demo } from "./commands.js";
import { fromDocx, load, save, toDocx } from "./docx.js";
import { keys } from "./keymap.js";
import { review } from "./plugin.js";

// The guides' code samples are this folder's files (typechecked with the site): every `ts` and
// `tsx` block of docs/guides/*.md must be found in one of them, so a sample cannot drift from code
// that compiles. Most of them run here too.
const root = new URL("../../../../", import.meta.url);
const read = (path: string | URL) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const guides = new URL("docs/guides/", root);
const here = new URL("./", import.meta.url);
const sources = readdirSync(here)
  .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
  .map((name) => read(new URL(name, here)));

/** Fenced blocks as `[language, code]`; the language is the whole info string. */
function fences(markdown: string): [string, string][] {
  const found: [string, string][] = [];
  let open: { lang: string; lines: string[] } | null = null;
  for (const line of markdown.split("\n")) {
    const fence = /^```(.*)$/.exec(line);
    if (open && fence && fence[1] === "") {
      found.push([open.lang, open.lines.map((l) => `${l}\n`).join("")]);
      open = null;
    } else if (open) open.lines.push(line);
    else if (fence) open = { lang: fence[1] as string, lines: [] };
  }
  return found;
}

/** `code` at the start of a line of a sample file, not inside a block comment. */
const inSample = (code: string) =>
  sources.some((source) => {
    for (let i = source.indexOf(code); i >= 0; i = source.indexOf(code, i + 1))
      if (
        (i === 0 || source[i - 1] === "\n") &&
        source.lastIndexOf("/*", i - 1) <= source.lastIndexOf("*/", i - 1)
      )
        return true;
    return false;
  });

describe("guides", () => {
  it("finds a sample only in code, at a line start", () => {
    expect(fences("```ts\na\n```\n```bash\nb\n```\n")).toEqual([
      ["ts", "a\n"],
      ["bash", "b\n"],
    ]);
    expect(inSample("export const mention")).toBe(true);
    expect(inSample("mention: ViewExtension")).toBe(false);
    expect(inSample("Inserts a mention at the selection")).toBe(false);
  });

  for (const name of readdirSync(guides).filter((n) => n.endsWith(".md")))
    it(`${name}: every ts and tsx sample is a file of apps/site/src/guides`, () => {
      const blocks = fences(read(new URL(name, guides)));
      // Another language (`typescript`, `js`, `ts title=…`) would escape the check.
      for (const [lang] of blocks) expect(["ts", "tsx", "css", "bash"], name).toContain(lang);
      const code = blocks.filter(([lang]) => lang === "ts" || lang === "tsx");
      expect(code.length).toBeGreaterThan(0);
      for (const [, sample] of code) expect(inSample(sample), sample).toBe(true);
    });

  it("theming.md names only CSS variables the stylesheet defines", () => {
    const css = read(new URL("packages/react/styles.css", root));
    const names = new Set(read(new URL("theming.md", guides)).match(/--foli-[a-z-]+/g));
    expect(names.size).toBeGreaterThan(10);
    for (const variable of names) expect(css, variable).toContain(`${variable}:`);
  });
});

describe("the extension guide's samples", () => {
  const types = (editor: ReturnType<typeof createEditor>) => JSON.stringify(editor.getDocument());

  it("insert a mention by name, mark text, insert a card", () => {
    const editor = demo();
    editor.run(insertCard("Checklist", ["Owner", "Due date"]));
    const json = types(editor);
    expect(json).toContain('"acme:mention"');
    expect(json).toContain('"acme:card"');
    editor.commands.toggleTopic("finance");
    editor.commands.insertText("budget");
    expect(types(editor)).toContain('"acme:topic"');
  });

  it("decorate TODOs, replace (c), lock the document", () => {
    const editor = createEditor({ extensions: acme });
    editor.commands.insertText("TODO (c)");
    expect(editor.state.doc.textContent).toBe("TODO ©");
    expect(review.decorations?.(editor.state)).toEqual([
      { from: 1, to: 5, attrs: { class: "acme-todo" } },
    ]);
    editor.commands.setLocked(true);
    editor.commands.insertText("x");
    expect(editor.state.doc.textContent).toBe("TODO ©");
    editor.commands.setLocked(false);
    editor.commands.insertText("x");
    expect(editor.state.doc.textContent).toBe("TODO ©x");
  });

  it("take a key", () => {
    const editor = createEditor({ plugins: [keys], extensions: acme });
    expect(editor.handleKey("Mod-Shift-m")).toBe(true);
    expect(types(editor)).toContain('"label":"Ada Lovelace"');
  });

  it("save and load as JSON, with and without the extensions", () => {
    const editor = demo();
    const json = save(editor);
    expect(load(json).getDocument()).toEqual(editor.getDocument());
    const without = createEditor({ document: JSON.parse(json) });
    expect(without.getDocument()).toEqual(editor.getDocument());
  });

  it("go through .docx and back", async () => {
    const editor = demo();
    editor.run(insertCard("Checklist", ["Owner"]));
    const { editor: back } = await fromDocx(await toDocx(editor));
    const json = types(back);
    expect(json).toContain('"acme:mention"');
    expect(json).toContain('"acme:card"');
  });
});
