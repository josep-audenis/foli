import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["@foli/source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["@foli/source", ...defaultServerConditions] } },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
  },
});
