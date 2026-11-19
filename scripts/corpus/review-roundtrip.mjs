// Review content between Foli and Word (9.8). Run after `pnpm build`, with Word:
//
//   node scripts/corpus/review-roundtrip.mjs make <dir> [in folder, default corpus/word]
//   powershell -ExecutionPolicy Bypass -File scripts/corpus/word-review.ps1 `
//     -In <dir>/foli -Out <dir>/word -Edit <dir>/edited
//   node scripts/corpus/review-roundtrip.mjs check <dir>
//
// `make` opens every document in Foli with tracking on and, as "Foli Reviewer", types at the
// start of the first paragraph, deletes the first word of the second, makes text of the third
// bold and centers it, comments text of the fourth, replies as "Foli Replier" and resolves the
// thread; it exports <name>-foli.docx to <dir>/foli with what Foli expects of it.
// `check` compares, for each, what Word read (word-review.ps1): it opened; Foli's changes are
// there (insertions, deletions, formatting, paragraph formatting, by their author, with their
// text); the comment, the reply and the resolved state are; Word's text with every change
// accepted, and rejected, is Foli's (paragraphs outside tables, those with content Foli keeps
// verbatim aside: they have no text in Foli). Then, in the copy Word edited
// (<dir>/edited), Foli reads Word's tracked insertion and its reply to the first comment.
// Prints one line per document; exits 1 on any difference.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEditor } from "../../packages/core/dist/index.js";
import { exportDocx, importDocx } from "../../packages/docx/dist/index.js";

const [mode, dir, input = join(import.meta.dirname, "..", "..", "corpus", "word")] =
  process.argv.slice(2);
if ((mode !== "make" && mode !== "check") || !dir) {
  console.error("Usage: node scripts/corpus/review-roundtrip.mjs make|check <dir> [in folder]");
  process.exit(2);
}

const AUTHOR = "Foli Reviewer";
const REPLIER = "Foli Replier";
const INSERTED = "Foli inserted. ";

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
const paragraphs = (document) =>
  (document.content.content ?? []).filter((b) => b.type === "paragraph");

/** Positions of the inline content of each non-empty paragraph. */
function textParagraphs(doc) {
  const out = [];
  doc.forEach((block, offset) => {
    if (block.isTextblock && block.textContent.trim()) out.push({ block, start: offset + 1 });
  });
  return out;
}

/** Word's paragraphs outside tables. */
const plain = (list) => list.filter((p) => !p.inTable).map((p) => p.text);
/** A paragraph's text, or null for one with content Foli keeps verbatim (no text in Foli). */
const shownText = (p) =>
  (p.content ?? []).some((n) => n.type === "opaqueInline") ? null : textOf(p);

if (mode === "make") {
  const out = join(dir, "foli");
  mkdirSync(out, { recursive: true });
  for (const file of readdirSync(input).filter((n) => n.endsWith(".docx"))) {
    const imported = await importDocx(new Uint8Array(readFileSync(join(input, file))));
    const editor = createEditor({
      document: imported.document,
      author: AUTHOR,
      trackChanges: true,
    });
    const at = () => textParagraphs(editor.state.doc);
    const [first] = at();
    editor.select(first.start);
    editor.commands.insertText(INSERTED);
    const second = at()[1];
    const word = second.block.textContent.match(/^\S+/)?.[0] ?? "";
    editor.select(second.start, second.start + word.length);
    editor.commands.deleteSelection();
    const third = at()[2];
    editor.select(third.start, third.start + Math.min(5, third.block.content.size));
    editor.commands.toggleMark("bold");
    editor.commands.setAlign("center");
    const fourth = at()[3] ?? third;
    editor.select(fourth.start, fourth.start + Math.min(4, fourth.block.content.size));
    editor.commands.addComment("Foli comment.", { initials: "FR" });
    const comment = Math.max(...editor.getDocument().comments.map((c) => c.id));
    editor.commands.replyToComment(comment, "Foli reply.", { author: REPLIER });
    editor.commands.resolveComment(comment);
    const document = editor.getDocument();
    const name = file.replace(/\.docx$/, "-foli");
    writeFileSync(
      join(out, `${name}.docx`),
      await exportDocx(document, imported.package, { trackRevisions: true }),
    );
    const accept = createEditor({ document });
    accept.commands.acceptAllChanges();
    const reject = createEditor({ document });
    reject.commands.rejectAllChanges();
    const expected = {
      deleted: word,
      accepted: paragraphs(accept.getDocument()).map(shownText),
      rejected: paragraphs(reject.getDocument()).map(shownText),
    };
    writeFileSync(join(out, `${name}.expected.json`), `${JSON.stringify(expected, null, 2)}\n`);
    console.log(`${name}.docx: made`);
  }
} else {
  let failures = 0;
  const fail = (name, what) => {
    failures++;
    console.log(`${name}: FAILED: ${what}`);
  };
  for (const file of readdirSync(join(dir, "foli")).filter((n) => n.endsWith(".docx"))) {
    const name = file.replace(/\.docx$/, "");
    const expected = JSON.parse(readFileSync(join(dir, "foli", `${name}.expected.json`), "utf8"));
    const word = JSON.parse(readFileSync(join(dir, "word", `${name}.json`), "utf8"));
    if (!word.opened) {
      fail(name, `Word did not open it: ${word.error}`);
      continue;
    }
    const ours = word.revisions.filter((r) => r.author === AUTHOR);
    const types = new Set(ours.map((r) => r.type));
    // WdRevisionType: 1 insert, 2 delete, 3 property (run), 10 paragraph property.
    for (const [type, what] of [
      [1, "insertion"],
      [2, "deletion"],
      [3, "formatting"],
      [10, "paragraph formatting"],
    ])
      if (!types.has(type)) fail(name, `no ${what} by ${AUTHOR}`);
    const inserted = ours
      .filter((r) => r.type === 1)
      .map((r) => r.text)
      .join("");
    const deleted = ours
      .filter((r) => r.type === 2)
      .map((r) => r.text)
      .join("");
    if (!inserted.includes(INSERTED.trim()))
      fail(name, `inserted text: ${JSON.stringify(inserted)}`);
    if (expected.deleted && !deleted.includes(expected.deleted))
      fail(name, `deleted text: ${JSON.stringify(deleted)}`);
    const comment = word.comments.findIndex((c) => c.text === "Foli comment.");
    const reply = word.comments.find((c) => c.text === "Foli reply.");
    if (comment < 0) fail(name, "no comment");
    else {
      const c = word.comments[comment];
      if (c.author !== AUTHOR || c.initials !== "FR" || !c.done)
        fail(name, `comment: ${JSON.stringify(c)}`);
      if (!reply || reply.author !== REPLIER || reply.parent !== comment || !reply.done)
        fail(name, `reply: ${JSON.stringify(reply)}`);
    }
    // Paragraph by paragraph, those with verbatim content aside (null in Foli's), case aside
    // (Word's Range.Text applies the heading styles' all caps). Not when Word has another number
    // of paragraphs (a content control around paragraphs is one block in Foli).
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
      if (differs >= 0) fail(name, `${kind} paragraph ${differs} differs from Foli's`);
    }

    // Word's own edits to the file Foli made, read back by Foli.
    const edited = join(dir, "edited", `${name}-word.docx`);
    const back = await importDocx(new Uint8Array(readFileSync(edited)));
    const authors = [];
    const walk = (node) => {
      if (node.type === "text" && node.text?.includes("Word edit."))
        for (const m of node.marks ?? []) if (m.type === "insertion") authors.push(m.attrs.author);
      for (const child of node.content ?? []) walk(child);
    };
    walk(back.document.content);
    if (!authors.length || authors.includes(AUTHOR))
      fail(name, "Word's tracked insertion not read back");
    const words = back.document.comments;
    const answer = words.find((c) => textOf(c.content[0] ?? {}) === "Word reply.");
    const roots = new Set(words.filter((c) => c.parent === undefined).map((c) => c.id));
    if (words.length && (!answer || !roots.has(answer.parent)))
      fail(name, "Word's reply not read back");
    console.log(`${name}: checked (${ours.length} revisions by ${AUTHOR}, ${compared})`);
  }
  if (failures) process.exit(1);
}
