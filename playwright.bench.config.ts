import { defineConfig, devices } from "@playwright/test";

/** Benchmarks (`pnpm bench:layout`): one at a time, so runs do not compete for the machine. */
const PORT = 5175;

export default defineConfig({
  testDir: "apps/playground/bench",
  testMatch: "**/*.bench.ts",
  workers: 1,
  reporter: [["list"]],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORT}` },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], baseURL: `http://localhost:${PORT}` },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"], baseURL: `http://localhost:${PORT}` } },
  ],
  webServer: {
    command: `pnpm --filter @folijs/playground dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
