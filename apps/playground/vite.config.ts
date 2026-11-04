import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Consume workspace packages from source for instant HMR; imports still go through package names.
  resolve: { conditions: ["@foli/source", ...defaultClientConditions] },
});
