// The MCP server end to end (14.6): the built `bin` started as a client starts it, spoken to on
// its stdin and stdout by the official SDK's client, doing the three tasks of
// `agent-roundtrip.mjs` through its tools. Run after `pnpm build`:
//
//   node scripts/corpus/mcp-roundtrip.mjs [<dir>]
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-review.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/agent-roundtrip.mjs check <dir>
//
// It copies the corpus documents to <dir>/work, starts `foli-mcp --root <dir>/work --author
// "Foli Agent"`, runs the tasks, and writes what the server saved to <dir>/foli as
// <name>-agent.docx with what Foli expects of it: the files `agent-roundtrip.mjs check` reads,
// so Word's reading is checked by the same rules. It also checks, without Word: the server
// lists its tools; a path outside the root and a save over the original are refused; the
// originals are untouched; the server ends when its input does. <dir> outside the repository;
// without one (`pnpm mcp:e2e`, part of `pnpm check`) a temporary folder, removed after, and the
// Word steps are left out. Exits 1 on any failure.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditor } from "../../packages/core/dist/index.js";
import { importDocx } from "../../packages/docx/dist/index.js";
import { Client } from "../../packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../../packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const given = process.argv[2];
const dir = given ?? mkdtempSync(join(tmpdir(), "foli-mcp-e2e-"));
const root = join(import.meta.dirname, "..", "..");
const corpus = join(root, "corpus", "word");
const work = join(dir, "work");
const out = join(dir, "foli");
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

const AUTHOR = "Foli Agent";
const COMMENT = "Extended to five years to match the supply agreement.";
const NAMES = ["03-offer-letter-template", "01-mutual-nda", "04-board-report"];
for (const name of NAMES) copyFileSync(join(corpus, `${name}.docx`), join(work, `${name}.docx`));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "packages", "mcp", "dist", "bin.js"), "--root", work, "--author", AUTHOR],
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr += chunk;
});
const client = new Client({ name: "mcp-roundtrip", version: "0.0.0" });
await client.connect(transport);

let failures = 0;
const fail = (what) => {
  failures++;
  console.log(`FAILED: ${what}`);
};
/** A tool call that must go through: its text. */
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0]?.text ?? "";
  if (result.isError) throw new Error(`${name} ${JSON.stringify(args)}: ${text}`);
  return text;
}
/** A tool call that must be refused: its message. */
async function refused(name, args, what) {
  const result = await client.callTool({ name, arguments: args });
  if (!result.isError) fail(`${what}: not refused`);
  return result.content[0]?.text ?? "";
}
/** The handle of the one line of a read that holds `text`. */
async function handleOf(document, text) {
  const lines = (await call("read", { document, limit: 1000 }))
    .split("\n")
    .filter((line) => line.includes(text));
  if (lines.length !== 1) throw new Error(`${lines.length} lines hold ${JSON.stringify(text)}`);
  return /^\[(b\d+)\]/.exec(lines[0])[1];
}

const TASKS = {
  async "03-offer-letter-template"(document) {
    await call("fill_control", { document, name: "offer_date", value: "2026-12-01" });
    await call("fill_control", { document, name: "position", value: "Senior Data Engineer" });
    await call("fill_control", { document, name: "salary", value: "72,000" });
    await call("fill_control", { document, name: "remote", value: true });
    await call("update_fields", {
      document,
      data: { CandidateFirstName: "Ada", StartDate: "5 January 2027" },
    });
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
      paragraphs: ["A reference to a statute includes that statute as amended from time to time."],
    });
    await call("delete_block", {
      document,
      handle: await handleOf(document, "the existence and terms of the discussions"),
    });
  },
  async "04-board-report"(document) {
    const lines = (await call("read", { document, limit: 1000 })).split("\n");
    for (const line of lines) {
      const heading = /^\[(b\d+)\] heading ([123])[,:]/.exec(line);
      if (heading)
        await call("set_style", {
          document,
          handle: heading[1],
          style: `Heading ${Number(heading[2]) + 1}`,
        });
    }
    if (!(await call("update_fields", { document })).includes("field")) fail("04: no fields");
  },
};

/** A paragraph's text as Word's Range.Text gives it; null for one Word shows otherwise. */
const shownText = (p) =>
  (p.content ?? []).some((n) =>
    ["opaqueInline", "fieldStart", "noteReference", "pageBreak"].includes(n.type),
  )
    ? null
    : (p.content ?? [])
        .map((n) => {
          if (n.type === "text") return n.text;
          if (n.type === "tab") return "\t";
          if (n.type === "hardBreak") return "\n";
          return n.type === "picture" && !n.attrs?.float ? "/" : "";
        })
        .join("");
const paragraphs = (document) =>
  (document.content.content ?? []).filter((b) => b.type === "paragraph").map(shownText);

try {
  const { tools } = await client.listTools();
  if (tools.length !== 14) fail(`${tools.length} tools listed`);

  // The file rules, through a real process on a real folder.
  const outside = await refused("open", { path: join(corpus, "01-mutual-nda.docx") }, "outside");
  if (!outside.startsWith("A path is relative")) fail(`outside the root: ${outside}`);
  await refused("open", { path: "../foli/x.docx" }, "a path up");
  if (!(await refused("open", { path: "nope.docx" }, "a missing file")).startsWith("There is no"))
    fail("a missing file");

  for (const name of NAMES) {
    const original = readFileSync(join(work, `${name}.docx`));
    const document = /as (d\d+)\./.exec(await call("open", { path: `${name}.docx` }))[1];
    await TASKS[name](document);
    const over = await refused("save", { document, path: `${name}.docx` }, "over the original");
    if (!over.includes("exists")) fail(`save over the original: ${over}`);
    const saved = await call("save", { document });
    if (saved !== `Saved ${document} as ${name}.agent.docx.`) fail(`save said: ${saved}`);
    await call("close", { document });
    if (!readFileSync(join(work, `${name}.docx`)).equals(original))
      fail(`${name}: the original changed`);

    const bytes = readFileSync(join(work, `${name}.agent.docx`));
    writeFileSync(join(out, `${name}-agent.docx`), bytes);
    const { document: made } = await importDocx(new Uint8Array(bytes));
    const accept = createEditor({ document: made });
    accept.commands.acceptAllChanges();
    const reject = createEditor({ document: made });
    reject.commands.rejectAllChanges();
    const expected = {
      accepted: paragraphs(accept.getDocument()),
      rejected: paragraphs(reject.getDocument()),
    };
    writeFileSync(
      join(out, `${name}-agent.expected.json`),
      `${JSON.stringify(expected, null, 2)}\n`,
    );
    console.log(`${name}: done through the server, saved`);
  }
  if ((await call("list_documents")) !== "No document is open.") fail("documents left open");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

// The client goes: the server must end by itself.
const ended = new Promise((resolve) => {
  transport.onclose = () => resolve(true);
  setTimeout(() => resolve(false), 5000).unref();
});
await client.close();
if (!(await ended)) fail("the server did not end with its input");
if (stderr.trim()) fail(`the server wrote to stderr:\n${stderr}`);
if (!given) rmSync(dir, { recursive: true, force: true });
console.log(failures ? `${failures} failed` : "mcp-roundtrip: all passed");
process.exit(failures ? 1 : 0);
