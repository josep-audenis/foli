// What an agent's session makes, read by Word (13.6). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/agent-roundtrip.mjs make <dir>
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-review.ps1 `
//     -In <dir>/foli -Out <dir>/word
//   node scripts/corpus/agent-roundtrip.mjs check <dir>
//
// `make` runs three tasks on corpus documents through `@folijs/agent`, as "Foli Agent": fills
// the offer letter's content controls and merge fields, redlines the NDA (replaces, inserts and
// deletes clauses, comments), and moves the board report's headings a level down. It exports
// <name>-agent.docx to <dir>/foli with what Foli expects of it.
// `check` compares what Word read (word-review.ps1): it opened; every tracked change is the
// agent's (the documents had none) and of the kinds the task makes, no other; Word's
// insertions, deletions and restyled paragraphs hold the texts the task wrote and removed; the
// comment is there; Word's text with every change accepted, and rejected, is Foli's, paragraph
// by paragraph outside tables (paragraphs with fields, notes or page breaks aside: the texts
// above cover what is in them). <dir> outside the repository (word-review.ps1 asks for it).
// Prints one line per document; exits 1 on any difference.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSession } from "../../packages/agent/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";
import { AUTHOR, COMMENT, EXPECT, expected } from "./agent-tasks.mjs";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/agent-roundtrip.mjs make|check <dir>");
  process.exit(2);
}

const corpus = join(import.meta.dirname, "..", "..", "corpus", "word");

const done = (result) => {
  if (!result.ok) throw new Error(result.message);
  return result;
};
/** The handle of the one line of a read that holds `text`. */
function handleOf(session, text) {
  const lines = done(session.read())
    .text.split("\n")
    .filter((line) => line.includes(text));
  if (lines.length !== 1) throw new Error(`${lines.length} lines hold ${JSON.stringify(text)}`);
  return /^\[(b\d+)\]/.exec(lines[0])[1];
}

/** Each task's steps through the library; what Word must find of it is `EXPECT`'s. */
const RUN = {
  "03-offer-letter-template"(session) {
    done(session.fillControl("offer_date", "2026-12-01"));
    done(session.fillControl("position", "Senior Data Engineer"));
    done(session.fillControl("salary", "72,000"));
    done(session.fillControl("remote", true));
    done(
      session.updateFields({ data: { CandidateFirstName: "Ada", StartDate: "5 January 2027" } }),
    );
  },
  "01-mutual-nda"(session) {
    const term = handleOf(session, "continues for a period of three (3) years");
    done(session.replaceText(term, "three (3) years", "five (5) years"));
    done(session.comment(term, COMMENT, { on: "five (5) years" }));
    done(session.replaceText(handleOf(session, 'each a "Party"'), '"Party"', '"Signatory"'));
    done(
      session.insertAfter(handleOf(session, "Clause headings do not affect"), [
        "A reference to a statute includes that statute as amended from time to time.",
      ]),
    );
    done(session.deleteBlock(handleOf(session, "the existence and terms of the discussions")));
  },
  "04-board-report"(session) {
    const headings = done(session.read()).blocks.filter((b) =>
      /^heading [123]$/.test(b.style ?? ""),
    );
    for (const block of headings)
      done(session.setStyle(block.handle, `Heading ${Number(block.style.slice(-1)) + 1}`));
    if (done(session.updateFields()).rebuilt !== 1) throw new Error("no table of contents");
  },
};

/** Word's paragraphs outside tables. */
const plain = (list) => list.filter((p) => !p.inTable).map((p) => p.text);

if (mode === "make") {
  const out = join(dir, "foli");
  mkdirSync(out, { recursive: true });
  for (const [name, run] of Object.entries(RUN)) {
    const imported = await importDocx(new Uint8Array(readFileSync(join(corpus, `${name}.docx`))));
    const session = openSession(imported.document, { author: AUTHOR });
    run(session);
    const document = session.document();
    writeFileSync(
      join(out, `${name}-agent.docx`),
      await exportDocx(document, imported.package, { trackRevisions: true }),
    );
    writeFileSync(
      join(out, `${name}-agent.expected.json`),
      `${JSON.stringify(expected(document), null, 2)}\n`,
    );
    console.log(`${name}-agent.docx: made`);
  }
} else {
  let failures = 0;
  const fail = (name, what) => {
    failures++;
    console.log(`${name}: FAILED: ${what}`);
  };
  for (const [task, spec] of Object.entries(EXPECT)) {
    const { types, comment } = spec;
    const name = `${task}-agent`;
    const foli = JSON.parse(readFileSync(join(dir, "foli", `${name}.expected.json`), "utf8"));
    let word;
    try {
      word = JSON.parse(readFileSync(join(dir, "word", `${name}.json`), "utf8"));
    } catch {
      fail(name, "Word's reading is missing: run word-review.ps1 first");
      continue;
    }
    if (!word.opened) {
      fail(name, `Word did not open it: ${word.error}`);
      continue;
    }
    const others = word.revisions.filter((r) => r.author !== AUTHOR);
    if (others.length) fail(name, `${others.length} revisions not by ${AUTHOR}`);
    const seen = new Set(word.revisions.map((r) => r.type));
    for (const type of types) if (!seen.has(type)) fail(name, `no revision of type ${type}`);
    for (const type of seen) if (!types.includes(type)) fail(name, `a revision of type ${type}`);
    // What the task wrote and removed, in Word's own reading of the changes.
    const textOfType = (type) =>
      word.revisions
        .filter((r) => r.type === type)
        .map((r) => r.text)
        .join("\n");
    for (const [what, type] of [
      ["inserted", 1],
      ["deleted", 2],
      ["restyled", 10],
    ])
      for (const text of spec[what] ?? [])
        if (!textOfType(type).includes(text))
          fail(name, `${what} text not in Word's revisions: ${JSON.stringify(text)}`);
    if (comment) {
      const made = word.comments.find((c) => c.text === comment);
      if (!made || made.author !== AUTHOR) fail(name, `comment: ${JSON.stringify(made)}`);
    } else if (word.comments.length) fail(name, `${word.comments.length} comments, none made`);
    // Paragraph by paragraph, case aside (Word's Range.Text applies the styles' all caps).
    let compared = "accept/reject text compared";
    for (const kind of ["accepted", "rejected"]) {
      const theirs = plain(word[kind]);
      const own = foli[kind];
      if (theirs.length !== own.length) {
        compared = "text not compared";
        fail(name, `${kind}: ${own.length} paragraphs in Foli, ${theirs.length} in Word`);
        continue;
      }
      const differs = own.findIndex(
        (text, i) => text !== null && text.toLowerCase() !== theirs[i]?.toLowerCase(),
      );
      if (differs >= 0)
        fail(
          name,
          `${kind} paragraph ${differs}: Foli ${JSON.stringify(own[differs])}, Word ${JSON.stringify(theirs[differs])}`,
        );
    }
    console.log(`${name}: checked (${word.revisions.length} revisions by ${AUTHOR}, ${compared})`);
  }
  if (failures) process.exit(1);
}
