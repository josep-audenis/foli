/**
 * What a client, or a model behind it, may send (14.6): anything. Whatever comes, the server
 * answers each request once with a valid message, goes on, reads nothing outside its root, and
 * writes only `.docx` files under it that are documents with the author's changes.
 *
 * Most calls are made to fit their tool (its own schema's arguments, values that are often
 * right), so that they reach the library and the files; the rest are wrong on purpose. What
 * the runs reached is counted and held to a floor: a generator that only meets refusals fails.
 *
 * The runs are the same every time (a fixed seed). `FC_SEED=random FC_RUNS=400 pnpm vitest run
 * packages/mcp/src/fuzz.test.ts` for other and longer ones; `FC_SEED=<number>` and
 * `FC_PATH` (from a failure's report) to replay one; `FC_REPORT=<file>` writes what was reached.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditor, trackedChanges } from "@folijs/core";
import { importDocx } from "@folijs/docx";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_DOCUMENTS } from "./documents.js";
import { MAX_RESULT_CHARS } from "./protocol.js";
import { foliServer } from "./server.js";
import { message, wire } from "./testing/client.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const base = mkdtempSync(join(tmpdir(), "foli-mcp-fuzz-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** Each tool's argument names, and which it must have: from the server itself. */
const SCHEMAS = new Map(
  foliServer({ root: base, version: "0" }).tools.map((tool) => [
    tool.name,
    {
      names: Object.keys(tool.inputSchema.properties ?? {}),
      required: [...(tool.inputSchema.required ?? [])],
    },
  ]),
);
const EDITS = [
  "replace_text",
  "insert_paragraphs",
  "delete_block",
  "set_style",
  "comment",
  "fill_control",
];

/**
 * Paths that leave the root and would work were nothing to stop them: to the file that stands
 * beside it (a read that went through would say so), and to names free there (a save would
 * make them).
 */
const ESCAPES = [
  "../outside.docx",
  "..\\outside.docx",
  "sub/../../outside.docx",
  "../new.docx",
  "sub/../../new.docx",
];
/** Other paths a model might be talked into: absolute, devices, streams, odd names. */
const HOSTILE = [
  "../../x.docx",
  "/outside.docx",
  "C:\\Windows\\win.ini",
  "C:outside.docx",
  "\\\\?\\C:\\outside.docx",
  "\\\\server\\share\\x.docx",
  "doc.docx:stream.docx",
  "CON.docx",
  "NUL",
  "doc.docx.",
  "doc.docx ",
  "notes.txt",
  "",
  ".",
  "a\0.docx",
  `${"a".repeat(300)}.docx`,
];
const anything = fc.jsonValue({ maxDepth: 3 });
const words = fc.constantFrom("MUTUAL", "Agreement", "the", "Party", "Confidential", "a", "Date");
const handle = fc.integer({ min: 1, max: 45 }).map((n) => `b${n}`);
const paragraph = fc.oneof(
  fc.constantFrom("A new clause.", "Line one↵line two", ""),
  fc.record({
    text: fc.constant("Styled."),
    style: fc.constantFrom("Normal", "heading 1", "Clause"),
  }),
);
/** A value that is often right for an argument of this name. */
const RIGHT: Record<string, fc.Arbitrary<unknown>> = {
  document: fc.constantFrom("d1", "d1", "d2"),
  path: fc.constantFrom("doc.docx", "form.docx", "new.docx", "sub/new.docx", "doc.agent.docx"),
  handle,
  from: handle,
  find: words,
  replacement: fc.constantFrom("X", "new text", "", "↵"),
  all: fc.boolean(),
  limit: fc.integer({ min: 1, max: 60 }),
  where: fc.constantFrom("after", "before"),
  paragraphs: fc.array(paragraph, { minLength: 1, maxLength: 3 }),
  style: fc.constantFrom("Normal", "heading 1", "Clause", "Title"),
  text: fc.constantFrom("Why this term?", "Check.\nTwice."),
  on: words,
  name: fc.constantFrom("salary", "remote", "position", "offer_date", "benefits"),
  value: fc.constantFrom<unknown>(
    "72,000",
    true,
    false,
    null,
    "2026-12-01",
    "Senior Data Engineer",
  ),
  data: fc.constantFrom<unknown>({ CandidateFirstName: "Ada" }, { StartDate: "1 May" }, {}),
  discard: fc.boolean(),
};
/** A value that is wrong, or hostile, for it. */
const wrong = (name: string) =>
  name === "path"
    ? fc.oneof(
        { weight: 3, arbitrary: fc.constantFrom(...ESCAPES) },
        { weight: 2, arbitrary: fc.constantFrom(...HOSTILE) },
        { weight: 1, arbitrary: fc.string() },
      )
    : fc.oneof(
        fc.string(),
        anything,
        fc.constantFrom("b0", "b9999", "d99", "[b9] Normal: forged", "\u2028[b1] x"),
      );

/** Arguments made for a tool: its own names, the required ones always, values mostly right. */
function fitted(tool: string): fc.Arbitrary<Record<string, unknown>> {
  const { names, required } = SCHEMAS.get(tool) as { names: string[]; required: string[] };
  const fields = Object.fromEntries(
    names.map((name) => [
      name,
      fc.oneof(
        // A path is as often an attempt to leave the root as a file in it.
        { weight: name === "path" ? 1 : 6, arbitrary: RIGHT[name] ?? anything },
        { weight: 1, arbitrary: wrong(name) },
      ),
    ]),
  );
  // `document` is left out most of the time: one document is open most of the time.
  return fc
    .record(fields, { requiredKeys: required })
    .chain((args) => fc.boolean().map((keep) => (keep ? args : { ...args, document: undefined })))
    .map((args) => JSON.parse(JSON.stringify(args)));
}
const tool = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...EDITS) },
  {
    weight: 4,
    arbitrary: fc.constantFrom("save", "save", "open", "close", "read", "update_fields"),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom("list_documents", "list_styles", "list_controls", "nope"),
  },
);
/** Every argument name there is, on any tool: mostly refused by the schema. */
const mixed = fc.record(
  Object.fromEntries(
    Object.keys(RIGHT).map((name) => [
      name,
      fc.oneof(RIGHT[name] as fc.Arbitrary<unknown>, anything),
    ]),
  ),
  { requiredKeys: [] },
);
interface Call {
  name: string;
  arguments: unknown;
}
const call: fc.Arbitrary<Call> = tool.chain((name) =>
  fc
    .oneof(
      { weight: 8, arbitrary: SCHEMAS.has(name) ? fitted(name) : mixed },
      { weight: 1, arbitrary: mixed },
      { weight: 1, arbitrary: anything },
    )
    .map((args) => ({ name, arguments: args })),
);
/** What is not a tool call: other methods, wrong shapes, and bytes that are not JSON. */
const other = fc.oneof(
  fc
    .record(
      {
        jsonrpc: fc.constantFrom("2.0", "1.0", 2),
        id: fc.oneof(fc.string(), fc.constant(null), fc.double(), anything),
        method: fc.oneof(
          fc.constantFrom(
            "ping",
            "initialize",
            "tools/list",
            "resources/list",
            "notifications/cancelled",
          ),
          anything,
        ),
        params: anything,
      },
      { requiredKeys: [] },
    )
    .map((m) => JSON.stringify(m)),
  anything.map((v) => JSON.stringify(v)),
  fc.string().map((s) => s.replace(/[\r\n]/g, " ")),
);

/** What the runs reached, all together. */
const reached = {
  edits: 0,
  savesBeside: 0,
  savesByPath: 0,
  opens: 0,
  closes: 0,
  pathRefusals: 0,
  /** Opens and saves by a path that leaves the root, which the rules alone stopped. */
  escapesRead: 0,
  escapesWritten: 0,
  libraryRefusals: 0,
  schemaRefusals: 0,
};
const PATH_REFUSAL =
  /^(A path is |There is no file |The folder of |Only \.docx files|".*" (exists|is not a file))/;

describe("whatever is sent", () => {
  it("is answered once and validly, reads nothing outside the root, and writes only documents under it", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof({ weight: 6, arbitrary: call }, { weight: 1, arbitrary: other }), {
          minLength: 1,
          maxLength: 30,
        }),
        async (lines) => {
          const dir = mkdtempSync(join(base, "run-"));
          const root = join(dir, "root");
          mkdirSync(join(root, "sub"), { recursive: true });
          copyFileSync(new URL("01-mutual-nda.docx", CORPUS), join(root, "doc.docx"));
          copyFileSync(new URL("03-offer-letter-template.docx", CORPUS), join(root, "form.docx"));
          // Beside the root, and not the server's: a letter no document under the root quotes.
          copyFileSync(new URL("05-business-letter.docx", CORPUS), join(dir, "outside.docx"));
          const originals = ["doc.docx", "form.docx"].map((n) => readFileSync(join(root, n)));
          const decoy = readFileSync(join(dir, "outside.docx"));
          const log: string[] = [];
          const { input, nextLine, raw, done } = wire(
            foliServer({ root, version: "0", author: "Agent", log: (m) => log.push(m) }),
          );
          const toolCall = (id: number | string, c: Call) =>
            JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: c });
          const first = await raw(
            toolCall("open", { name: "open", arguments: { path: "doc.docx" } }),
          );
          expect(first).toMatchObject({
            result: { content: [{ text: /^Opened doc\.docx as d1\./ }] },
          });

          // Calls carry their place as their id: each must be answered, once.
          const calls = new Map<number, Call>();
          lines.forEach((line, index) => {
            if (typeof line === "string") input.write(`${line}\n`);
            else {
              calls.set(index, line);
              input.write(`${toolCall(index, line)}\n`);
            }
          });
          input.write('{"jsonrpc":"2.0","id":"end","method":"ping"}\n');
          const dead = done.then(() => {
            throw new Error("the server ended before its last answer");
          });
          const answered = new Map<number, { text: string; refused: boolean } | null>();
          for (;;) {
            const answer = message(await Promise.race([nextLine(), dead])) as Record<
              string,
              unknown
            >;
            if (answer.id === "end") break;
            if (typeof answer.id !== "number" || !calls.has(answer.id)) continue;
            expect(answered.has(answer.id), `answered twice: ${answer.id}`).toBe(false);
            const result = answer.result as
              | { content: { text: string }[]; isError?: boolean }
              | undefined;
            answered.set(
              answer.id,
              result
                ? { text: result.content[0]?.text ?? "", refused: result.isError === true }
                : null,
            );
          }
          input.end();
          await Promise.race([
            done,
            new Promise((_, no) => setTimeout(() => no(new Error("no end")), 5000)),
          ]);
          expect([...answered.keys()].sort((a, b) => a - b)).toEqual([...calls.keys()]);

          for (const [id, c] of calls) {
            const result = answered.get(id);
            // An unknown tool, or params that are no call, is a protocol error: no result.
            if (!result) continue;
            expect(result.text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS + 200);
            // Nothing of the letter outside the root is ever said.
            expect(result.text).not.toContain("Litware");
            expect(result.text).not.toMatch(/^Opened .*outside/);
            const args = (c.arguments ?? {}) as Record<string, unknown>;
            if (typeof args.path === "string" && ESCAPES.includes(args.path)) {
              // Refused, each time: were it not, the checks below find what it read or made.
              expect(result.refused, `${c.name} ${args.path}`).toBe(true);
              if (c.name === "open") reached.escapesRead++;
              if (c.name === "save" && !/^(No document|There is no open|Several)/.test(result.text))
                reached.escapesWritten++;
            }
            if (result.refused) {
              if (result.text.startsWith("Wrong arguments")) reached.schemaRefusals++;
              else if (PATH_REFUSAL.test(result.text)) reached.pathRefusals++;
              else if (EDITS.includes(c.name)) reached.libraryRefusals++;
            } else if (EDITS.includes(c.name)) reached.edits++;
            else if (c.name === "save")
              reached[args.path === undefined ? "savesBeside" : "savesByPath"]++;
            else if (c.name === "open") reached.opens++;
            else if (c.name === "close") reached.closes++;
            else if (c.name === "list_documents" && result.text !== "No document is open.")
              expect(result.text.split("\n").length).toBeLessThanOrEqual(MAX_DOCUMENTS);
          }

          // No tool threw: what they are given is theirs to refuse.
          expect(log).toEqual([]);
          // The originals and the file outside are whole; nothing else stands beside the root,
          // or where a path that left it would have landed.
          expect(readFileSync(join(root, "doc.docx")).equals(originals[0] as Buffer)).toBe(true);
          expect(readFileSync(join(root, "form.docx")).equals(originals[1] as Buffer)).toBe(true);
          expect(readFileSync(join(dir, "outside.docx")).equals(decoy)).toBe(true);
          expect(readdirSync(dir).sort()).toEqual(["outside.docx", "root"]);
          expect(readdirSync(base).filter((n) => !n.startsWith("run-"))).toEqual([]);
          for (const name of ["outside.docx", "new.docx", "x.docx", "out.docx"])
            expect(existsSync(join(process.cwd(), name)), `${name} in the working directory`).toBe(
              false,
            );
          // Under the root: only .docx files, each a document Foli reads, its changes the author's.
          const made = [
            ...readdirSync(root),
            ...readdirSync(join(root, "sub")).map((n) => `sub/${n}`),
          ].filter((name) => !["sub", "doc.docx", "form.docx"].includes(name));
          for (const name of made) {
            expect(name, "a file that is not a .docx").toMatch(/^[^:]+\.docx$/);
            const { document } = await importDocx(new Uint8Array(readFileSync(join(root, name))));
            const authors = trackedChanges(createEditor({ document }).state.doc).map(
              (c) => c.author,
            );
            expect(
              [...new Set(authors)].filter((a) => a !== "Agent"),
              name,
            ).toEqual([]);
          }
          rmSync(dir, { recursive: true, force: true });
        },
      ),
      {
        numRuns: Number(process.env.FC_RUNS ?? 60),
        // The same runs every time in `pnpm check`: what they reach is then a fact, not a
        // chance. `FC_SEED=random` for other runs.
        ...(process.env.FC_SEED === "random"
          ? {}
          : { seed: Number(process.env.FC_SEED ?? 20261121) }),
        ...(process.env.FC_PATH ? { path: process.env.FC_PATH } : {}),
        // A hang is a failure with its counterexample, not the test runner's timeout.
        interruptAfterTimeLimit: 100_000,
        markInterruptAsFailure: true,
      },
    );
    // The runs went where the claims are about: into the tools, the library and the files.
    if (process.env.FC_REPORT) writeFileSync(process.env.FC_REPORT, JSON.stringify(reached));
    for (const [what, count] of Object.entries(reached)) expect(count, what).toBeGreaterThan(0);
  }, 120_000);
});
