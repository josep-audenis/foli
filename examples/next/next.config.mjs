/** @type {import("next").NextConfig} */
export default {
  // The example lives inside the Foli repository: keep Next.js from treating the repository
  // root (which has its own lockfile) as the workspace root.
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
};
