// Runs on `pnpm install` (prepare). Installs a pre-push hook that runs `pnpm check`.
// Writes only pre-push (no core.hooksPath) so other hooks, e.g. graphify's, keep working.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let hooksDir;
try {
  // --git-path resolves the shared hooks dir from worktrees and honours core.hooksPath.
  hooksDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { encoding: "utf8" }).trim();
} catch {
  process.exit(0); // not a git checkout
}

mkdirSync(hooksDir, { recursive: true });
const hook = join(hooksDir, "pre-push");
writeFileSync(hook, "#!/bin/sh\n# Installed by scripts/install-hooks.mjs\nexec pnpm check\n");
chmodSync(hook, 0o755);
