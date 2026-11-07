// Bundle size per package, as an app gets it: each package's published entry (`dist`, after
// `pnpm build`) bundled with its Foli dependencies, minified, React external. Fails when a
// package grows past its budget. Run: `pnpm size` (part of `pnpm check`). Numbers and method:
// docs/benchmarks.md, "Bundle size".

import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";

/**
 * Gzipped bytes allowed per package (each includes the Foli packages it depends on), about 15%
 * over the size when set (6.4: 15.6, 22.0 and 28.1 kB). Raise one only with a reason in the PR.
 */
const BUDGETS = {
  "@foli/core": 18_500,
  "@foli/view": 26_000,
  "@foli/react": 33_000,
};

const root = fileURLToPath(new URL("..", import.meta.url));
let failed = false;
for (const [name, budget] of Object.entries(BUDGETS)) {
  const dir = name.replace("@foli/", "packages/");
  const result = await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: true,
      lib: { entry: `${dir}/dist/index.js`, formats: ["es"], fileName: "bundle" },
      rollupOptions: { external: [/^react($|\/)/, /^react-dom($|\/)/] },
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
    `${name.padEnd(12)} ${(min / 1024).toFixed(1).padStart(6)} kB min  ${(gzip / 1024).toFixed(1).padStart(5)} kB gzip  budget ${(budget / 1024).toFixed(1)} kB${over ? "  OVER BUDGET" : ""}`,
  );
}
if (failed) process.exit(1);
