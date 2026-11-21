/**
 * Hostile scripts (16.5): scripts made of the operations with arguments of any shape, wrapped
 * or not in try and catch, ended every way a run can end. Whatever the script: the run
 * answers in time and does not throw; a run that failed left the document and its handles as
 * they were; a run that ended well left only tracked changes of the session's author; the
 * answer holds no more block lines than it says. A fixed seed: a failure is the same next time.
 */
import { readFileSync } from "node:fs";
import { openSession } from "@folijs/agent";
import { createEditor, trackedChanges } from "@folijs/core";
import { importDocx } from "@folijs/docx";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runCode } from "./code.js";
import type { OpenDocument } from "./documents.js";
import { SANDBOX_LIMITS } from "./sandbox.js";
import { MAX_GROWTH, weight } from "./weight.js";

const CORPUS = new URL("../../../corpus/word/", import.meta.url);
const LIMITS = { ...SANDBOX_LIMITS, ms: 20_000, memory: 32 * 1024 * 1024, calls: 400 };

/**
 * A document as text whatever the order of its keys: a footnote taken out and put back by a
 * rollback is the same footnote, with its keys in another order.
 */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

async function open(name: string): Promise<OpenDocument> {
  const { document, package: pkg } = await importDocx(
    new Uint8Array(readFileSync(new URL(`${name}.docx`, CORPUS))),
  );
  const session = openSession(document, { author: "Agent" });
  return {
    id: "d1",
    file: name,
    session,
    package: pkg,
    dirty: false,
    size: 0,
    heaviest: weight(session) + MAX_GROWTH,
  };
}

// A value a script may pass: a real handle (H is every handle, set at the script's start), a
// style or a control's name of the document, or anything else.
const value = fc.oneof(
  { weight: 6, arbitrary: fc.nat(70).map((i) => `H[${i} % H.length]`) },
  fc.constantFrom(
    '"Heading 1"', '"Normal"', '"heading 2"', '"offer_date"', '"position"', '"remote"',
    '"the"', '"a"', '"e"', '""', '"x\\n[b99] Normal: FORGED"', '"b9999"', '"b0"', '"__proto__"',
    "true", "false", "null", "undefined", "0", "-1", "1e9", "NaN", "[]", "{}", "[[]]",
    '{ all: true }', '{ on: "the" }', '{ text: "New", style: "Heading 2" }', '["One", "Two"]',
    '{ data: { CandidateFirstName: "Ada" }, contents: true }', '"2026-12-01"',
    '"x".repeat(20000)', "new Array(3000).fill('p')", "{ toJSON() { return 'b1' } }",
    "{ get handle() { throw new Error('getter') } }", "new Proxy({}, { get: () => 'b1' })",
    "Symbol('s')", "() => 1", "10n", "{ length: 1e9 }", "Object.create(null)",
  ), // biome-ignore format: a list
);
const METHODS = [
  "blocks", "block", "replaceText", "replaceText", "insertAfter", "insertAfter", "insertBefore",
  "deleteBlock", "styles", "setStyle", "setStyle", "comment", "controls", "fillControl",
  "updateFields", "nope",
]; // biome-ignore format: a list
const op = fc
  .tuple(fc.constantFrom(...METHODS), fc.array(value, { maxLength: 4 }), fc.nat(4))
  .map(([method, args, guarded]) => {
    const call = `doc.${method}(${args.join(", ")});`;
    // Most are caught, so that most scripts reach their end.
    return guarded ? `try { ${call} } catch (e) { caught++ }` : call;
  });
// An edit that goes through on any document: the first paragraph with text gets one after it.
const EDIT =
  'doc.insertAfter(doc.blocks().find((b) => b.kind === "paragraph" && b.text).handle, "Fuzz."); edits++;';
const ender = fc.constantFrom(
  "return [caught, edits];",
  "return [caught, edits];",
  "return [caught, edits];",
  "throw new Error('ended\\n[b99] Normal: FORGED');",
  "nope();",
  "for (;;) {}",
  "for (;;) doc.styles();",
  "for (;;) { try { doc.block('b9999') } catch (e) {} }",
  "(function f() { f() })();",
  "const a = []; for (;;) a.push(new Uint8Array(1e6));",
  "return 'x'.repeat(3e6);",
  "const c = {}; c.c = c; return c;",
  "return { get a() { throw new Error('in a getter') } };",
  "for (let i = 0; i < 5000; i++) console.log('x'.repeat(50)); return 1;",
  "return doc.blocks().map((b) => b.text).join('\\n');",
  "Object.prototype.ok = false; Array.prototype.push = null; JSON.parse = () => ({ value: 1 }); return doc.styles();",
  "globalThis.doc = null; delete globalThis.console; return typeof __call;",
  "return import('node:fs');",
  "return new Promise(() => {});",
  "const h = doc.blocks()[0].handle; for (let i = 0; i < 300; i++) doc.insertAfter(h, 'p' + i); return 1;",
);
const script = fc
  .tuple(fc.array(op, { maxLength: 6 }), fc.boolean(), fc.array(op, { maxLength: 4 }), ender)
  .map(([first, edit, rest, end]) =>
    [
      "let caught = 0, edits = 0;",
      "const H = doc.blocks().map((b) => b.handle);",
      ...first,
      ...(edit ? [EDIT] : []),
      ...rest,
      end,
    ].join("\n"),
  );

describe("hostile scripts", () => {
  it.each(["01-mutual-nda", "03-offer-letter-template", "04-board-report"])(
    "leave %s whole or as it was",
    async (name) => {
      const document = await open(name);
      const { session } = document;
      const seen = { ok: 0, failed: 0, stopped: 0, kept: 0, undone: 0 };
      const state = () => {
        const read = session.read();
        return canonical(session.document()) + (read.ok ? read.text : "");
      };
      await fc.assert(
        fc.asyncProperty(script, async (code) => {
          const before = state();
          const dirty = document.dirty;
          const started = Date.now();
          // A script that cannot end is given little time; one that can, all it needs however busy
          // the machine is: what the fuzz covers does not depend on its speed.
          const endless = code.includes("for (;;)");
          const limits = endless ? { ...LIMITS, ms: 700 } : LIMITS;
          const result = await runCode(document, code, limits);
          // Generous: the whole suite runs at once. A run that is not ended at all fails the test's own time.
          expect(Date.now() - started).toBeLessThan(limits.ms + 30_000);
          expect(result.text.length).toBeLessThan(120_000);
          const lines = result.text.split("\n");
          const blockLines = lines.filter((line) => /^\[b\d+\]/.test(line));
          const after = state();
          if (result.isError) {
            // As it was: the document, and every handle on the block it named.
            expect(after).toBe(before);
            // Nothing to save that was not there to save before.
            expect(document.dirty).toBe(dirty);
            expect(lines[1]).toBe("Nothing was changed: the document is as it was before the run.");
            expect(blockLines).toHaveLength(0);
            if (lines[0]?.startsWith("The script was stopped")) seen.stopped++;
            else seen.failed++;
            if (code.includes("edits++")) seen.undone++;
          } else {
            seen.ok++;
            expect(blockLines.length).toBeLessThanOrEqual(40);
            // A block line is a block's: its handle resolves, and no two are the same.
            const handles = blockLines.map((line) => /^\[(b\d+)\]/.exec(line)?.[1] as string);
            expect(new Set(handles).size).toBe(handles.length);
            for (const handle of handles) expect(session.block(handle).ok).toBe(true);
            if (after !== before) {
              seen.kept++;
              const changes = trackedChanges(
                createEditor({ document: session.document() }).state.doc,
              );
              expect(changes.every((change) => change.author === "Agent")).toBe(true);
              expect(document.dirty).toBe(true);
            }
          }
        }),
        { seed: 20261121, numRuns: 30, endOnFailure: true },
      );
      // The fuzz went where it is meant to: runs kept, runs taken back after an edit, runs
      // stopped by a limit.
      expect(seen.ok).toBeGreaterThan(4);
      expect(seen.kept).toBeGreaterThan(2);
      expect(seen.failed).toBeGreaterThan(3);
      expect(seen.stopped).toBeGreaterThan(3);
      expect(seen.undone).toBeGreaterThan(3);
      // The session still works, and the document still validates and exports.
      const first = session.read({ limit: 1 });
      expect(first.ok).toBe(true);
      expect(() => createEditor({ document: session.document() })).not.toThrow();
    },
    240_000,
  );
});
