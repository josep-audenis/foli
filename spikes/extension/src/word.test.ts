/**
 * The Word round trip of ADR-0008's spike, run by hand on a machine with Word (Windows):
 *
 *   pnpm exec playwright test --project="extension-*"   # writes the editor's files
 *   FOLI_WORD=1 pnpm exec vitest run spikes/extension/src/word.test.ts
 *
 * Writes the sample documents (and the editor's, which the e2e tests leave in `out/`) as .docx; Word
 * opens each through COM (`word.ps1`), lists its content controls, types a word, saves it; Foli
 * reads Word's file back and must find every custom node and mark as it was.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { FoliDocument, NodeJSON } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { fromWord, toWord } from "./docx.js";
import { controlsOf, customs, longTag, sample } from "./sample.js";
import { mentionText } from "./spec.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const DIR = join(ROOT, "test-results", "extension-word");
const EDITOR = join(ROOT, "spikes", "extension", "out");
const nodeText = (node: NodeJSON) => mentionText(node.attrs ?? {});
const json = (path: string) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));

describe.skipIf(!process.env.FOLI_WORD)("custom nodes and marks through Word (spike)", () => {
  it("Word opens, edits and saves them; Foli reads them back the same", async () => {
    const foli = join(DIR, "foli");
    const word = join(DIR, "word");
    mkdirSync(foli, { recursive: true });
    const expected = new Map<string, unknown[]>();
    /** What Word must list: the controls as Foli wrote them, in order. */
    const controls = new Map<string, ReturnType<typeof controlsOf>>();
    for (const [name, doc] of [
      ["sample", sample()],
      ["long-tag", longTag()],
    ] as [string, FoliDocument][]) {
      const out = toWord(doc, nodeText);
      writeFileSync(join(foli, `${name}.docx`), await exportDocx(out));
      expected.set(name, customs(doc.content));
      controls.set(name, controlsOf(out));
    }
    const typed = [
      { node: "acme:mention", attrs: { id: "u-42", label: "Ada Lovelace" }, marks: [] },
      { text: "budget", marks: [{ type: "acme:topic", attrs: { topic: "finance" } }] },
    ];
    for (const file of existsSync(EDITOR) ? readdirSync(EDITOR) : []) {
      copyFileSync(join(EDITOR, file), join(foli, file));
      const name = file.replace(/\.docx$/, "");
      expected.set(name, typed);
      // The editor's file as Foli reads it, without the mapping.
      const read = await importDocx(readFileSync(join(EDITOR, file)));
      controls.set(name, controlsOf(read.document));
    }
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(import.meta.dirname, "..", "word.ps1"),
        "-In",
        foli,
        "-Out",
        word,
      ],
      { stdio: "inherit", timeout: 300_000 },
    );
    for (const [name, wanted] of expected) {
      const report = json(join(word, `${name}.json`));
      expect(report.error, name).toBeNull();
      // Word lists each one as a content control: a node as plain text (1), contents locked,
      // showing `@label`; a marked run as rich text (0) around its text; every tag as written.
      expect(report.controls.length, name).toBeGreaterThan(0);
      expect(report.controls, name).toEqual(controls.get(name));
      const { document } = await importDocx(readFileSync(join(word, `${name}.docx`)));
      const back = fromWord(document);
      expect(customs(back.content), name).toEqual(wanted);
      expect(JSON.stringify(back.content), name).toContain("Word edit. ");
    }
  }, 600_000);
});
