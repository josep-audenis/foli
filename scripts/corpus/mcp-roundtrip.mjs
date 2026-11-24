// The MCP server end to end (14.6): the built `bin` started as a client starts it, spoken to on
// its stdin and stdout by the official SDK's client, doing the three tasks of
// `agent-roundtrip.mjs` through its tools. Run after `pnpm build`:
//
//   node scripts/corpus/mcp-roundtrip.mjs [<dir>]
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-review.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/agent-roundtrip.mjs check <dir>
//
// It copies the corpus documents to <dir>/work (emptied first), starts
// `foli-mcp --root <dir>/work --author "Foli Agent"`, runs the tasks, and writes what the server
// saved to <dir>/foli as <name>-agent.docx with what Foli expects of it: the files
// `agent-roundtrip.mjs check` reads, so Word's reading is held to the same rules
// (`agent-tasks.mjs`). Without Word it checks: the command line (`--version`, an unknown
// argument, a whole drive, an empty author); the tools by name; a path outside the root, up
// from it, and a save over the original refused, each by its message; the originals untouched;
// every saved file read again by Foli, with changes, all the author's; a server sent what is
// not a message still answering; and a server ending by itself, with exit code 0, when its
// input ends. <dir> outside the repository; without one (`pnpm mcp:e2e`, part of `pnpm check`)
// a temporary folder, removed after. Exits 1 on any failure.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { pathToFileURL } from "node:url";
import { createEditor } from "../../packages/core/dist/index.js";
import { importDocx } from "../../packages/docx/dist/index.js";
import { AUTHOR, COMMENT, EXPECT, expected } from "./agent-tasks.mjs";

const root = join(import.meta.dirname, "..", "..");
const bin = join(root, "packages", "mcp", "dist", "bin.js");
// The SDK is the server package's devDependency: found from there, by its own exports.
const sdk = createRequire(join(root, "packages", "mcp", "package.json"));
const load = (name) => import(pathToFileURL(sdk.resolve(name)).href);
const { Client } = await load("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await load("@modelcontextprotocol/sdk/client/stdio.js");

const given = process.argv[2];
const dir = given ?? mkdtempSync(join(tmpdir(), "foli-mcp-e2e-"));
const corpus = join(root, "corpus", "word");
const work = join(dir, "work");
const out = join(dir, "foli");
const NAMES = Object.keys(EXPECT);
const TOOLS = [
  "open",
  "read",
  "replace_text",
  "insert_paragraphs",
  "delete_block",
  "set_style",
  "list_styles",
  "comment",
  "list_controls",
  "fill_control",
  "update_fields",
  "edit_table",
  "save",
  "close",
  "list_documents",
];

let failures = 0;
const fail = (what) => {
  failures++;
  console.log(`FAILED: ${what}`);
};
const check = (ok, what) => {
  if (!ok) fail(what);
};

/** The bin run to its end with these arguments and this stdin: its exit code and what it wrote. */
const run = (args, input = "") =>
  spawnSync(process.execPath, [bin, ...args], { input, encoding: "utf8" });

/** The bin with stdin given line by line; resolves with how it ended once it has. */
function started(args, lines) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    // It must end by itself once its input has: a kill after the wait is a failure.
    const timer = setTimeout(() => child.kill(), 5000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(lines.map((line) => `${line}\n`).join(""));
  });
}

/**
 * Code mode (16.4): the bin started with `--code`, its `run` tool doing the board report's
 * task in one call, a script that fails changing nothing, and one that does not end stopped.
 */
async function codeMode() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, "--root", work, "--author", AUTHOR, "--code"],
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const client = new Client({ name: "mcp-roundtrip", version: "0.0.0" });
  await client.connect(transport);
  try {
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      return { text: result.content[0]?.text ?? "", refused: result.isError === true };
    };
    const { tools } = await client.listTools();
    check(
      tools.map((t) => t.name).join() === [...TOOLS, "run"].join(),
      `tools with --code: ${tools.map((t) => t.name)}`,
    );
    const name = "04-board-report";
    await call("open", { path: `${name}.docx` });
    const before = (await call("read", { limit: 1000 })).text;

    const failed = await call("run", {
      code: 'for (const b of doc.blocks()) if (b.kind === "paragraph" && b.text) doc.insertAfter(b.handle, "x");\nnope();',
    });
    check(
      failed.refused && failed.text.startsWith("The script failed at line 2: ReferenceError"),
      `a failing script: ${failed.text}`,
    );
    const started = Date.now();
    const endless = await call("run", {
      code: 'doc.insertAfter(doc.blocks()[0].handle, "x");\nfor (;;) {}',
    });
    check(
      endless.refused &&
        endless.text.startsWith("The script was stopped.") &&
        Date.now() - started < 15000,
      `a script without end: ${endless.text}`,
    );
    check(
      (await call("read", { limit: 1000 })).text === before,
      "a failed run changed the document",
    );

    const wanted = EXPECT[name].restyled.length;
    const ran = await call("run", {
      code: `let n = 0;
for (const b of doc.blocks()) {
  const level = /^heading ([123])$/.exec(b.style ?? "");
  if (level) { doc.setStyle(b.handle, "Heading " + (Number(level[1]) + 1)); n++; }
}
return [n, doc.updateFields({ contents: true }).rebuilt];`,
    });
    check(
      !ran.refused && ran.text.startsWith(`Returned: [${wanted},1]\nChanged ${wanted} blocks`),
      `the board report in one run: ${ran.text.slice(0, 200)}`,
    );
    const saved = await call("save", { path: `${name}.code.docx` });
    check(saved.text === `Saved d1 as ${name}.code.docx.`, `save said: ${saved.text}`);
    const { document: made } = await importDocx(
      new Uint8Array(readFileSync(join(work, `${name}.code.docx`))),
    );
    // What the script did is what the tools did: the same document, read both ways.
    const byTools = JSON.parse(readFileSync(join(out, `${name}-agent.expected.json`), "utf8"));
    check(
      JSON.stringify(expected(made)) === JSON.stringify(byTools),
      "the run's document differs from the tools'",
    );
    console.log(`${name}: done in one run call, saved`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await client.close();
  }
  check(!stderr.trim(), `the server wrote to stderr with --code:\n${stderr}`);
}

async function main() {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(out, { recursive: true });
  for (const name of NAMES) copyFileSync(join(corpus, `${name}.docx`), join(work, `${name}.docx`));
  // A document beside the root: there, and not the server's to read.
  copyFileSync(join(corpus, "05-business-letter.docx"), join(dir, "outside.docx"));

  // ---- The command line.
  const { version } = JSON.parse(
    readFileSync(join(root, "packages", "mcp", "package.json"), "utf8"),
  );
  const said = run(["--version"]);
  check(said.status === 0 && said.stdout.trim() === version, `--version: ${said.stdout}`);
  const unknown = run(["--nope"]);
  check(
    unknown.status === 2 && !unknown.stdout && /Unknown argument/.test(unknown.stderr),
    "an unknown argument",
  );
  const drive = run(["--root", parse(work).root]);
  check(
    drive.status === 1 && !drive.stdout && /whole drive/.test(drive.stderr),
    "a whole drive as root",
  );
  const nobody = run(["--root", work, "--author", ""]);
  check(nobody.status === 1 && !nobody.stdout && /--author/.test(nobody.stderr), "an empty author");

  // ---- What is not a message, to the process itself: it answers, goes on, and ends at the
  // end of its input, by itself.
  const ping = '{"jsonrpc":"2.0","id":7,"method":"ping"}';
  const ended = await started(
    ["--root", work],
    ["not json", "[]", "{}", '{"jsonrpc":"2.0","id":1}', ping],
  );
  check(
    ended.code === 0 && ended.signal === null,
    `the server's end: code ${ended.code}, signal ${ended.signal}`,
  );
  check(
    ended.stdout.trim().split("\n").at(-1) === '{"jsonrpc":"2.0","id":7,"result":{}}',
    "a ping after what is not a message",
  );
  check(ended.stderr === "", `stderr: ${ended.stderr}`);

  // ---- The tasks, by the SDK's client.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, "--root", work, "--author", AUTHOR],
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const client = new Client({ name: "mcp-roundtrip", version: "0.0.0" });
  await client.connect(transport);
  try {
    /** A tool call that must go through: its text. */
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const text = result.content[0]?.text ?? "";
      if (result.isError) throw new Error(`${name} ${JSON.stringify(args)}: ${text}`);
      return text;
    };
    /** A tool call that must be refused, with a message that starts so. */
    const refused = async (name, args, start, what) => {
      const result = await client.callTool({ name, arguments: args });
      const text = result.content[0]?.text ?? "";
      check(result.isError === true && text.startsWith(start), `${what}: ${text}`);
    };
    /** The handle of the one line of a read that holds `text`. */
    const handleOf = async (document, text) => {
      const lines = (await call("read", { document, limit: 1000 }))
        .split("\n")
        .filter((line) => line.includes(text));
      if (lines.length !== 1) throw new Error(`${lines.length} lines hold ${JSON.stringify(text)}`);
      return /^\[(b\d+)\]/.exec(lines[0])[1];
    };

    /** Each task's steps through the tools: the same as `agent-roundtrip.mjs`'s through the library. */
    const RUN = {
      async "03-offer-letter-template"(document) {
        await call("fill_control", { document, name: "offer_date", value: "2026-12-01" });
        await call("fill_control", { document, name: "position", value: "Senior Data Engineer" });
        await call("fill_control", { document, name: "salary", value: "72,000" });
        await call("fill_control", { document, name: "remote", value: true });
        const fields = await call("update_fields", {
          document,
          data: { CandidateFirstName: "Ada", StartDate: "5 January 2027" },
        });
        check(/^2 fields updated/.test(fields), `03 fields: ${fields}`);
      },
      async "01-mutual-nda"(document) {
        const term = await handleOf(document, "continues for a period of three (3) years");
        await call("replace_text", {
          document,
          handle: term,
          find: "three (3) years",
          replacement: "five (5) years",
        });
        await call("comment", { document, handle: term, text: COMMENT, on: "five (5) years" });
        await call("replace_text", {
          document,
          handle: await handleOf(document, 'each a "Party"'),
          find: '"Party"',
          replacement: '"Signatory"',
        });
        await call("insert_paragraphs", {
          document,
          handle: await handleOf(document, "Clause headings do not affect"),
          paragraphs: [
            "A reference to a statute includes that statute as amended from time to time.",
          ],
        });
        await call("delete_block", {
          document,
          handle: await handleOf(document, "the existence and terms of the discussions"),
        });
      },
      async "04-board-report"(document) {
        const lines = (await call("read", { document, limit: 1000 })).split("\n");
        let restyled = 0;
        for (const line of lines) {
          const heading = /^\[(b\d+)\] heading ([123])[,:]/.exec(line);
          if (!heading) continue;
          restyled++;
          await call("set_style", {
            document,
            handle: heading[1],
            style: `Heading ${Number(heading[2]) + 1}`,
          });
        }
        const wanted = EXPECT["04-board-report"].restyled.length;
        check(restyled === wanted, `04: ${restyled} headings restyled, not ${wanted}`);
        // The table of contents built again: at least a field changed.
        const fields = await call("update_fields", { document, contents: true });
        check(/^[1-9]\d* fields? updated/.test(fields), `04 fields: ${fields}`);
      },
    };

    const { tools } = await client.listTools();
    check(tools.map((t) => t.name).join() === TOOLS.join(), `tools: ${tools.map((t) => t.name)}`);

    // The file rules, through a real process on a real folder. Each file is there to be found:
    // only the rule keeps it from being read.
    const relative = "A path is relative to the server's folder";
    await refused("open", { path: join(dir, "outside.docx") }, relative, "an absolute path");
    await refused("open", { path: "../outside.docx" }, relative, "a path up");
    await refused("open", { path: "nope.docx" }, "There is no file", "a missing file");

    for (const name of NAMES) {
      const original = readFileSync(join(work, `${name}.docx`));
      const document = /as (d\d+)\./.exec(await call("open", { path: `${name}.docx` }))[1];
      await RUN[name](document);
      await refused(
        "save",
        { document, path: `${name}.docx` },
        `"${name}.docx" exists`,
        "a save over the original",
      );
      await refused("save", { document, path: "../out.docx" }, relative, "a save up");
      const saved = await call("save", { document });
      check(saved === `Saved ${document} as ${name}.agent.docx.`, `save said: ${saved}`);
      await call("close", { document });
      check(
        readFileSync(join(work, `${name}.docx`)).equals(original),
        `${name}: the original changed`,
      );

      // What was saved, read again by Foli: a document with changes, all the author's.
      const bytes = readFileSync(join(work, `${name}.agent.docx`));
      const { document: made } = await importDocx(new Uint8Array(bytes));
      const authors = new Set();
      const walk = (node) => {
        for (const mark of node.marks ?? []) if (mark.attrs?.author) authors.add(mark.attrs.author);
        for (const change of Object.values(node.attrs?.revision ?? {})) authors.add(change.author);
        if (node.attrs?.formatChange) authors.add(node.attrs.formatChange.author);
        for (const child of node.content ?? []) walk(child);
      };
      walk(made.content);
      check(
        [...authors].join() === AUTHOR,
        `${name}: changes by ${[...authors].join(", ") || "nobody"}`,
      );
      const reads = expected(made);
      check(
        JSON.stringify(reads.accepted) !== JSON.stringify(reads.rejected) || authors.size > 0,
        `${name}: nothing changed`,
      );
      check(
        createEditor({ document: made }).getDocument().comments.length ===
          (EXPECT[name].comment ? 1 : 0),
        `${name}: comments`,
      );
      writeFileSync(join(out, `${name}-agent.docx`), bytes);
      writeFileSync(
        join(out, `${name}-agent.expected.json`),
        `${JSON.stringify(reads, null, 2)}\n`,
      );
      console.log(`${name}: done through the server, saved`);
    }
    check((await call("list_documents")) === "No document is open.", "documents left open");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await client.close();
  }
  check(!stderr.trim(), `the server wrote to stderr:\n${stderr}`);
  await codeMode();
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  if (!given) rmSync(dir, { recursive: true, force: true });
}
console.log(failures ? `${failures} failed` : "mcp-roundtrip: all passed");
process.exit(failures ? 1 : 0);
