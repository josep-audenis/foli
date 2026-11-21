/**
 * Three tasks as a model would call them (13.6): read, act on handles taken from the read, read
 * what came back. Each goes through `.docx` both ways, and each checks the promise the package
 * makes: every edit is the agent's tracked change, so rejecting them gives the document back.
 */
import { createEditor, type FoliDocument, rejectAllChanges, trackedChanges } from "@folijs/core";
import { exportDocx, importDocx } from "@folijs/docx";
import { describe, expect, it } from "vitest";
import { openSession, type Session } from "./index.js";
import { corpus } from "./testing/corpus.js";

const AUTHOR = "Agent";

/** The handle of the one line of a read that holds `text`: how a model picks a block. */
function handleOf(session: Session, text: string): string {
  const read = session.read();
  if (!read.ok) throw new Error(read.message);
  const lines = read.text.split("\n").filter((line) => line.includes(text));
  if (lines.length !== 1) throw new Error(`${lines.length} lines hold ${JSON.stringify(text)}`);
  return /^\[(b\d+)\]/.exec(lines[0] as string)?.[1] as string;
}
const text = (session: Session) => {
  const read = session.read();
  if (!read.ok) throw new Error(read.message);
  return read.text;
};
const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error((result as unknown as { message: string }).message);
  return result as Extract<T, { ok: true }>;
};

/** The document through `.docx` and back, as Word would get it and Foli read it again. */
async function throughDocx(session: Session, pkg: Awaited<ReturnType<typeof corpus>>["package"]) {
  const bytes = await exportDocx(session.document(), pkg);
  return importDocx(bytes);
}

/**
 * The agent's changes rejected (and its comments deleted: comments are not tracked changes):
 * the content must be the input's.
 */
function rejected(document: FoliDocument): FoliDocument {
  const editor = createEditor({ document });
  const changes = trackedChanges(editor.state.doc);
  expect(changes.length).toBeGreaterThan(0);
  editor.run(rejectAllChanges(AUTHOR));
  for (const comment of editor.getDocument().comments)
    if (comment.author === AUTHOR) editor.commands.deleteComment(comment.id);
  return editor.getDocument();
}

/** What a reader of the document sees: the body's blocks, with no handles. */
const seen = (document: FoliDocument) => text(openSession(document, { author: "Reader" }));

describe("fill a template", () => {
  it("fills an offer letter's controls and merge fields", async () => {
    const { document, package: pkg } = await corpus("03-offer-letter-template");
    const session = openSession(document, { author: AUTHOR });

    // The model reads, sees what is empty, and asks what there is to fill.
    expect(text(session)).toContain("Date: [empty: Offer date]");
    const controls = session.controls();
    expect(controls.map((c) => `${c.name}:${c.kind}`)).toEqual([
      "offer_date:date",
      "position:dropDown",
      "salary:text",
      "remote:checkbox",
      "benefits:richText",
    ]);

    ok(session.fillControl("offer_date", "2026-12-01"));
    // A wrong item is refused with the items there are; the model picks one of them.
    const wrong = session.fillControl("position", "Staff Engineer");
    expect(!wrong.ok && wrong.message).toContain("Senior Data Engineer");
    ok(session.fillControl("position", "Senior Data Engineer"));
    ok(session.fillControl("salary", "72,000"));
    ok(session.fillControl("remote", true));
    const fields = ok(
      session.updateFields({ data: { CandidateFirstName: "Ada", StartDate: "5 January 2027" } }),
    );
    expect(fields.updated).toBe(2);

    const filled = text(session);
    for (const line of [
      "Date: 1 December 2026",
      "Dear Ada,",
      "Position: Senior Data Engineer",
      "Annual salary (EUR): 72,000",
      "Start date: 5 January 2027",
      "☒ Remote working eligible",
    ])
      expect(filled).toContain(line);
    expect(filled).not.toContain("[empty:");

    const back = await throughDocx(session, pkg);
    expect(seen(back.document)).toBe(seen(session.document()));
    const changes = trackedChanges(createEditor({ document: back.document }).state.doc);
    expect(changes.every((c) => c.author === AUTHOR)).toBe(true);
    expect(seen(rejected(back.document))).toBe(seen(document));
    // Known difference (limitations.md): a placeholder that comes back loses the run properties
    // Foli keeps verbatim (here `w:lang`), and a date control keeps the date it was given in
    // its properties. Nothing else differs.
    const plain = (content: unknown) =>
      JSON.parse(
        JSON.stringify(content, (_key, value) =>
          Array.isArray(value) ? value.filter((v) => v?.type !== "runExt") : value,
        ),
      );
    const after = rejected(session.document());
    expect(after.content).not.toEqual(document.content);
    expect(plain(after.content)).toEqual(plain(document.content));
    const date = Object.keys(document.controls ?? {})[0] as string;
    expect({ ...after.controls?.[date], date: undefined }).toEqual({
      ...document.controls?.[date],
      date: undefined,
    });
  });
});

describe("redline a contract", () => {
  it("replaces terms, inserts and deletes clauses, and comments", async () => {
    const { document, package: pkg } = await corpus("01-mutual-nda");
    const session = openSession(document, { author: AUTHOR });

    const term = handleOf(session, "continues for a period of three (3) years");
    ok(session.replaceText(term, "three (3) years", "five (5) years"));
    ok(
      session.comment(term, "Extended to five years to match the supply agreement.", {
        on: "five (5) years",
      }),
    );

    // "Party" is there twice in the block: the first try is refused, the model asks for all.
    const parties = handleOf(session, 'each a "Party"');
    expect(session.replaceText(parties, "Part", "Signator")).toMatchObject({
      code: "several-matches",
    });
    ok(session.replaceText(parties, '"Party"', '"Signatory"'));

    const headings = handleOf(session, "Clause headings do not affect");
    const added = ok(
      session.insertAfter(headings, [
        "A reference to a statute includes that statute as amended from time to time.",
      ]),
    );
    expect(added.text).toContain("Clause, 1.3, changed: A reference to a statute");

    const gone = handleOf(session, "the existence and terms of the discussions");
    ok(session.deleteBlock(gone));

    const redlined = text(session);
    expect(redlined).toContain("for a period of five (5) years");
    expect(redlined).not.toContain("the existence and terms of the discussions");
    expect(redlined).toContain('each a "Signatory" and together');

    const back = await throughDocx(session, pkg);
    expect(seen(back.document)).toBe(seen(session.document()));
    const editor = createEditor({ document: back.document });
    const kinds = new Set(trackedChanges(editor.state.doc).map((c) => c.kind));
    expect([...kinds].sort()).toEqual([
      "deletion",
      "insertion",
      "paragraphDeletion",
      "paragraphInsertion",
    ]);
    expect(trackedChanges(editor.state.doc).every((c) => c.author === AUTHOR)).toBe(true);
    expect(back.document.comments).toMatchObject([{ author: AUTHOR }]);
    expect(seen(rejected(back.document))).toBe(seen(document));
    expect(rejected(session.document()).content).toEqual(document.content);
  });

  it("works on a document already redlined in Word, leaving Word's changes", async () => {
    const { document, package: pkg } = await corpus("02-services-agreement-redlined");
    const before = trackedChanges(createEditor({ document }).state.doc);
    expect(before.length).toBeGreaterThan(0);
    const session = openSession(document, { author: AUTHOR });

    const fees = handleOf(session, "Invoices are payable within forty-five (45) days");
    // The text Word's redline deleted is not there to replace.
    expect(session.replaceText(fees, "thirty (30) days", "sixty (60) days")).toMatchObject({
      code: "no-match",
    });
    ok(session.replaceText(fees, "forty-five (45) days", "sixty (60) days"));
    const cell = handleOf(session, "r3 c3, Normal: 40,000");
    ok(session.replaceText(cell, "40,000", "45,000"));

    const back = await throughDocx(session, pkg);
    expect(seen(back.document)).toBe(seen(session.document()));
    const after = trackedChanges(createEditor({ document: back.document }).state.doc);
    expect(after.filter((c) => c.author !== AUTHOR)).toHaveLength(before.length);
    // Rejecting the agent's changes leaves the document as Word's reviewers left it.
    expect(seen(rejected(back.document))).toBe(seen(document));
    expect(rejected(session.document()).content).toEqual(document.content);
  });
});

describe("restyle headings", () => {
  it("moves a report's headings a level down and rebuilds its table of contents", async () => {
    const { document, package: pkg } = await corpus("04-board-report");
    const session = openSession(document, { author: AUTHOR });
    expect(session.styles()).toEqual(expect.arrayContaining(["heading 2", "heading 3"]));

    // The model reads the styles off the lines and works from the deepest level up.
    const read = ok(session.read());
    const headings = read.blocks.filter((b) => /^heading [123]$/.test(b.style ?? ""));
    expect(headings.map((b) => `${b.style}: ${b.text}`)).toEqual([
      "heading 1: Executive summary",
      "heading 1: Trading performance",
      "heading 2: Sales by region",
      "heading 2: Costs",
      "heading 3: Staff costs",
      "heading 1: Decisions requested",
      "heading 1: Appendix: capital expenditure",
    ]);
    for (const block of headings) {
      const level = Number(block.style?.slice(-1));
      const result = ok(session.setStyle(block.handle, `Heading ${level + 1}`));
      expect(result.blocks[0]?.style).toBe(`heading ${level + 1}`);
    }
    // A style the document does not have is refused with the ones it has.
    expect(session.setStyle(headings[0]?.handle as string, "Chapter")).toMatchObject({
      code: "unknown-style",
    });

    const fields = ok(session.updateFields());
    expect(fields.rebuilt).toBe(1);
    const restyled = text(session);
    expect(restyled).toContain("heading 2, changed: Executive summary");
    expect(restyled).toContain("heading 4, changed: Staff costs");
    expect(restyled).toMatch(/toc 2[^\n]*: Executive summary/);

    const back = await throughDocx(session, pkg);
    expect(seen(back.document)).toBe(seen(session.document()));
    const changes = trackedChanges(createEditor({ document: back.document }).state.doc);
    // The seven headings, and the entries of the table of contents built again.
    expect(changes.filter((c) => c.kind === "paragraphFormatting").length).toBeGreaterThanOrEqual(
      7,
    );
    expect(changes.every((c) => c.author === AUTHOR)).toBe(true);
    expect(seen(rejected(back.document))).toBe(seen(document));
    // Known difference (limitations.md): the entries of a table of contents that was built
    // again come back with their text and style, without what Foli kept of them verbatim
    // (`w14:paraId`, tab stops in `ext`). The restyling alone comes back exactly.
    const entries = (content: unknown) =>
      JSON.parse(
        JSON.stringify(content, (key, value) =>
          key === "ext" || key === "attributes" ? undefined : value,
        ),
      );
    const after = rejected(session.document());
    expect(after.content).not.toEqual(document.content);
    expect(entries(after.content)).toEqual(entries(document.content));
    const alone = openSession(document, { author: AUTHOR });
    // A first read of the same document gives the same handles.
    ok(alone.read());
    for (const block of headings) {
      const level = Number(block.style?.slice(-1));
      ok(alone.setStyle(block.handle, `Heading ${level + 1}`));
    }
    expect(rejected(alone.document()).content).toEqual(document.content);
  });
});
