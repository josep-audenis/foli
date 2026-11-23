import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke test of the example apps built from the packed packages (`pnpm examples` builds them
 * first; see scripts/examples.mjs). Not part of `pnpm check`.
 */
// Started with node directly: through npm, pnpm's npm_config_* settings make npm warn.
const vite = (port: number) =>
  `node node_modules/vite/bin/vite.js preview --port ${port} --strictPort`;
const APPS = [
  { name: "vite", port: 5180, command: vite(5180), specs: ["success.spec.ts"] },
  {
    name: "next",
    port: 5181,
    command: "node node_modules/next/dist/bin/next start --port 5181",
    specs: ["success.spec.ts"],
  },
  { name: "extension", port: 5182, command: vite(5182), specs: ["extension.spec.ts"] },
  {
    name: "vanilla",
    port: 5183,
    command: vite(5183),
    specs: ["success.spec.ts", "vanilla.spec.ts"],
  },
  // A store of its own per run: the server starts from a new document.
  {
    name: "collab",
    port: 5184,
    command:
      "node -e \"require('node:fs').rmSync('.e2e-store.json',{force:true})\" && node server.mjs --port 5184 --store .e2e-store.json",
    specs: ["collab.spec.ts"],
  },
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
      testMatch: app.specs,
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
