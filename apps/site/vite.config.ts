import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import { buildDocs } from "./src/docs/build.js";

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const root = page("../..");
const out = page("docs");
const posix = (path: string) => path.replace(/\\/g, "/");

// The docs pages are written from the repository's markdown before Vite reads its inputs.
const docs = buildDocs(root, out);

/** In dev, a changed markdown file, changelog, API report or example writes the pages again. */
const docsWatch: Plugin = {
  name: "foli-docs",
  configureServer(server) {
    const packages = ["core", "view", "react", "docx", "pdf"];
    server.watcher.add([
      page("../../docs"),
      ...packages.flatMap((p) => [
        page(`../../packages/${p}/CHANGELOG.md`),
        page(`../../packages/${p}/api-report.d.ts`),
      ]),
    ]);
    server.watcher.on("change", (file) => {
      if (
        /^(docs\/.*\.md|packages\/\w+\/(CHANGELOG\.md|api-report\.d\.ts)|apps\/site\/src\/examples\/.*)$/.test(
          posix(relative(root, file)),
        )
      )
        buildDocs(root, out);
    });
  },
};

/** `docs/examples/editor/index.html` → `docs-examples-editor`, the page's chunk name. */
const name = (file: string) =>
  `docs-${posix(relative(out, file))
    .replace(/\/?index\.html$/, "")
    .replace(/\//g, "-")}`;

export default defineConfig({
  plugins: [react(), docsWatch],
  // Consume workspace packages from source for instant HMR; imports still go through package names.
  resolve: { conditions: ["@folijs/source", ...defaultClientConditions] },
  build: {
    rollupOptions: {
      input: {
        main: page("index.html"),
        test: page("test/index.html"),
        ...Object.fromEntries(docs.map((file) => [name(file), file])),
      },
    },
  },
});
