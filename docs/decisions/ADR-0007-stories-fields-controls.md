# ADR-0007: Stories, fields and content controls

- **Status:** Accepted when merged, task 11.1 (2026-11-18): the owner asked that day for Phase 11
  to be built task by task, each task merged after an agent's review, so this record is accepted
  by that review and not by the owner reading it. A change of mind costs what has been built on
  it by then.
- **Context:** schema v4 keeps a section's headers and footers as relationship ids into the
  original package and notes as parts of it: exported verbatim, never shown. A note reference,
  a simple field, a content control are `opaqueInline` or `opaqueBlock` nodes; a complex field's
  structure (`w:fldChar`, `w:instrText`) is opaque with its result as editable text. Pages have
  one column. Phase 11 makes all of this visible and editable, as Word models it, and adds PDF.

## Question

How does Foli model, lay out and edit content that lives outside the body (headers, footers,
notes), Word's fields and content controls, and columns, keeping one editable host per page
flow, one undo history, tracked changes and a lossless DOCX round trip?

## Spike (`spikes/two-page/stories.html`, `story-view.html`, `e2e/stories.spec.ts`)

**Editing in place, a plain element.** A header repeated on two pages and a footnote at its
reference's page foot. To edit a story the host's `contenteditable` is turned off and the
story's element turned on, so the story is the only editing host; Escape, or a press outside it,
reverses that. Passing twice in Chromium, Firefox and WebKit (Playwright, Windows), 2026-11-18:

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
composition in a note is seen composing, is not moved meanwhile, and the note changes page once
committed.

An **editable island** (the story editable inside the still-editable host) was recorded for
comparison: typing reaches the story, but Ctrl+A selects the whole host (151, 182 and 136
characters against the header's 12) and ArrowDown leaves it in every engine.

**The real `EditorView`.** The packages as they are, a second view mounted on the first page of a
read-only one, inside a `contenteditable="false"` wrapper, in three engines:

- Left alone, the main view's mutation observer sees the wrapper, and the re-render its read-back
  causes removes it at once.
- With the main view's observer stopped and the wrapper stopping the story's events from reaching
  the host (a stand-in for the guards decided below): typing, Enter and Backspace reach the story
  only, the body and its selection do not change, and nothing is discarded. Recorded, not
  asserted: a copy event carries the story's text in Chromium and WebKit (Firefox ignores a
  synthetic event's `clipboardData`).
- A render of the main view while the story is mounted still removes the wrapper, so mounting
  **does not work yet**: `place` has to change, in 11.7.

The two editors there are independent: no `StoryStep`, no `paged: false`. Not in the spike either:
a note split across pages, and tables or pictures in a story.

## Decision

### Stories

- **A story** is a content tree outside the body: `stories: Record<string, StoryJSON>` in the
  envelope, `StoryJSON = { kind: "header" | "footer" | "footnote" | "endnote", noteType?,
content, ext? }`. `content` is a `doc` of the body's blocks. `noteType` is Word's `w:type` of a
  note: `separator`, `continuationSeparator` and `continuationNotice` have no reference, are not
  numbered, are never removed as unreferenced, and are what layout draws above the notes.
- **What a story may hold.** No section breaks anywhere; no note references and no comments in
  any story (Word 16 drops a comment anchored in a note when it saves: 11.4 checked it); no page
  or column breaks in a note. `parseDocument` refuses them; **import never
  fails on them**: such content stays opaque and is reported, as a table it cannot hold does.
- **Ids.** A header's or footer's id is its relationship id, as `section.headers` and
  `section.footers` already hold, so those attributes and every v4 document stay valid. New ones
  get a fresh id. A note's id is `footnote:<w:id>` or `endnote:<w:id>`. A section whose reference
  has no story (a v4 document, until its `.docx` is imported again) shows nothing and exports the
  part as before.
- **`StoryStep(id, before, after)`, one history.** Stories live in the envelope, so a story's
  change is a step of the **body's** transaction. The step holds the story's trees before and
  after (immutable nodes sharing structure; `null` for no story): it inverts by swapping them and
  has an empty position map for the body (`Step.invert` receives the body, which is why it cannot
  compute an inverse from an inner step). Undo is one stack across the document, as in Word, and
  inserting a note (reference and story) is one transaction. Built in 11.7: what the step holds is
  a `Story` (the tree with its `kind`, `noteType` and `ext`) and the story's selection before and
  after, which is how undo gives the selection back.
- **A stale step fails its whole event.** `Step.apply` sees only the body, so history's
  `applyStored` checks `StoryStep`s and `EnvelopeStep`s against the envelope as the transaction has
  left it: where the story or key no longer equals `before`, the event is not applied at all and
  is dropped, never half applied (a reference gone, its story kept). Every change to a story goes
  through these steps, so only a change made with `addToHistory: false` can cause this.
- **`EnvelopeStep(key, before, after)`**, the same idea for what undo must take back in the
  envelope: the last section (`section`), `settings` and the controls' properties (`controls`, the whole record: 11.9). So undoing an
  added header leaves no reference to a story that has gone. `withEnvelope` stays for what undo
  leaves as it is (numbering definitions, styles and resources).
- **Grouping.** History groups story typing by the rules body typing has: the story's own
  transaction decides adjacency, passed on the body transaction; consecutive `StoryStep`s of a
  story in one group merge (first `before`, last `after`), so a word is one undo step and does
  not use up the depth.
- **Editing.** `editor.story(id)` gives an `Editor` over the story: its own `EditorState`
  (selection, stored marks, the tracking and `word` plugins, no history). **The body goes first:**
  its `dispatch` computes the next story state without keeping it, sends the body editor a
  `StoryStep`, and adopts that state only if the body then holds its tree; a transaction the body
  refuses leaves the story as it was. `CommentStep`s and `EnvelopeStep`s move to the body
  transaction. A story's `withEnvelope` is **hoisted as a patch** of `numbering`, `styles` and
  `resources` only, applied to the body's current envelope (the story's copy of the rest may be
  stale), and every change to those reaches the story states. Undo and redo run on the body
  editor. A `StoryStep` arriving from the body (undo, another view) replaces the story state's
  document and takes the selection the step holds, clamped to the tree. Built in 11.7: a story's
  state is made again from the body's word context and tracking state whenever they change, so it
  shares the body's resolver instead of patching a copy; a story's editor also refuses by itself
  what a story may not hold (`storyRules`, run on every change of its tree).
- **The view follows stories apart from `doc`.** A `StoryStep` leaves the body's `doc` as it is, so
  the view compares the stories too, redraws the occurrences of those that changed and reflows only
  if a height changed. The renderer's context depends on `styles`, `numbering`, `defaults`, `theme`
  and `resources`, not on the envelope object, so typing in a story keeps it and the layout cache.
- **Across trees.** Revision and bookmark ids are allocated over the body and every story. A story
  copied by unlinking a section leaves its bookmarks behind: their names are the document's once.
- **Review.** Accept and reject all reach every story. Comments anchor in the body only.
- **Notes and the clipboard.** Deleting the last reference removes the story in the same
  transaction; undo restores both. A slice holding a reference carries its note's content, so cut
  and paste keep the note, and every paste makes a new story with a fresh id (a copy never gives
  two references to one note). Without Foli's clipboard format the reference is dropped.

### In place on the page

- Every occurrence of a story is rendered read-only by the blocks renderer. To edit one, the main
  view becomes read-only and marks the host `foli-in-story` (the body dimmed); an `EditorView` of
  `editor.story(id)`, unpaginated (a new `paged: false` option), is mounted in that occurrence
  inside a `contenteditable="false"` wrapper. Double click or a command enters; Escape, or a press
  outside, leaves and restores the body's selection from its state. A press outside means on the
  host: the toolbar keeps the story open and its commands go to the story's editor
  (`Editor.storyView` says which is open). A press on a page's header or footer places no caret in
  the body, and the second press of a double click opens the story (the click event comes too
  late in Firefox, where the first press could scroll the page from under the pointer).
- **Keeping the main view off it:** while a story is mounted the main view's observer is stopped
  (it is read-only: there is no input to read back); its handlers ignore events whose target is in
  the wrapper, which is left to bubble (a resize's drag listens on the document, so stopping
  `mousemove` there would break it); `onSelectionChange` ignores selections inside it; `place`
  keeps the wrapper.
- Other occurrences re-render from the model. Layout never moves the mounted story during a
  composition. A note split across pages shows whole at its reference's page while it is edited.
  When the page stops showing the story (a different first page turned on, the section unlinked)
  the page's own story opens in its place; when reflow takes the page away, the story moves with
  the focus to another occurrence.
- Ctrl+Home and Ctrl+End on pages with headers go by the model: Chromium stopped the caret before
  the non-editable footer of the last page (11.7).

### Layout

- **Page regions.** `flow` gets a page's content box from a function of the page (section, first
  page, odd or even), not one height per section. A header starts at `margins.header`; the text
  starts at the larger of `margins.top` and the header's bottom (a negative top margin is exact, as
  in Word); the footer mirrors it. A page shared by sections has the box of the first one on it.
  Measured in 11.7 against Word's PDFs (03's letterhead): a story's height runs to its last block
  and that block's space after, floating pictures not counted; a line is as tall as its runs and
  the paragraph mark, not the paragraph style's font (`markFormat` sets the block's own line); a
  line holding only inline pictures ends at their foot, with no room below for text.
- **Which header.** `titlePage` gives the first page of a section its first-page variant.
  `evenAndOddHeaders` picks by the page's **displayed number** (`w:pgNumType` restarts count), not
  its place in the file. A missing variant inherits from the previous section. A page holding
  several sections takes its header and footer from the first section on it. Word's PDFs of 01, 03,
  04, 05 and 08 agree with these (11.7, 08 scoring 1.000 on all five pages), and add one rule:
  **the blank page Word inserts before an even or odd page section has no header or footer.** With
  a restart (`w:pgNumType w:start`) such a section gets no blank page at all, and its first number
  is the start or, when that is the wrong kind, the next (16 cases on Word's PDFs).
- **Notes.** A line holding a reference goes on a page only if it, the separator and the note's
  **first line** fit; the rest of the note fills the space left at the foot and continues on the
  next page under the continuation separator, so a note taller than a page works. What carries
  over is placed first on the next page and leaves room for at least one line of text; what still
  does not fit carries on, so both advance. A note's use of a page comes from the lines that end
  up on it: when widow, orphan or keep rules take a line back, its notes go with it and the page
  is measured again. A line forced onto an empty page because nothing else can take it keeps its
  note's first line, and the page grows as for any line taller than a page. `FlowState` gains the
  notes' use of the page and what carries over (`sameState` compares them, or incremental reflow
  would stop too early). Lines are measured for blocks with references. Endnotes are blocks after
  the body (or the section). In a section with columns a footnote sits at the foot of its
  reference's **column**.
- **Columns.** A section has `columns` (`count`, `space`, `widths`, `separator`); a page holds
  **bands** (one per section on it, for continuous sections), a band holds columns, and `flow`
  fills columns where it filled pages. A band above a continuous break is balanced. A
  `columnBreak` ends its column. Blocks go into `.foli-column` elements; positions still map
  through block descriptors.
- **Sections.** Even and odd page sections add Word's blank page, of the next section's size;
  continuous sections with a new page setup keep starting a page. Measured in 11.6 against Word's
  PDFs: the paragraph ending a section takes no room when empty; the next band starts after the
  tallest column and the space after it; between two paragraphs goes the larger of the space
  after and the space before, not their sum. A changed page setup is tracked as `w:sectPrChange`
  (`SectionJSON.change`), the recorded setup spelling out its values, or Word sees no change.
- **Fixed point.** Headers can hold `PAGE` and `NUMPAGES`, whose width can change a height. `PAGE`
  is known as each page is flowed; the page counts come from the flow before, and the flow is
  repeated at most twice when they change a page's text height, then the result is kept.

### Fields

- **Markers, as Word has them.** Inline atoms `fieldStart` (`dirty`, `locked`, `simple`, `ext`),
  `fieldCode` (one `w:instrText` run's text), `fieldSeparator` (optional, as in Word), `fieldEnd`.
  The **code range** runs from the start to the field's separator or, without one, to its end
  (partners found by nesting depth), so **a field nested in a code** (`{ IF { MERGEFIELD x } = … }`)
  stays a field, and the instruction is read from the range. Everything in it, a nested field's
  result too, is hidden: not drawn unless codes are shown, stepped over by the caret as one unit,
  not searched. The result is ordinary content between separator and end: editable, it may span
  paragraphs (`TOC`), and fields nest.
  `w:fldSimple` reads as the same markers with `simple: true` and is written back as it was.
- **Tracked as runs.** `w:fldChar` and `w:instrText` sit in runs, inside `w:ins` and `w:del`, so
  these atoms carry revision marks like text (they do not join the markers tracking skips).
- **Results.** Shown as stored. `PAGE`, `NUMPAGES` and `SECTIONPAGES` in a story are drawn per page
  by the view and never written to the tree; elsewhere they update on demand like the rest. While
  its story is open for editing they show the stored result (11.7: the open view's text is the
  model's), and the other occurrences go on showing their page's.
- **Update.** `updateFields(editor, { layout, data, now })` in core recomputes `PAGE`, `NUMPAGES`,
  `SECTIONPAGES`, `DATE`, `TIME`, `REF`, `PAGEREF`, `SEQ`, `TOC` and, from `data`, `MERGEFIELD`, in
  one transaction; `layout` (from the view) gives a position's page. Locked fields stay.
  Unknown instructions keep their result, reported. Tracked when tracking is on.
- A field is selected and deleted whole when the selection crosses its markers; Backspace at its
  edge selects it first, as Word does.
- **Built in 11.8**, where the above left room or turned out otherwise:
  - `updateFields(editor, { layout, data, now, only })` returns what it did and what it left
    (`updated`, `unchanged`, `rebuilt`, `skipped` with a reason). `layout` is `{ pages, pageAt(pos)
    }`, a position's displayed number, its section's page count and number format. Core makes one
    pass; `view.updateFields` makes a second, joined to the same undo step, for the page numbers a
    rebuilt table of contents moved.
  - Results are worked out in stages (fields in codes, values and `SEQ`, `REF` and `PAGEREF`, `TOC`)
    so what depends on another result sees it. A table of contents whose lines and styles are
    already right is left alone: its paragraphs keep their ids, and updating an untouched document
    changes nothing, the check against Word on the corpus.
  - A missing bookmark keeps the old result and is reported. Word writes "Error! Reference source
    not found." into the document; a failed update should not cost the reader the text.
  - With codes shown, a field's closing brace is drawn at its separator, so a table of contents
    reads `{ TOC … }` on one line; paragraphs wholly inside a hidden result take no room. The
    paragraph holding the end stays, an empty line. Codes are not editable there.
  - Browsers cannot tell the two sides of a marker apart: the selection rules treat positions with
    only markers between them as one place, or a range would give a field up when the browser
    reads its end back one position short. Left and Right start past the markers next to the caret
    (WebKit spent a key press on each empty element).
  - Find (11.11) has to skip code ranges: `fieldsIn` gives them.

### Content controls

- **Inline:** `controlStart` and `controlEnd` atoms, as comment anchors (they stand between runs).
- **Block, row, cell:** a `controls` attribute on each paragraph, table, opaque block, row or
  cell, the ids of the controls around it, **outermost first**, keeping blocks flat and allowing
  nesting (a repeating section around its items). Consecutive blocks sharing an id at a level are
  one control. A table may follow a table when their `controls` differ: each is in a control of
  its own in the file, so Word does not merge them.
- **Ids** are Foli's keys, made on import whether or not the file has `w:id` (kept in `ext`). When
  an edit separates a control's blocks, export gives the later part a fresh `w:id`.
- **Empty** block controls have no block to carry them and stay `opaqueBlock`, reported.
- **Properties** in the envelope, `controls: Record<string, ControlJSON>`: `kind` (`text`,
  `richText`, `dropDown`, `comboBox`, `date`, `checkbox`, `picture`, `repeating`,
  `repeatingItem`, `other`), `tag`, `alias`, `lock`, `items`, `dateFormat`, `checked`,
  `placeholder` (showing it, its doc part), `binding`, `ext` (`w:sdtPr` and `w:sdtEndPr` verbatim).
  Data bindings are kept, not evaluated.
- **Editing.** A plugin filters transactions: locked content and locked controls refuse changes, a
  plain text control holds one paragraph's text without formatting. `setControlValue` and
  `controlValues` are the API, by id or tag.
- **Built in 11.9**, Word 16.0.20527's behaviour read through its object model and saved files
  (`scripts/corpus/control-roundtrip.mjs` has it read what Foli writes):
  - **Locks.** `sdtLocked`: the content is edited, the control cannot be deleted, alone or in a
    range over it. `contentLocked`: no text or formatting change, but the whole control can be
    deleted. `sdtContentLocked`: both. Properties and the locks themselves stay changeable. The
    filter compares what a transaction leaves with what was there (undo passes), so it does not
    depend on how the change came. Tracked changes in locked content can be accepted, not rejected.
  - **Placeholder.** Typing replaces it and removes `w:showingPlcHdr`; the text loses the
    `PlaceholderText` style. While tracking Word records the insertion only, not the placeholder's
    deletion. Emptying a control (by typing or code) brings back its `w:docPart`'s text, not what
    the file showed; Word knows `DefaultPlaceholder_*` without a glossary, and shows five spaces for
    an entry it cannot find. `placeholder.text` holds the glossary's text. An empty control in a
    file stays empty until edited. Backspace and Delete do nothing on a placeholder or at a
    control's inner edges; from outside they select its content.
  - **What a kind takes.** Plain text: one paragraph, no Enter, no line break unless `w:multiLine`;
    formatting part of it formats all of it. Drop-down and check box: no typing. Combo box and date:
    typing. No paragraph mark inside an inline control. Typed text that is not the picked date drops
    `w:fullDate` (Word also re-reads a date typed; Foli does not parse them).
  - **Check box.** `w14:checked` and the glyph are separate: Word does not re-sync them on opening.
    Toggling while tracking is an insertion and a deletion of the glyph.
  - **Lists.** A choice writes the shown text only; Word writes no `w:lastValue` and drops one it
    finds, so an old one is left as it is.
  - **Data binding.** On opening Word replaces the content with the bound node's value, even with
    an unknown `storeItemID` when the path resolves; a path that does not keeps the content. Bindings
    stay unevaluated, so editing one here would be lost in Word without notice: **a bound control's
    content is read-only**, in the editor and through `setControlValue`.
  - **Ids.** Word gives a control with no `w:id`, or a repeated one, an id of its own: a copy made
    here drops it. A copied repeating item holds its source's content, as Word's does.
  - **The caret.** The two sides of a marker are one place to a browser: the view treats them so
    when reading the selection, and Left and Right step across each edge, as Word's caret does.
  - Frames and titles are the view's own elements on the page, `contenteditable="false"`; the lists
    and the date picker (a native date input) are outside the editing host.

### Other

- **Notes in the text:** `noteReference` (`story`, `customMark`, `attributes`) and, inside a note,
  `noteMark` (`w:footnoteRef`), both run content. Numbers come from document order and
  `w:footnotePr`/`w:endnotePr`, never stored.
- **Document settings:** `settings` in the envelope: `evenAndOddHeaders`, `footnotes` and
  `endnotes` (position, number format, start, restart), from `word/settings.xml`, which is
  otherwise kept verbatim. Sections gain `columns`, `pageNumbers` (`w:pgNumType`) and their own
  note properties.
- **Find:** core's `findAll(doc, query)` over the body and each story; results carry the story id.
- **Slices with half a field or control** are repaired on paste (`fitPaste`, built in 11.8):
  markers without partners are dropped, a field that lost its end losing its code too, their
  content kept.
- **PDF.** A new `@folijs/pdf`, no browser dependency: `exportPdf(document, { page, resources })`
  drives a page the app supplies (Playwright's or Puppeteer's: `setContent`, `addScriptTag`,
  `evaluate`, `pdf`), loads the read-only renderer's bundle, updates page fields, and prints with
  the print CSS already used by the editor. In a browser, the editor's `print()` does the same
  with the user's dialog. It is Chromium's PDF: fonts must be available to that page.

### Format

Schema v5 adds `stories`, `controls`, `settings`, the new nodes and attributes. The v4 → v5
migration changes the version only; what is opaque stays so until the `.docx` is imported again.
0.5.0 cannot read v5 documents, which the 0.6.0 changeset says.

## Options rejected

- **Stories as extra children of `doc`:** one tree and one history for free, but every use of the
  doc's children and positions would have to skip them, and a story has no place in the flat
  block list.
- **An independent `Editor` and history per story:** undo would be per story, unlike Word, and
  inserting a note would be two undo steps.
- **`StoryStep` wrapping the inner step:** its inverse needs the story's tree, which `Step.invert`
  does not get, and a stale inner step would apply to the wrong content.
- **An editable island in the live host:** select-all and arrows escape it (the spike).
- **Fields and controls as container nodes:** a field's result can span paragraphs and cross
  other structure; markers are what the file has and keep the round trip exact.
- **A PDF writer of our own:** a second layout and font embedding; the browser already prints
  the pages the editor measured.

## Consequences

- `flow` and the two renderers gain per-page boxes, bands and columns, and note use: Phase 11's
  main layout risk. Incremental reflow must invalidate pages when a story's height changes.
- Inline markers join the ones the commands already step over; each new one needs the same
  treatment in Backspace, Delete, arrows and clipboard.
- A story's whole tree is the unit of its undo: cheap with shared structure, but a change made to
  a story outside history (none exists today) would block older undo steps of that story.
- `exportPdf` depends on the app's headless browser and its fonts.
- Word's rules above come from the format as documented and the corpus; those not yet checked
  against Word are checked when their task builds them.
