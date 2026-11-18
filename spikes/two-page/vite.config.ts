import { defaultClientConditions, defineConfig } from "vite";

// story-view.html runs the real packages from source, as the playground does.
export default defineConfig({
  resolve: { conditions: ["@folijs/source", ...defaultClientConditions] },
});
