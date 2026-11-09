# ADR-0005: A Word-compatible document model with lossless DOCX round trip

- **Status:** Accepted (2026-11-09, by the owner). Replaces the Phase 8–12 plan of the roadmap.
- **Context:** Foli's purpose sharpens: an embeddable editor that feels like Word and works on
  real `.docx` files with as few problems as possible, so it can replace existing embeddable
  DOCX editors (which store the OOXML package as the truth and project it into an editor
  surface; in use, editing is where they fall short, and they have no tracked changes).
  Confirmed use (owner, 2026-11-09): any business document, first of all contracts and
  templates; edited files go back to Word users as `.docx`, or out as PDF; tracked changes and
  comments are required. So a document that is opened, edited and saved must lose nothing,
  and review is a core feature, not an extra.

Until now Foli has been JSON-native: its own schema (v2) styled by the host app's CSS, with DOCX
planned as an import/export converter in Phase 10 ("content fidelity, not identical
pagination"). That plan loses what the converter does not model (section settings, fields,
footnotes, content controls, bookmarks, most paragraph and run properties) and makes the same
document look different from Word (fonts, sizes and spacing come from CSS, not from the file's
styles).

## Question

What document model, interchange and verification make Foli edit real Word documents
faithfully, while keeping what Phases 1–7 built (own engine, transactions, history, the paged
view, React API)?

## Options

- **A. Keep the JSON-native model, add a DOCX converter** (the current plan). Simple; every
  round trip drops what the model lacks. Rejected: data loss on the first save.
- **B. OOXML as the source of truth**, parsed into a mirror of the XML, projected into an
  editing model, edits translated back. Lossless by construction, but two models to keep in
  step: every edit crosses the projection, and whatever the projection cannot express cannot be
  edited.
- **C. One Word-shaped editing model, with what it does not understand carried along
  untouched.** The JSON stays the only truth the engine edits, but its shape follows Word's
  (paragraph and run properties, styles, numbering, sections, in Word's units); OOXML that
  Foli does not model yet becomes opaque content kept verbatim and written back unchanged.

## Decision

**Option C.**

1. **The model follows Word (schema v3).**
   - **Paragraphs** carry Word's paragraph properties as attributes: style id, justification,
     indentation (left, right, first line, hanging), spacing (before, after, line and line
     rule), keep with next, keep lines together, widow control, page break before, outline
     level, numbering (`numId`, level), tab stops, borders and shading as they are added.
     Headings become paragraphs with a heading style (Word has no heading element); the view
     still renders `h1`–`h6` for those, for accessibility.
   - **Review content is part of the model from the start:** insertions and deletions (author,
     date) as marks, formatting changes as recorded previous properties, comment ranges as
     anchors with the comments in the envelope. Contracts arrive with them; carrying them as
     opaque content would make the text around them uneditable. Phase 8 imports, shows and
     exports them; Phase 9 records new changes, accepts and rejects them, and edits comments.
   - **Template content:** content controls (`w:sdt`: plain and rich text, drop-down, date,
     check box) and merge and form fields are modeled nodes (Phase 11), opaque until then.
   - **Text** carries Word's run properties as marks: character style, bold, italic, the
     underline styles, strike and double strike, font (per script), size, color, highlight
     (Word's named highlight colors) and shading, vertical alignment, caps and small caps,
     character spacing, as they are added.
   - **Styles** live in the envelope: paragraph, character, table and numbering styles with
     `basedOn`, `next` and linked styles, document defaults, and the theme's fonts and colors.
     The effective look of any text is resolved from defaults → style chain → direct
     formatting, as Word does.
   - **Lists are numbered paragraphs**, as in Word: a paragraph references a numbering
     definition and a level; the definitions (formats, start, restarts, indents, multi-level
     and legal numbering, numbered headings) live in the envelope. This replaces the nested
     `bulletList`/`orderedList`/`listItem` nodes of schema v2: Word's lists continue across
     other paragraphs, restart, and number headings, which nested list nodes cannot express.
     The v2 → v3 migration turns nested lists into numbered paragraphs; HTML copy and paste
     keep mapping them to and from `ul`/`ol`.
   - **Sections** carry page size, orientation, margins (header, footer, gutter), columns
     and their header and footer references; the document's `settings` become its sections.
   - **Units are Word's** (twips, half-points, eighths of a point, EMU), so values survive a
     round trip exactly; helpers convert to mm and pt for the API and the view.
2. **Lossless round trip.**
   - Import keeps the original package (`resources`): parts Foli does not edit (fonts,
     settings, custom XML, …) are written back byte for byte, relationships kept.
   - Elements Foli does not model become **opaque nodes** (block and inline) holding the
     original XML verbatim, shown as a placeholder or a best-effort preview, movable and
     deletable as a whole, never silently dropped. Unknown attributes and properties on known
     elements are kept in an extension bag on the node or mark and written back while the
     node is unchanged.
   - Export rebuilds only the parts the editor owns (`document.xml`, `styles.xml`,
     `numbering.xml`, …), reusing the original package for the rest.
   - Coverage grows by turning opaque content into editable nodes, measured on a corpus:
     opaque nodes per document goes down release by release.
3. **Word is the reference.** A local verification harness drives Microsoft Word through
   automation (Windows, owner's machine; LibreOffice headless as a fallback where Word is not
   available):
   - round trip without edits: the exported package equals the original after
     canonicalization (no part lost, no element dropped);
   - every export opens in Word without a repair prompt;
   - pagination agreement: Word's page for each paragraph (`Range.Information`) against Foli's,
     as a percentage, per document;
   - visual comparison of PDF pages, as a tracked number, not a pass/fail.
     A corpus of real documents (owner-provided, kept out of the repository when private, plus
     generated ones) is the input of every check.
4. **Layout from the document.** The view renders the resolved styles as a stylesheet for that
   document (scoped to its host), not the host app's CSS; the host theme keeps the chrome
   (canvas, toolbar). Fonts: the document's fonts when available, otherwise metric-compatible
   substitutes (e.g. Carlito for Calibri, Caladea for Cambria, under the SIL OFL), with the
   substitution reported. Identical line breaks to Word are not promised; agreement is
   measured (3.).
5. **Processing.** A new package `@folijs/docx` (no DOM: browser, worker and Node): zip with an
   audited small dependency (license checked), XML through an own tokenizer that keeps the
   exact source text of every element (needed to carry opaque content verbatim). Rust/WASM only
   for a measured need, as before.
6. **Everything in the model is editable.** One model, one engine: the editor's commands apply
   to whatever the import produced. A feature counts as supported only when it imports,
   renders, edits and exports.

## Consequences

- Schema v3 is a large, breaking change of the content model (paragraph attributes, run marks,
  numbered paragraphs, no heading or list nodes), with a v2 → v3 migration that keeps every
  document's content. Parts of Phase 7 are rebuilt on it: list editing (7.5) becomes level and
  numbering commands, the nested-list rendering of ADR-0004 is no longer needed for lists
  (it remains the base for tables), the toolbar's heading buttons become a style picker.
- The roadmap changes (below): the Word model and the round trip come first (Phase 8), then
  review (comments and tracked changes, from "optional" to Phase 9: the owner's documents
  depend on it), tables and images, sections with headers, footers, fields, content controls
  and notes, with PDF export, then 1.0.
- PDF output: today a browser prints the pages (one sheet per page). A programmatic export
  (`exportPdf`, headless browser on a server, the same layout) comes with headers, footers and
  fields (Phase 11), when the pages are complete.
- Hard areas, planned and measured rather than promised: tab stops (right, center, decimal,
  leaders), Word's table layout, floating images and text wrapping, columns, footnote placement,
  fonts not on the machine, Word's line breaking.
- The verification harness depends on Word on the owner's Windows machine: it runs locally,
  like the pre-push hook, not in a hosted CI.
- Bundle size grows (`@folijs/docx` is separate: apps that never touch DOCX do not load it).

## Roadmap (replaces Phases 8–12)

| Phase | Name                             | Outcome                                                                                              | Release |
| ----- | -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| 8     | Word model & DOCX round trip     | Schema v3, styles, numbering, sections, review content, `@folijs/docx`, opaque content, Word harness | 0.3.0   |
| 9     | Review                           | Tracked changes (recording, accept/reject) and comments, Word-compatible                             | 0.4.0   |
| 10    | Tables & images                  | Word tables (merges, borders, table styles) across pages, inline and floating images                 | 0.5.0   |
| 11    | Sections, fields, templates, PDF | Headers/footers, page numbers and fields, content controls, notes, columns, TOC, PDF export          | 0.6.0   |
| 12    | Ecosystem & 1.0                  | API freeze, extension API, docs site, performance in CI                                              | 1.0.0   |
| —     | Optional                         | Real-time collaboration, AI-assisted editing on the transaction API                                  | —       |
