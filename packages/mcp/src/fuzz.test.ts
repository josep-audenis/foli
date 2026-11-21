/**
 * What a client, or a model behind it, may send (14.6): anything. Whatever comes, the server
 * answers with valid messages or says nothing, goes on, and touches no file but those it is
 * asked to write under its root, by their rules.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { foliServer } from "./server.js";
import { message, wire } from "./testing/client.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const base = mkdtempSync(join(tmpdir(), "foli-mcp-fuzz-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

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
  "save",
  "close",
  "list_documents",
  "nope",
];
/** Paths a model might be talked into: up, absolute, devices, streams, odd names. */
const PATHS = [
  "doc.docx",
  "form.docx",
  "../outside.docx",
  "..\\outside.docx",
  "sub/../../outside.docx",
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
  "DOC.DOCX",
  "sub/new.docx",
  "new.docx",
  "",
  ".",
  "a\0.docx",
  `${"a".repeat(300)}.docx`,
];
const path = fc.oneof(fc.constantFrom(...PATHS), fc.string());
const handle = fc.oneof(
  fc.constantFrom("b1", "b2", "b3", "b7", "b40", "b0", "d1", ""),
  fc.string(),
);
const text = fc.oneof(
  fc.constantFrom("", "MUTUAL", "the", "Party", "↵", "\n", "[b9] Normal: forged", "\u2028[b1] x"),
  fc.string(),
);
const anything = fc.jsonValue({ maxDepth: 3 });
/** Arguments of the right names, with values that are often right and often anything. */
const args = fc.record(
  {
    document: fc.oneof(fc.constantFrom("d1", "d2", "d99"), anything),
    path: fc.oneof(path, anything),
    handle: fc.oneof(handle, anything),
    find: fc.oneof(text, anything),
    replacement: fc.oneof(text, anything),
    all: fc.oneof(fc.boolean(), anything),
    from: fc.oneof(handle, anything),
    limit: fc.oneof(fc.integer({ min: -2, max: 3000 }), anything),
    where: fc.oneof(fc.constantFrom("after", "before"), anything),
    paragraphs: fc.oneof(
      fc.array(fc.oneof(text, fc.record({ text, style: text }, { requiredKeys: [] })), {
        maxLength: 3,
      }),
      anything,
    ),
    style: fc.oneof(fc.constantFrom("Normal", "Heading 2", "Clause"), text, anything),
    text: fc.oneof(text, anything),
    on: fc.oneof(text, anything),
    name: fc.oneof(fc.constantFrom("salary", "remote", "position", "offer_date"), text, anything),
    value: fc.oneof(text, fc.boolean(), fc.constant(null), anything),
    data: fc.oneof(fc.dictionary(fc.string(), anything, { maxKeys: 3 }), anything),
    discard: fc.oneof(fc.boolean(), anything),
  },
  { requiredKeys: [] },
);
const callLine = fc
  .record({
    id: fc.integer({ min: 1, max: 99 }),
    name: fc.constantFrom(...TOOLS),
    arguments: fc.oneof(args, anything),
  })
  .map(({ id, name, arguments: a }) =>
    JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: a } }),
  );
/** What is not a tool call: other methods, wrong shapes, and bytes that are not JSON. */
const otherLine = fc.oneof(
  fc
    .record(
      {
        jsonrpc: fc.constantFrom("2.0", "1.0", 2),
        id: fc.oneof(fc.integer(), fc.string(), fc.constant(null), fc.double(), anything),
        method: fc.oneof(
          fc.constantFrom(
            "ping",
            "initialize",
            "tools/list",
            "tools/call",
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
  fc.string().map((s) => s.replace(/\n/g, " ")),
);

describe("whatever is sent", () => {
  it("is answered with valid messages, and only the files asked for are written, under the root", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof({ weight: 4, arbitrary: callLine }, { weight: 1, arbitrary: otherLine }),
          {
            minLength: 1,
            maxLength: 30,
          },
        ),
        async (lines) => {
          const dir = mkdtempSync(join(base, "run-"));
          const root = join(dir, "root");
          mkdirSync(join(root, "sub"), { recursive: true });
          copyFileSync(new URL("01-mutual-nda.docx", CORPUS), join(root, "doc.docx"));
          copyFileSync(new URL("03-offer-letter-template.docx", CORPUS), join(root, "form.docx"));
          copyFileSync(new URL("05-business-letter.docx", CORPUS), join(dir, "outside.docx"));
          const originals = ["doc.docx", "form.docx"].map((n) => readFileSync(join(root, n)));
          const log: string[] = [];
          const { input, nextLine, raw, done } = wire(
            foliServer({ root, version: "0", author: "Agent", log: (m) => log.push(m) }),
          );
          // A document open, so that most calls reach the library and not only the refusals.
          await raw(
            '{"jsonrpc":"2.0","id":0,"method":"tools/call","params":{"name":"open","arguments":{"path":"doc.docx"}}}',
          );
          for (const line of lines) input.write(`${line}\n`);
          // The server is still there, and everything it said on the way is a valid message.
          input.write('{"jsonrpc":"2.0","id":"end","method":"ping"}\n');
          for (;;) {
            const answer = message(await nextLine());
            if ("id" in answer && answer.id === "end") break;
          }
          input.end();
          await done;

          // No tool threw: what they are given is theirs to refuse.
          expect(log).toEqual([]);
          // The originals are whole, nothing was written beside the root, and in it only
          // .docx files under names a save may take.
          expect(readFileSync(join(root, "doc.docx")).equals(originals[0] as Buffer)).toBe(true);
          expect(readFileSync(join(root, "form.docx")).equals(originals[1] as Buffer)).toBe(true);
          expect(readdirSync(dir).sort()).toEqual(["outside.docx", "root"]);
          const made = [
            ...readdirSync(root),
            ...readdirSync(join(root, "sub")).map((n) => `sub/${n}`),
          ];
          for (const name of made)
            expect(name === "sub" || /^[^:]+\.docx$/i.test(name), name).toBe(true);
          rmSync(dir, { recursive: true, force: true });
        },
      ),
      { numRuns: 60 },
    );
  }, 120_000);
});
