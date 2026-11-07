// Packs the packages as npm would publish them and installs the tarballs into the example apps
// (outside the pnpm workspace, with npm, as a fresh app would), then builds the apps.
// `pnpm examples` runs this, then the Playwright smoke test (playwright.examples.config.ts).
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packs = `${root}.packs`;
const run = (command, cwd = root) => {
  console.log(`\n> ${command}${cwd === root ? "" : `   (in ${cwd.slice(root.length)})`}`);
  execSync(command, {
    cwd,
    stdio: "inherit",
    // pnpm passes its own npm_config_* settings to scripts; npm warns about the unknown ones.
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
      ),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
};

run("pnpm build");
rmSync(packs, { recursive: true, force: true });
mkdirSync(packs);
for (const name of ["core", "view", "react"]) {
  run(`pnpm pack --pack-destination "${packs}"`, `${root}packages/${name}`);
}
// Stable names, so the examples' package.json files need no version.
for (const file of readdirSync(packs)) {
  renameSync(`${packs}/${file}`, `${packs}/${file.replace(/-\d+\.\d+\.\d+.*\.tgz$/, ".tgz")}`);
}

for (const example of ["vite", "next"]) {
  const dir = `${root}examples/${example}`;
  // A fresh install: the tarballs change on every pack, and a lockfile would pin old ones.
  rmSync(`${dir}/node_modules`, { recursive: true, force: true });
  run("npm install --no-package-lock --no-audit --no-fund", dir);
  run("npm run build", dir);
}
run("npm run ssr-check", `${root}examples/vite`);
