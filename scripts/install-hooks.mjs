// Runs on `pnpm install` (prepare). Installs a pre-push hook that runs `pnpm check`.
// Writes only pre-push (no core.hooksPath) so other hooks, e.g. graphify's, keep working.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = "# Installed by scripts/install-hooks.mjs";
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

let hooksDir;
try {
  // --git-path resolves the shared hooks dir from worktrees.
  hooksDir = git("rev-parse", "--git-path", "hooks");
} catch {
  process.exit(0); // not a git checkout
}

let hooksPath = "";
try {
  hooksPath = git("config", "core.hooksPath");
} catch {} // exits 1 when unset

if (hooksPath) {
  // A custom hooks dir may be shared across repos; never write into it.
  console.warn(
    `core.hooksPath is set (${hooksPath}); skipping pre-push hook. Run \`pnpm check\` before pushing.`,
  );
  process.exit(0);
}

const hook = join(hooksDir, "pre-push");
if (existsSync(hook) && !readFileSync(hook, "utf8").includes(MARKER)) {
  console.warn(`${hook} exists and was not installed by this script; leaving it alone.`);
  process.exit(0);
}

mkdirSync(hooksDir, { recursive: true });
writeFileSync(hook, `#!/bin/sh\n${MARKER}\nexec pnpm check\n`);
chmodSync(hook, 0o755);
