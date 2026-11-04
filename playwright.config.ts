import { defineConfig, devices } from "@playwright/test";

const SPIKE_PORT = 5174;

export default defineConfig({
  testMatch: "**/e2e/**/*.spec.ts",
  testIgnore: "**/node_modules/**",
  fullyParallel: true,
  // Unbounded workers starve the machine (Firefox compositor errors, timing-dependent failures).
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${SPIKE_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `pnpm --filter @foli/spike-two-page dev --port ${SPIKE_PORT} --strictPort`,
    url: `http://localhost:${SPIKE_PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
