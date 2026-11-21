#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { openSession } from "@folijs/agent";
import { importDocx } from "@folijs/docx";
import { serve, type Tool } from "./protocol.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

// The spike's one tool (14.1): replaced by the document tools and their file rules in 14.3.
const read: Tool = {
  name: "read",
  description:
    "Reads a .docx file under the server's working directory: its body, one block per line, each starting with the block's handle in brackets.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "The .docx file, relative to the root." } },
    required: ["path"],
  },
  async run({ path }) {
    const root = process.cwd();
    const file = resolve(root, path as string);
    if (!file.startsWith(root + sep))
      return { text: "That path is outside the root.", isError: true };
    const { document } = await importDocx(readFileSync(file));
    const result = openSession(document, { author: "Agent" }).read({ limit: 40 });
    return result.ok ? { text: result.text } : { text: result.message, isError: true };
  },
};

await serve(process.stdin, process.stdout, {
  name: "foli",
  version,
  tools: [read],
  log: (message) => process.stderr.write(`${message}\n`),
});
