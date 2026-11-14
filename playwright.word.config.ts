import { defineConfig, devices } from "@playwright/test";

/**
 * Page agreement with Word (`pnpm corpus:pages`): each corpus document laid out by Foli and
 * compared, paragraph by paragraph, with the page Word puts it on, and page by page with Word's
 * PDF when `FOLI_WORD_PDF` names a folder of them. Not part of `pnpm check`: the numbers depend
 * on the fonts installed. See corpus/README.md.
 */
const PORT = 5176;

export default defineConfig({
  testDir: "apps/playground/word",
  testMatch: "**/*.word.ts",
  workers: 1,
  reporter: [["list"]],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORT}` },
    },
  ],
  webServer: {
    command: `pnpm --filter @folijs/playground dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
