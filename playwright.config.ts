import { defineConfig, devices } from "@playwright/test";

/** Each app's e2e/ folder runs against its own dev server, in every engine. */
const APPS: {
  name: string;
  dir: string;
  filter: string;
  port: number;
  tests?: string;
  command?: string;
}[] = [
  { name: "spike", dir: "spikes/two-page", filter: "@folijs/spike-two-page", port: 5174 },
  { name: "playground", dir: "apps/playground", filter: "@folijs/playground", port: 5175 },
  { name: "site", dir: "apps/site", filter: "@folijs/site", port: 5178 },
  // The site as deployed: built, then served by `vite preview`.
  {
    name: "site-build",
    dir: "apps/site",
    tests: "apps/site/e2e-build",
    filter: "@folijs/site",
    port: 5179,
    command:
      "pnpm --filter @folijs/site build && pnpm --filter @folijs/site preview --port 5179 --strictPort",
  },
];
const BROWSERS = [
  { name: "chromium", device: devices["Desktop Chrome"] },
  { name: "firefox", device: devices["Desktop Firefox"] },
  { name: "webkit", device: devices["Desktop Safari"] },
];

export default defineConfig({
  testIgnore: "**/node_modules/**",
  fullyParallel: true,
  // Unbounded workers starve the machine (Firefox compositor errors, timing-dependent failures).
  workers: 4,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  // Project names: "<app>-<browser>", e.g. `pnpm test:e2e --project=playground-firefox`.
  projects: APPS.flatMap((app) =>
    BROWSERS.map((browser) => ({
      name: `${app.name}-${browser.name}`,
      testDir: app.tests ?? `${app.dir}/e2e`,
      use: { ...browser.device, baseURL: `http://localhost:${app.port}` },
    })),
  ),
  webServer: APPS.map((app) => ({
    command: app.command ?? `pnpm --filter ${app.filter} dev --port ${app.port} --strictPort`,
    url: `http://localhost:${app.port}`,
    reuseExistingServer: !process.env.CI,
  })),
});
