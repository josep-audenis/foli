import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["@folijs/source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["@folijs/source", ...defaultServerConditions] } },
  test: {
    include: [
      "packages/*/src/**/*.test.{ts,tsx}",
      "spikes/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "scripts/*.test.mjs",
      "scripts/corpus/*.test.mjs",
    ],
  },
});
