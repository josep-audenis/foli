#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { serve } from "./protocol.js";
import { foliServer, parseArgs } from "./server.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const args = parseArgs(process.argv.slice(2));
if ("print" in args) {
  // stdout is free here: no client has been spoken to yet.
  (args.code ? process.stderr : process.stdout).write(`${args.print || version}\n`);
  process.exit(args.code);
}

const log = (message: string) => process.stderr.write(`foli-mcp: ${message}\n`);
// The client went away: nothing to say, and nobody to say it to.
process.stdout.on("error", () => process.exit(0));
try {
  await serve(process.stdin, process.stdout, foliServer({ ...args, version, log }));
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
