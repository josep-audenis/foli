import { Documents } from "./documents.js";
import { type FileRules, fileRules } from "./files.js";
import type { ServerOptions } from "./protocol.js";
import { INSTRUCTIONS, tools } from "./tools.js";

export interface FoliServerOptions {
  /** The folder files are read from and written to; nothing outside it is touched. */
  root: string;
  /** Whether a save may write over a file the server did not write itself. Default false. */
  overwrite?: boolean;
  /** Whose tracked changes and comments the edits are. Default: the client's name, or "Agent". */
  author?: string;
  version: string;
  log?: (message: string) => void;
}

/**
 * @internal
 * A name fit to stand beside every change in Word and to be written to a `.docx`: one line,
 * no control characters, no half of a character, at most 60 characters. "" when nothing is left.
 */
export const authorName = (name: string) =>
  [
    ...name
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what goes
      .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, " ")
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  ]
    .slice(0, 60)
    .join("");

/** The server's options for `serve`: Foli's tools over the documents under `root`. */
export function foliServer(options: FoliServerOptions): ServerOptions {
  const rules: FileRules = fileRules(options.root, options.overwrite ?? false);
  let client: string | undefined;
  const given = options.author === undefined ? "" : authorName(options.author);
  if (options.author !== undefined && !given)
    throw new Error("--author needs a name that can be written beside a change");
  const documents = new Documents(rules, () => given || client || "Agent");
  return {
    name: "foli",
    version: options.version,
    instructions: INSTRUCTIONS,
    tools: tools(documents),
    onClient: (name) => {
      client = authorName(name) || undefined;
    },
    ...(options.log ? { log: options.log } : {}),
  };
}

/** @internal */
export const USAGE = `foli-mcp: an MCP server that reads and edits .docx files, every edit a tracked change.

Usage: foli-mcp [--root <folder>] [--author <name>] [--overwrite]

  --root <folder>   The folder files are read from and written to. Default: where it is started.
  --author <name>   Whose tracked changes the edits are. Default: the client's name.
  --overwrite       Let save write over existing files, the original included.
  --version, --help

It speaks the Model Context Protocol on stdin and stdout: an MCP client starts it.`;

/** @internal The command line's arguments as options, or what to print and the exit code. */
export function parseArgs(
  argv: readonly string[],
): { root: string; overwrite: boolean; author?: string } | { print: string; code: number } {
  let root = ".";
  let author: string | undefined;
  let overwrite = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { print: USAGE, code: 0 };
    if (arg === "--version" || arg === "-v") return { print: "", code: 0 };
    if (arg === "--overwrite") overwrite = true;
    else if (arg === "--root" || arg === "--author") {
      const value = argv[++i];
      if (value === undefined) return { print: `${arg} needs a value.\n\n${USAGE}`, code: 2 };
      if (arg === "--root") root = value;
      else author = value;
    } else return { print: `Unknown argument: ${arg}\n\n${USAGE}`, code: 2 };
  }
  return { root, overwrite, ...(author ? { author } : {}) };
}
