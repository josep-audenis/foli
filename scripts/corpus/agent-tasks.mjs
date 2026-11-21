// What `agent-roundtrip.mjs` (through the library) and `mcp-roundtrip.mjs` (through the MCP
// server) share: the three tasks' names, what Word must find of each, and how Foli says what a
// saved document reads as with every change accepted and rejected. The steps of each task are
// in the two scripts: they differ by the API they go through, and must do the same.

import { createEditor } from "../../packages/core/dist/index.js";

export const AUTHOR = "Foli Agent";
export const COMMENT = "Extended to five years to match the supply agreement.";

/**
 * Per task (a corpus document's name): the kinds of revision Word must find and no other
 * (WdRevisionType: 1 insert, 2 delete, 10 paragraph property), the texts its insertions,
 * deletions and restyled paragraphs must hold, and the comment made.
 */
export const EXPECT = {
  "03-offer-letter-template": {
    types: [1, 2],
    inserted: ["1 December 2026", "Senior Data Engineer", "72,000", "Ada", "5 January 2027"],
    deleted: ["CandidateFirstName", "StartDate"],
  },
  "01-mutual-nda": {
    types: [1, 2],
    comment: COMMENT,
    inserted: ["five (5) years", "Signatory", "A reference to a statute includes"],
    deleted: ["three (3) years", "Party", "the existence and terms of the discussions"],
  },
  "04-board-report": {
    // The headings restyled; the table of contents built again from them (insertions and
    // deletions inside its field's result).
    types: [1, 2, 10],
    restyled: [
      "Executive summary",
      "Trading performance",
      "Sales by region",
      "Costs",
      "Staff costs",
      "Decisions requested",
      "Appendix: capital expenditure",
    ],
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

/**
 * What Foli expects Word to read of a saved document: its paragraphs outside tables with every
 * change accepted, and with every change rejected.
 */
export function expected(document) {
  const accept = createEditor({ document });
  accept.commands.acceptAllChanges();
  const reject = createEditor({ document });
  reject.commands.rejectAllChanges();
  return {
    accepted: paragraphs(accept.getDocument()),
    rejected: paragraphs(reject.getDocument()),
  };
}
