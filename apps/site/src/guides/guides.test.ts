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

describe("guides", () => {
  for (const name of readdirSync(guides).filter((n) => n.endsWith(".md")))
    it(`${name}: every ts and tsx sample is a file of apps/site/src/guides`, () => {
      const blocks = [...read(new URL(name, guides)).matchAll(/^```tsx?\n([\s\S]*?)^```$/gm)];
      expect(blocks.length).toBeGreaterThan(0);
      for (const [, code] of blocks)
        expect(
          sources.some((source) => source.includes(code as string)),
          code,
        ).toBe(true);
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
