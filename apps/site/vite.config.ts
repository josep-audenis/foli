import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Consume workspace packages from source for instant HMR; imports still go through package names.
  resolve: { conditions: ["@folijs/source", ...defaultClientConditions] },
  build: {
    rollupOptions: { input: { main: page("index.html"), test: page("test/index.html") } },
  },
});
