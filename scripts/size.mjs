// Bundle size, as an app gets it: each package's published entry (`dist`, after `pnpm build`)
// bundled with its Foli dependencies, fully minified, React external; and an app that imports
// only `FoliEditor`, where `sideEffects` and tree shaking decide what is left. Fails when a
// bundle grows past its budget. Run: `pnpm size` (part of `pnpm check`). Numbers and method:
// docs/benchmarks.md, "Bundle size".

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * (63.5 kB): floating pictures drawn as CSS floats at their paragraphs' start.
 * Phase 11 (at its close core 84.6, view 106.6, React 149.9, docx 55.3 kB): all raised in 11.3
 * for schema v5 (field, control and note nodes; the checks of stories, controls and settings),
 * which every package carries. Docx raised in 11.4, 11.5, 11.7 and 11.9 (57.0 kB allowed):
 * stories, fields and controls read and written, `word/settings.xml`, controls' properties
 * patched into the kept `w:sdtPr`. Core, view and React raised in each of 11.6 to 11.11 (85.9,
 * 107.9 and 151.4 kB allowed), each time with the task's toolbar menu: section commands and
 * columns in the flow (11.6); story editors, `StoryStep`, headers and footers on pages and edited
 * in place (11.7); fields, their selection rules and updates, tables of contents (11.8); content
 * controls' rules, frames, lists and date picker (11.9); notes in the flow and both renderers
 * (11.10); find and replace over every story, bookmarks, the outline and `FoliNavigation`, which
 * `FoliEditor` includes (11.11). `@folijs/pdf` added in 11.12 (16.2 kB, 18.4 allowed: core's
 * `parseDocument` checks the document before the page gets it; its page renderer 83.1 kB, 95.2
 * allowed: core and the read-only renderer bundled into the script `exportPdf` adds to the
 * headless page, never part of an app's own bundle).
 * Phase 12 (at its close core 82.9, view 110.8, React 155.3, docx 58.0, pdf 17.2 kB): only
 * view, React and docx raised, in 12.3 (112.0, 157.0 and 60.0 kB allowed): custom nodes
 * and marks, which every package carries (the extended schema, foreign nodes and their JSON
 * mapping in core; their drawing and the clipboard HTML carrying their JSON in the view; their
 * tagged content controls in docx).
 * Agent added in 13.1 (56.2 kB, about 8% headroom): the session is `createEditor`, so nearly
 * all of it is core, which an app that edits already loads.
 * Raised in 13.3 (62.1 kB): the editing operations bring in core's find and replace, table
 * deletion and paragraph styles.
 * Raised in 13.5 (72.0 kB): comments (13.4), content controls' values and field updates.
 * React raised after Phase 15's toolbar work and the two bug sweeps (157.4 kB, 159.0 allowed):
 * the sweeps' fixes add about 0.5 kB over core, view and React, on a bundle already at its limit.
 * React raised in 17.4 (159.3 kB, 162.1 allowed): Phase 17's toolbar for developers (tabs an app
 * controls, captioned groups, dialogs by name, the color field, overflow into a More panel:
 * about 1.9 kB), with room for 17.5's replaceable strings (161.0 kB with them: the exported
 * list `toolbarMessages` holds each string a second time).
 * View raised after the fourth bug sweep (112.1 kB, 113.0 allowed): it was at its limit, and the
 * sweep's fixes in core (accepting a chain of deleted paragraphs) and the view (field codes beside
 * a page number) add about 0.1 kB.
 * View raised in 18.1 (112.6 kB, 113.0 allowed): the hint (its highlight, timers, its range
 * mapped through edits and drawn again after a render: about 0.6 kB), on a bundle with no
 * headroom left since 12.3. Raised in 18.2 (113.1 kB, 113.5 allowed): a hint in a header, footer
 * or note, marked in the copies the pages draw (about 0.5 kB). React and FoliEditor with it
 * (162.3 kB, 163.1 allowed): they carry the view, with room for 18.3's `hint` on the ref.
 * React and FoliEditor raised in 19.2 (163.8 kB, 166.0 allowed): the horizontal line button and
 * the find panel's comments (core's `findInComments`, `replaceInComments`, the list: about
 * 1.4 kB), with room for Phase 19's picture and table UI.
 * React and FoliEditor raised in 19.5b (166.8 kB, 170.0 allowed): the column width dialog (19.4),
 * the picture dialog's rotation and crop and their strings (about 3 kB with 19.4), with room for
 * 19.6's drag and drop of text.
 * View raised in 19.3 (113.5 kB, 116.2 allowed): custom nodes and marks drawn on read-only pages
 * (`customDrawing`, about 0.4 kB), with room for 19.4–19.7 (autofit, crop and rotation, drag and
 * drop of text, Android input), all in the view.
 * Core, view, docx and agent raised in Phase 21 (86.0, 116.3, 60.0 and 75.7 kB; 87.9, 118.2,
 * 61.0 and 76.7 allowed): the audit's fixes (comment ids made distinct, a date control read
 * without a regular expression, part names checked twice, field values checked), about 0.1 kB
 * each on bundles at their limit, with room for the rest of the phase. React and FoliEditor
 * raised in 21.9 (170.2 kB, 172.5 allowed): the select boxes held until Enter, the focus given
 * back after a dialog closed from elsewhere, the comments pane's frame-batched measuring.
 * Docx raised in 21.10 (61.4 kB, 63.5 allowed): export correctness (Word 2013's compatibility
 * settings in a new package, the spacing flag into an existing part, a related part made where
 * it points) and `asDocument`, a .docm or template written as a .docx without its macros.
 * View raised in 21.11 (118.2 kB, 120.1 allowed): it carries core's find, which now looks
 * through soft hyphens and zero-width spaces (an offset map).
 * Core, view, React and agent raised in 22.2 (88.2, 120.9, 172.5 and 78.1 kB; 91.8, 124.0,
 * 175.8 and 80.1 allowed): steps read from JSON as untrusted input (every step's parser, the
 * envelope's and stories' checks), which every package that loads the editor carries, with room
 * for Phase 22's envelope steps, story steps and the collab plugin.
 * Agent raised again in 22.6 (80.1 kB, 84.0 allowed): core's story edits, ids per client and
 * received transactions, which the session's editor carries.
 * Collab added in 22.8 (80.1 allowed): the authority is `createEditor` (it applies every step as
 * the clients do), so nearly all of it is core, which a server that edits already loads.
 * Core, view, React and FoliEditor raised in 22.9 (91.6, 123.9, 175.6 and 173.7 kB; 94.7, 127.0,
 * 179.7 and 179.7 allowed): presence (core's peers mapped through every change, the view's
 * marks and carets) on bundles at their limit after the collab plugin.
 * Agent raised in 23.2 (84.2 kB, 90.0 allowed): the tool definitions moved from the MCP server
 * (23.1) and core's tracked table formatting, with room for Phase 23's operations (tables,
 * formatting, pictures, headers, review), which are the session's own code.
 * Agent raised again in 23.4 (91.6 kB, 100.0 allowed): tables and text formatting, about half of
 * it the words a model reads (descriptions, refusals); the phase's last four areas to come.
 * Agent raised again in 23.8 (100.2 kB, 104.0 allowed): pictures, headers and footers, review;
 * the phase's code is in, its last tasks are tests and docs.
 * React and FoliEditor raised in 25.2 (179.9 and 177.9 kB; 187.5 allowed): the Word ribbon
 * (`wordRibbonTabs`, 26 more built-in items), with room for Phase 25's large buttons, launchers,
 * collapse, shrinking groups and KeyTips.
 * Docx raised in 28.2 (64.2 kB, 66.0 allowed): Strict Open XML (`strict.ts`, ADR-0014: its names
 * and value forms, both ways), with room for 28.4's markup-compatibility roots.
 * Docx raised again in 28.4 (66.3 kB, 68.0 allowed): `mc:AlternateContent` roots read as Word
 * reads them (`alternate.ts`: the branch taken, documents joined, wrappers unwrapped).
 * Core, React and FoliEditor raised in 29.3 (95.4, 189.3 and 187.2 kB; 99.0 and 200.0 allowed):
 * Word's icons (29.2) and Font group commands, with room for Phase 29's format painter,
 * formatting marks, word count, status bar, context menu, mini toolbar and style gallery.
 * View raised in 29.6 (127.0 kB, 132.0 allowed): the format painter's pointer, formatting marks
 * (29.5) and zoom, with room for the context menu's and mini toolbar's hooks.
 * React and FoliEditor raised in 30.2 (200.9 and 198.4 kB; 212.0 allowed): Word's Paragraph
 * dialog (tabs, tri-state boxes, a preview, lengths typed with units), with room for Phase 30's
 * Font and Tabs dialogs and the Layout tab's menus.
 * React and FoliEditor raised in 32.1 (212.2 and 209.3 kB; 222.0 allowed): schema 9's checks
 * and the page decoration drawn, with room for Phase 32's Design tab (Page Color, Page
 * Borders, Watermark, Borders and Shading, Line Numbers). `@folijs/pdf` and its renderer raised
 * in 32.1 (18.6 and 95.5 kB; 19.0 and 98.0 allowed): the same checks and drawing in the page.
 * Core and docx raised in 32.3 (99.4 and 69.5 kB; 102.0 and 71.0 allowed): watermarks (the
 * commands; Word's VML read and written, its shape types as text), with room for 32.4–32.5.
 * React, FoliEditor and `@folijs/pdf` raised in 32.5 (222.3 and 19.4 kB; 228.0 and 20.0 allowed):
 * the Borders and Shading, Watermark and Line Numbers dialogs, line numbers drawn, and schema
 * 8's kept decoration adopted on parse.
 * Docx, agent, view and pdf's renderer raised in 33.1 (76.2, 104.3, 132.1 and 98.3 kB; 80.0,
 * 106.0, 138.0 and 102.0 allowed): text boxes (schema 10's node and story checks; DrawingML and VML text boxes read and
 * written, frames edited in place for pictures too), with room for 33.2's drawing and 33.4–33.6.
 * Core, React and FoliEditor raised in 33.4 (102.7, 227.2 and 223.9 kB; 106.0, 240.0 and 240.0
 * allowed): text box editing and insertion (33.3), Layout Options' commands, menus and button,
 * with room for the Layout and Size dialogs and the Picture Format tab (33.4–33.6).
 * Core, agent, docx and `@folijs/pdf` raised in 34.1 (105.5, 106.3, 81.9 and 21.6 kB; 108.0, 108.0, 84.0 and 22.5
 * allowed): shapes (schema 11's node and its checks, DrawingML's 187 preset names among them,
 * which pdf carries with core's schema; DrawingML shapes read with their theme styles and written
 * in place), with room for 34.3's new shapes.
 * View, React, FoliEditor and pdf's renderer raised in 34.2 (144.9, 242.6, 239.0 and 108.8 kB;
 * 150.0, 252.0, 252.0 and 114.0 allowed): shapes drawn (about 50 of DrawingML's preset
 * definitions, the guide formula interpreter, SVG fills, gradients, dashes and line ends), with
 * room for the Shapes gallery, handles and the Shape Format tab (34.3–34.5).
 * View raised again in 34.4 (150.1 kB; 156.0 allowed): drawing shapes by dragging (34.3), a
 * selected shape's move, turn and adjustment handles, the arrow keys' nudge and typing into a
 * shape.
 * React and FoliEditor raised in 35.1 (252.5 and 248.3 kB; 264.0 and 264.0 allowed): the Symbol
 * menu and dialog (24 Unicode subsets, Special Characters), with room for Phase 35's Date and
 * Time, Caption, Table of Figures, Equation and Cover Page.
 */
const BUNDLES = [
  { name: "@folijs/core", entry: dist("core"), budget: 110_592 },
  { name: "@folijs/view", entry: dist("view"), budget: 159_744 },
  { name: "@folijs/react", entry: dist("react"), budget: 270_336 },
  { name: "FoliEditor only", entry: appEntry, budget: 270_336 },
  { name: "@folijs/docx", entry: dist("docx"), budget: 86_016 },
  { name: "@folijs/pdf", entry: dist("pdf"), budget: 23_040 },
  { name: "@folijs/agent", entry: dist("agent"), budget: 110_592 },
  { name: "@folijs/collab", entry: dist("collab"), budget: 82_000 },
];
/** Bundles built as they ship (minified scripts): their gzipped bytes, with their budget. */
const BUILT = [
  {
    name: "pdf's renderer",
    file: join(root, "packages", "pdf", "dist", "renderer.js"),
    budget: 116_736,
  },
];

/**
 * pdf's Node side reads its renderer by `new URL("../dist/renderer.js", import.meta.url)`, which a
 * library build inlines: measured apart instead (`BUILT`), as an app's server never sends it.
 */
const RENDERER_APART = {
  name: "pdf-renderer-apart",
  enforce: "pre",
  transform: (code) => code.replace('"../dist/renderer.js"', "globalThis.renderer"),
};

let failed = false;
try {
  for (const { name, entry, budget } of BUNDLES) {
    const result = await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [RENDERER_APART],
      build: {
        write: false,
        minify: true,
        lib: { entry, formats: ["es"], fileName: "bundle" },
        rollupOptions: {
          external: [/^react($|\/)/, /^react-dom($|\/)/, /^node:/],
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
  for (const { name, file, budget } of BUILT) {
    const code = readFileSync(file);
    const gzip = gzipSync(code, { level: 9 }).length;
    const over = gzip > budget;
    failed ||= over;
    console.log(
      `${name.padEnd(16)} ${(code.length / 1024).toFixed(1).padStart(6)} kB min  ${(gzip / 1024).toFixed(1).padStart(5)} kB gzip  budget ${(budget / 1024).toFixed(1)} kB${over ? "  OVER BUDGET" : ""}`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failed) process.exit(1);
