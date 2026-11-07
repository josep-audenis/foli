import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test of the example apps built from the packed packages (`pnpm examples` builds them
 * first; see scripts/examples.mjs). Not part of `pnpm check`.
 */
const APPS = [
  { name: "vite", port: 5180, command: "npm run preview -- --port 5180 --strictPort" },
  { name: "next", port: 5181, command: "npm run start -- --port 5181" },
];
const BROWSERS = [
  { name: "chromium", device: devices["Desktop Chrome"] },
  { name: "firefox", device: devices["Desktop Firefox"] },
  { name: "webkit", device: devices["Desktop Safari"] },
];

export default defineConfig({
  testDir: "examples/e2e",
  workers: 2,
  reporter: [["list"]],
  projects: APPS.flatMap((app) =>
    BROWSERS.map((browser) => ({
      name: `${app.name}-${browser.name}`,
      use: { ...browser.device, baseURL: `http://localhost:${app.port}` },
    })),
  ),
  webServer: APPS.map((app) => ({
    command: app.command,
    cwd: `examples/${app.name}`,
    url: `http://localhost:${app.port}`,
    reuseExistingServer: false,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  })),
});
