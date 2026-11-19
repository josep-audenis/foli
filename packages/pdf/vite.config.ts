import { defaultClientConditions, defineConfig } from "vite";

/**
 * The page's renderer (`src/renderer.ts`): `@folijs/core` and `@folijs/view` bundled from source
 * into one classic script, `dist/renderer.js`, that `exportPdf` adds to the app's page.
 */
export default defineConfig({
  resolve: { conditions: ["@folijs/source", ...defaultClientConditions] },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: true,
    lib: {
      entry: "src/renderer.ts",
      formats: ["iife"],
      name: "foliPdfRenderer",
      fileName: () => "renderer.js",
    },
  },
});
