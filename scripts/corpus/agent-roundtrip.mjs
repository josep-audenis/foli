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
// agent's (the documents had none), of the kinds the task makes; the comment is there; Word's
// text with every change accepted, and rejected, is Foli's, paragraph by paragraph outside
// tables. <dir> outside the repository (word-review.ps1 asks for it).
// Prints one line per document; exits 1 on any difference.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSession } from "../../packages/agent/dist/index.js";
import { createEditor } from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir] = process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/agent-roundtrip.mjs make|check <dir>");
  process.exit(2);
}

const AUTHOR = "Foli Agent";
const COMMENT = "Extended to five years to match the supply agreement.";
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

// WdRevisionType: 1 insert, 2 delete, 10 paragraph property.
const TASKS = {
  "03-offer-letter-template": {
    types: [1, 2],
    run(session) {
      done(session.fillControl("offer_date", "2026-12-01"));
      done(session.fillControl("position", "Senior Data Engineer"));
      done(session.fillControl("salary", "72,000"));
      done(session.fillControl("remote", true));
      done(
        session.updateFields({ data: { CandidateFirstName: "Ada", StartDate: "5 January 2027" } }),
      );
    },
  },
  "01-mutual-nda": {
    types: [1, 2],
    comment: COMMENT,
    run(session) {
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
  },
  "04-board-report": {
    types: [10],
    run(session) {
      const headings = done(session.read()).blocks.filter((b) =>
        /^heading [123]$/.test(b.style ?? ""),
      );
      for (const block of headings)
        done(session.setStyle(block.handle, `Heading ${Number(block.style.slice(-1)) + 1}`));
    },
  },
};

/** A paragraph's text as Word's Range.Text gives it (an inline picture is "/"). */
const textOf = (p) =>
  (p.content ?? [])
    .map((n) => {
      if (n.type === "text") return n.text;
      if (n.type === "tab") return "\t";
      if (n.type === "hardBreak") return "\n";
      return n.type === "picture" && !n.attrs?.float ? "/" : "";
    })
    .join("");
/** A paragraph's text, or null for one Word shows otherwise (verbatim content, fields, notes). */
const shownText = (p) =>
  (p.content ?? []).some((n) =>
    ["opaqueInline", "fieldStart", "noteReference", "pageBreak"].includes(n.type),
  )
    ? null
    : textOf(p);
const paragraphs = (document) =>
  (document.content.content ?? []).filter((b) => b.type === "paragraph").map(shownText);
/** Word's paragraphs outside tables. */
const plain = (list) => list.filter((p) => !p.inTable).map((p) => p.text);

if (mode === "make") {
  const out = join(dir, "foli");
  mkdirSync(out, { recursive: true });
  for (const [name, task] of Object.entries(TASKS)) {
    const imported = await importDocx(new Uint8Array(readFileSync(join(corpus, `${name}.docx`))));
    const session = openSession(imported.document, { author: AUTHOR });
    task.run(session);
    const document = session.document();
    writeFileSync(
      join(out, `${name}-agent.docx`),
      await exportDocx(document, imported.package, { trackRevisions: true }),
    );
    const accept = createEditor({ document });
    accept.commands.acceptAllChanges();
    const reject = createEditor({ document });
    reject.commands.rejectAllChanges();
    const expected = {
      accepted: paragraphs(accept.getDocument()),
      rejected: paragraphs(reject.getDocument()),
    };
    writeFileSync(
      join(out, `${name}-agent.expected.json`),
      `${JSON.stringify(expected, null, 2)}\n`,
    );
    console.log(`${name}-agent.docx: made`);
  }
} else {
  let failures = 0;
  const fail = (name, what) => {
    failures++;
    console.log(`${name}: FAILED: ${what}`);
  };
  for (const [task, { types, comment }] of Object.entries(TASKS)) {
    const name = `${task}-agent`;
    const expected = JSON.parse(readFileSync(join(dir, "foli", `${name}.expected.json`), "utf8"));
    const word = JSON.parse(readFileSync(join(dir, "word", `${name}.json`), "utf8"));
    if (!word.opened) {
      fail(name, `Word did not open it: ${word.error}`);
      continue;
    }
    const others = word.revisions.filter((r) => r.author !== AUTHOR);
    if (others.length) fail(name, `${others.length} revisions not by ${AUTHOR}`);
    const seen = new Set(word.revisions.map((r) => r.type));
    for (const type of types) if (!seen.has(type)) fail(name, `no revision of type ${type}`);
    if (comment) {
      const made = word.comments.find((c) => c.text === comment);
      if (!made || made.author !== AUTHOR) fail(name, `comment: ${JSON.stringify(made)}`);
    } else if (word.comments.length) fail(name, `${word.comments.length} comments, none made`);
    // Paragraph by paragraph, case aside (Word's Range.Text applies the styles' all caps). Not
    // when Word has another number of paragraphs (a content control around paragraphs is one
    // block in Foli).
    let compared = "accept/reject text compared";
    for (const kind of ["accepted", "rejected"]) {
      const theirs = plain(word[kind]);
      const own = expected[kind];
      if (theirs.length !== own.length) {
        compared = `text not compared (${own.length} paragraphs in Foli, ${theirs.length} in Word)`;
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
