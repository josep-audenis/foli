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
 * the editor moves to v3 (8.7) and v2's types go; view and React do not include it.
 */
const BUNDLES = [
  { name: "@folijs/core", entry: dist("core"), budget: 27_200 },
  { name: "@folijs/view", entry: dist("view"), budget: 31_400 },
  { name: "@folijs/react", entry: dist("react"), budget: 44_400 },
  { name: "FoliEditor only", entry: appEntry, budget: 44_400 },
  { name: "@folijs/docx", entry: dist("docx"), budget: 6_800 },
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
