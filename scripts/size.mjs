// Bundle size, as an app gets it: each package's published entry (`dist`, after `pnpm build`)
// bundled with its Foli dependencies, fully minified, React external; and an app that imports
// only `FoliEditor`, where `sideEffects` and tree shaking decide what is left. Fails when a
// bundle grows past its budget. Run: `pnpm size` (part of `pnpm check`). Numbers and method:
// docs/benchmarks.md, "Bundle size".

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = (name) => join(root, "packages", name, "dist", "index.js").replaceAll("\\", "/");
const scratch = mkdtempSync(join(tmpdir(), "foli-size-"));
const appEntry = join(scratch, "app.js");
writeFileSync(appEntry, `export { FoliEditor } from "${dist("react")}";\n`);

/**
 * Gzipped bytes allowed per bundle, about 15% over its size when set (6.4: 14.1, 19.9, 25.3 and
 * 25.2 kB). Raise one only with a reason in the PR. Core raised in 7.1 (16.6 kB): the structure
 * engine for lists (ReplaceAroundStep, wrap/lift/split/join and their checks, NodeSelection).
 * View and React raised in 7.3 (22.7 and 29.0 kB): schema v2 and nested blocks on pages.
 * Core raised again in 7.5 (18.8 kB): list editing commands. React raised in 7.6 (33.5 kB): the
 * link dialog, and core's link commands. View raised in 7.8 (26.7 kB): the HTML reader for
 * schema v2 (lists, Word and Google Docs lists, links, colors, alignment) and block paste;
 * React with it (37.7 kB, 2% headroom left). Docx added in 8.2
 * (5.9 kB): zip, XML reader, package, with the checks untrusted files need. Core raised in
 * 8.3 (25.9 kB): schema v3, its envelope validation and the v2 -> v3 migration, beside v2 until
 * the editor moves to v3 (8.7) and v2's types go; view and React do not include it. Docx raised
 * in 8.4 (24.0 kB): the import, and core with it (schema v3, its validation), which an app
 * with the editor already loads.
 * Docx raised again in 8.5 (32.7 kB): lossless export (writers, part rebuilding, merges).
 * Core, view and React raised in 8.7a (30.2, 40.8 and 52.3 kB): the editor and view take a
 * schema v3 document beside v2 (its validation and migration, formatting resolution, Word's
 * blocks); v2 goes in 8.7d, and the budgets are set again then. Core and React raised again in
 * 8.7b (33.4 and 56.2 kB): Word formatting on v3 (styles, fonts, sizes, spacing, indentation,
 * lists as numbering) and the toolbar's Word controls. Core, view and React raised in 8.7c
 * (36.1, 46.7 and 59.4 kB): copy and paste on v3 (definitions carried and fitted to the
 * document, HTML through the v2 -> v3 migration). The view's share is mostly core's envelope
 * validation and migration, which `createEditor` already brings into an app. Set again in
 * 8.7d2 (33.8, 44.7 and 54.4 kB, about 4% headroom): v2's editing commands, renderer, list
 * containers and toolbar removed. Core and React raised in 9.2 (36.2 and 57.3 kB): tracked
 * changes (the transaction rebuild, its plugin and commands). Raised again in 9.4 (38.2 and
 * 59.4 kB): formatting changes recorded (9.3), accepting and rejecting changes. Raised again in
 * 9.6 (40.0 and 61.9 kB): the review view and toolbar group (9.5), comment commands. React raised
 * in 9.7 (63.7 kB): the comments pane. All raised in 10.3 (core 43.9, view 50.0, React 68.4,
 * docx 37.5 kB): schema v4 (table, row, cell and picture nodes and their property checks,
 * table styles, resources, Word's table rules) and the table style resolution; view, React and
 * docx carry core's schema and validation. Docx, view and React raised in 10.4 (41.0, 50.8 and
 * 69.3 kB): reading and writing tables and table styles; the view's read-only table from the
 * model (with core's table style resolution). View and React raised in 10.5 (53.7 and 72.3 kB):
 * tables on pages in the editor (cell paragraphs as blocks, frames per page, rows cut across pages).
 * Core, view and React raised in 10.6a (45.9, 55.2 and 74.2 kB): editing across a table's edges,
 * row revisions tracked, reviewed in cells. Raised in 10.6b and c (47.9, 57.1 and 76.2 kB):
 * Tab and arrows in tables, cell selections (rectangle, merges, view reading and drawing).
 * Raised in 10.6d (48.8, 58.6 and 77.6 kB): copying and pasting cells and rows (a selection's
 * cells as a table, filling cells from the selected one, table styles carried). Core raised in
 * 10.7a (50.8 kB): table commands (insert a table, rows and columns) and Word's Table Grid style.
 * React raised in 10.7d (82.0 kB): the toolbar's table menu, insert table dialog, table style
 * box and shading menu, which bring core's table commands into an app with the toolbar.
 * Docx raised in 10.8a (43.9 kB): inline pictures read and written (drawings patched in place,
 * new drawings, media parts and their bytes). View raised in 10.8b (60.5 kB): pictures drawn
 * in their lines (their images' URLs, placeholders, the missing alt text mark). Core raised in
 * 10.8c (52.7 kB): picture commands (insert with its resource, size, alt text). View and React
 * raised in 10.8d (62.5 and 85.4 kB): selecting and resizing pictures, pasting and dropping
 * image files through the upload hook. React raised in 10.8e (87.9 kB): the toolbar's picture
 * dialog (insert from a file, alt text, size). Docx raised in 10.9b (44.9 kB): floating pictures
 * read and written (`wp:anchor` positions and wrapping, new anchors). View raised in 10.9c
 * (63.5 kB): floating pictures drawn as CSS floats at their paragraphs' start. All raised in
 * 11.3 (core 53.7, view 65.4, React 89.8, docx 46.9 kB): schema v5 (the field, control and note
 * nodes, the checks of stories, controls and settings), carried by every package. Docx raised
 * in 11.4 (50.8 kB): headers, footers and notes read and written as stories, checked. Raised
 * in 11.5 (52.7 kB): fields and content controls read and written. Core, view and React raised
 * in 11.6 (55.7, 68.8 and 95.7 kB): section commands, `EnvelopeStep` and tracked setups; columns,
 * bands and balancing in the flow and both renderers; the section menu and page setup dialog.
 * Core and React raised in 11.7 (57.1 and 96.0 kB so far): story editors, `StoryStep`, the header
 * and footer commands. Docx raised in 11.7 (53.5 kB): `word/settings.xml` read and written back.
 * View and React raised in 11.7 (73.6 and 102.5 kB): headers and footers on pages in both
 * renderers, a story edited in place (a second view mounted on its page), the header menu.
 * Core, view and React raised in 11.8 (66.6, 86.4 and 114.6 kB): fields (finding them, the
 * selection rules, every field Foli updates with Word's switches, tables of contents rebuilt,
 * the insert commands), hidden code ranges and shading in the view, the fields menu and dialog.
 * Raised again after its review (68.8, 88.8 and 117.2 kB): Word's numeric pictures in full, self
 * references, what a table of contents lists, results written a paragraph at a time.
 * Core and React raised in 11.9 (74.7 kB, 76.5 kB allowed; React with core): content controls (the
 * lock and text rules, placeholders, values, insert commands). Docx raised in 11.9 (55.1 kB, 57.0
 * allowed): controls' properties patched into the kept `w:sdtPr`, new controls, glossary text.
 * View and React raised in 11.9 (92.9 and 125.6 kB, 95.2 and 128.9 allowed): controls' frames,
 * lists and date picker in the view, the controls menu and properties dialog. Core raised again
 * in 11.9's review (77.3 kB, 79.6 allowed): rich values checked, dates read from their text, what
 * tracked deletions and reviews do to a control.
 * Core raised in 11.10 (80.2 kB, 82.0 allowed): notes (numbers from the settings and sections, the
 * insert, options and convert commands, keeping a note with its reference while tracking, notes
 * carried on the clipboard). View and React raised in 11.10 (103.8 and 139.9 kB, 105.5 and 141.6
 * allowed): footnotes and endnotes in the flow and both renderers, a note edited in place, the
 * notes menu and options dialog, and core's notes with them.
 * Core, view and React raised in 11.11 (84.1, 106.1 and 148.7 kB with 11.8 and 11.9 final; 85.9,
 * 107.9 and 151.4 allowed):
 * find and replace over every story, bookmarks and the outline; marks on the pages and going to a
 * match, a bookmark or a heading; the find panel, the bookmarks dialog and the outline panel, which
 * `FoliEditor` includes so that Word's keys work out of the box.
 */
const BUNDLES = [
  { name: "@folijs/core", entry: dist("core"), budget: 88_000 },
  { name: "@folijs/view", entry: dist("view"), budget: 110_500 },
  { name: "@folijs/react", entry: dist("react"), budget: 155_000 },
  { name: "FoliEditor only", entry: appEntry, budget: 155_000 },
  { name: "@folijs/docx", entry: dist("docx"), budget: 58_400 },
];

let failed = false;
try {
  for (const { name, entry, budget } of BUNDLES) {
    const result = await build({
      root,
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: true,
        lib: { entry, formats: ["es"], fileName: "bundle" },
        rollupOptions: {
          external: [/^react($|\/)/, /^react-dom($|\/)/],
          // Library mode only renames identifiers; an app's build also drops whitespace and comments.
          output: { minify: true },
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
    const code = outputs
      .filter((chunk) => chunk.type === "chunk")
      .map((chunk) => chunk.code)
      .join("");
    const min = Buffer.byteLength(code);
    const gzip = gzipSync(code, { level: 9 }).length;
    const over = gzip > budget;
    failed ||= over;
    console.log(
      `${name.padEnd(16)} ${(min / 1024).toFixed(1).padStart(6)} kB min  ${(gzip / 1024).toFixed(1).padStart(5)} kB gzip  budget ${(budget / 1024).toFixed(1)} kB${over ? "  OVER BUDGET" : ""}`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failed) process.exit(1);
