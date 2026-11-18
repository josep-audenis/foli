# ADR-0007: Stories, fields and content controls

- **Status:** Accepted, task 11.1 (2026-11-18), under the owner's instruction of that day to
  build Phase 11 task by task and merge each task after an agent's review. The owner has not
  read it line by line; a change of mind costs what has been built on it by then.
- **Context:** schema v4 keeps a section's headers and footers as relationship ids into the
  original package and notes as parts of it: exported verbatim, never shown. A note reference,
  a simple field, a content control are `opaqueInline` or `opaqueBlock` nodes; a complex field's
  structure (`w:fldChar`, `w:instrText`) is opaque with its result as editable text. Pages have
  one column. Phase 11 makes all of this visible and editable, as Word models it, and adds PDF.

## Question

How does Foli model, lay out and edit content that lives outside the body (headers, footers,
notes), Word's fields and content controls, and columns, keeping one editable host per page
flow, one undo history, tracked changes and a lossless DOCX round trip?

## Spike (`spikes/two-page/stories.html`, `e2e/stories.spec.ts`)

A header repeated on two pages and a footnote at its reference's page foot, edited in place. To
edit a story the host's `contenteditable` is turned off and the story's element turned on, so
the story is the only editing host; Escape, or a press outside it, reverses that. Passing twice
in Chromium, Firefox and WebKit (Playwright, Windows), 2026-11-18:

| Experiment                                                   | All three engines                         |
| ------------------------------------------------------------ | ----------------------------------------- |
| Double click a header, type                                  | text in the header, every copy; body same |
| The same from the copy on page 2                             | the same story changes                    |
| Arrows, End, PageDown, Ctrl+End, Home, Ctrl+Home, Backspace  | the caret stays in the story              |
| Ctrl+A, then typing                                          | selects and replaces the story only       |
| Escape                                                       | back in the body at the saved caret       |
| A click on the body                                          | leaves the story, caret where clicked     |
| Lines added above a reference                                | its note moves to the reference's page    |
| A note growing by typing                                     | lines leave its page, caret kept          |
| A note growing until its reference moves, while being edited | moved element, focus and caret restored   |

IME through CDP (Chromium only): a composition in a header commits into every copy; a
composition in a note is not moved while composing, and the note changes page once committed.

Recorded for comparison, an **editable island** (the story editable inside the still-editable
host): typing reaches the story, but Ctrl+A selects the whole host (151, 182 and 136 characters
against the header's 12) and ArrowDown leaves it in every engine. That is why the host is turned
off. Not in the spike: a note split across pages (the body's line splitting applies), and
tables or pictures in a story (the real view renders them).

## Decision

### Stories

- **A story** is a content tree outside the body: `stories: Record<string, StoryJSON>` in the
  envelope, `StoryJSON = { kind: "header" | "footer" | "footnote" | "endnote", content }`, plus
  what the part keeps verbatim (`ext`). `content` is a `doc` of the body's blocks (paragraphs,
  tables, opaque blocks). No section breaks in a story; no note references in a header or footer
  or a note; no page or column breaks in a note. Validation refuses these.
- **Ids.** A header's or footer's id is its relationship id, as `section.headers` and
  `section.footers` already hold, so those attributes and every v4 document stay valid. New ones
  get a fresh id. A note's id is `footnote:<w:id>` or `endnote:<w:id>`. A section whose reference
  has no story (a v4 document, until its `.docx` is imported again) shows nothing and exports the
  part as before.
- **One state per story, one history.** `EditorState` stays one tree. Stories live in the
  envelope (the `word` plugin's context, as comments do), so a story's change is a step of the
  **body's** transaction: `StoryStep(id, step)` applies `step` to the story's tree, has an empty
  position map for the body and inverts to `StoryStep(id, inverted)`, as `CommentStep` does.
  Adding or removing a story is a `StoryStep` too. So undo is one stack across the document, as
  in Word, and inserting a note (reference and story) is one transaction.
- **Editing.** `editor.story(id)` gives an `Editor` over that story: its own `EditorState`
  (selection, stored marks, the tracking and `word` plugins) whose transactions are dispatched
  to the body editor wrapped in `StoryStep`s; an incoming `StoryStep` (undo, another view) is
  applied to it. Commands, tracking and find work unchanged on it.
- **Review.** Accept and reject all reach every story. Comments anchor in the body and notes,
  as Word allows; headers and footers refuse them.

### In place on the page

- The view renders every story occurrence read-only with the blocks renderer. To edit one it
  sets the main view `editable: false`, marks the host `foli-in-story` (the body dimmed), and
  mounts an `EditorView` of `editor.story(id)` in that occurrence, unpaginated (a new `paged:
  false` option: one flow, no pages). Double click or a command enters; Escape, or a press
  outside, leaves and restores the body's selection from its state.
- Other occurrences of the story re-render from the model as it changes.
- Layout never moves the mounted story during a composition. A note split across pages shows
  whole at its reference's page while it is being edited.

### Layout

- **Page regions.** `flow` gets a page's content box from a function of the page number
  (section, first page, even page), not one height per section. A header starts at
  `margins.header`; the text starts at the larger of `margins.top` and the header's bottom (a
  negative top margin is exact, as in Word); the footer mirrors it. Variants: `titlePage` for
  the first page of a section, the document's `evenAndOddHeaders` for even pages; a missing
  variant inherits from the previous section (Word's "link to previous").
- **Notes.** A line holding references carries their note heights: it goes on a page only if it
  and the notes so far fit (with the separator), so a note always starts on its reference's
  page. A note that does not fit is split at a line and continues at the next page's foot under
  the continuation separator; a reference line never moves away from a note's first line.
  Lines are measured for blocks with references. Endnotes are blocks after the body (or the
  section).
- **Columns.** A section has `columns` (`count`, `space`, `widths`, `separator`); a page holds
  **bands** (one per section on it, for continuous sections), a band holds columns, and `flow`
  fills columns where it filled pages. A band above a continuous break is balanced. A
  `columnBreak` ends its column. Blocks go into `.foli-column` elements; positions still map
  through block descriptors.
- **Sections.** Even and odd page sections add Word's blank page; continuous sections with a new
  page setup keep starting a page (Word does the same when the size differs).
- **Fixed point.** Headers can hold `PAGE` and `NUMPAGES`, whose width can change a height. Layout
  repeats at most twice, then keeps the result.

### Fields

- **Markers, as Word has them.** `fieldStart`, `fieldSeparator`, `fieldEnd`: inline atoms holding
  `dirty`, `locked`, `ext`; the instruction is `fieldStart.instruction` (its `w:instrText` runs
  joined, with their run properties in `ext`). The result is ordinary content between separator
  and end, so results stay editable, may span paragraphs (`TOC`) and fields nest. `w:fldSimple`
  reads as the same markers with `simple: true` and is written back as it was.
- **Results.** Shown as stored. `PAGE`, `NUMPAGES` and `SECTIONPAGES` in a story are drawn per page
  by the view and never written to the tree; elsewhere they update on demand like the rest.
- **Update.** `updateFields(editor, { layout, data, now })` in core recomputes `PAGE`, `NUMPAGES`,
  `SECTIONPAGES`, `DATE`, `TIME`, `REF`, `PAGEREF`, `SEQ`, `TOC` and, from `data`, `MERGEFIELD`, in
  one transaction; `layout` (from the view) gives a position's page. Locked fields stay.
  Unknown instructions keep their result, reported. Tracked when tracking is on.
- A field is selected and deleted whole when the selection crosses its markers; Backspace at its
  edge selects it first, as Word does.

### Content controls

- **Inline:** `controlStart` and `controlEnd` atoms, as comment anchors. **Block, row, cell:** a
  `control` attribute on each paragraph, table, row or cell it wraps, keeping blocks flat;
  consecutive blocks with one id are one control. Export regroups them, so a block control whose
  blocks were separated by an edit becomes two.
- **Properties** in the envelope, `controls: Record<string, ControlJSON>`: `kind` (`text`,
  `richText`, `dropDown`, `comboBox`, `date`, `checkbox`, `picture`, `repeating`, `other`), `tag`,
  `alias`, `lock`, `items`, `dateFormat`, `checked`, `placeholder` (showing it, its doc part),
  `binding`, `ext` (`w:sdtPr` and `w:sdtEndPr` verbatim). Data bindings are kept, not evaluated.
- **Editing.** A plugin filters transactions: locked content and locked controls refuse changes,
  a plain text control holds one paragraph's text without formatting. `setControlValue` and
  `controlValues` are the API, by id or tag.

### Other

- **Notes in the text:** `noteReference` (`story`, `customMark`, `ext`) and, inside a note,
  `noteMark` (`w:footnoteRef`). Removing the last reference removes its story. Numbers are
  computed from document order and `w:footnotePr`/`w:endnotePr`, never stored.
- **Document settings:** `settings` in the envelope: `evenAndOddHeaders`, `footnotes` and
  `endnotes` (position, number format, start, restart), from `word/settings.xml`, which is
  otherwise kept verbatim. Sections gain `columns`, `pageNumbers` (`w:pgNumType`) and their own
  note properties.
- **Find:** core's `findAll(doc, query)` over the body and each story; results carry the story id.
- **PDF.** A new `@folijs/pdf`, no browser dependency: `exportPdf(document, { page, resources })`
  drives a page the app supplies (Playwright's or Puppeteer's: `setContent`, `addScriptTag`,
  `evaluate`, `pdf`), loads the read-only renderer's bundle, updates page fields, and prints with
  the print CSS already used by the editor. In a browser, the editor's `print()` does the same
  with the user's dialog. It is Chromium's PDF: fonts must be available to that page.

### Format

Schema v5 adds `stories`, `controls`, `settings`, the new nodes and section attributes. The
v4 → v5 migration changes the version only; what is opaque stays so until the `.docx` is imported
again. 0.5.0 cannot read v5 documents, which the 0.6.0 changeset says.

## Options rejected

- **Stories as extra children of `doc`:** one tree and one history for free, but every use of the
  doc's children and positions would have to skip them, and a story has no place in the flat
  block list.
- **An independent `Editor` and history per story:** undo would be per story, unlike Word, and
  inserting a note would be two undo steps.
- **An editable island in the live host:** select-all and arrows escape it (the spike).
- **Fields and controls as container nodes:** a field's result can span paragraphs and cross
  other structure; markers are what the file has and keep the round trip exact.
- **A PDF writer of our own:** a second layout and font embedding; the browser already prints
  the pages the editor measured.

## Consequences

- `flow` and the two renderers gain per-page boxes, bands and columns, and note heights: Phase
  11's main layout risk. Incremental reflow must invalidate pages when a story's height changes.
- Inline markers join the ones the commands already step over (bookmarks, comment anchors);
  each new one needs the same treatment in Backspace, Delete, arrows and clipboard.
- A slice pasted with half a field or control must be repaired (markers without partners are
  dropped, their content kept).
- `exportPdf` depends on the app's headless browser and its fonts.
