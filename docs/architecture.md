# Architecture

Foli is an open-source document-editing engine for the web: its own document model,
transactions, view and layout, designed around native pagination, with first-class React
integration. Decision record: [ADR-0002](decisions/ADR-0002-own-editing-engine.md).

This document describes **what exists** and **what is decided**. Planned parts are marked.

## Subsystems

```
┌──────────────────────────────────────────────────────────────┐
│ @folijs/react   components · hooks · toolbar                   │
└──────────────────────────────┬───────────────────────────────┘
                               │ mounts, subscribes
┌──────────────────────────────▼───────────────────────────────┐
│ @folijs/view    DOM rendering · input · selection · clipboard  │
│               layout & pagination                            │
└──────────────────────────────┬───────────────────────────────┘
                               │ dispatches transactions, renders state
┌──────────────────────────────▼───────────────────────────────┐
│ @folijs/core    schema · nodes · positions · steps · mapping   │
│               state · history · commands        (no DOM)     │
└──────────────────────────────▲───────────────────────────────┘
                               │ same JSON format
┌──────────────────────────────┴───────────────────────────────┐
│ Rust (later)  DOCX import/export · batch processing · WASM   │
│               never on the keystroke path                    │
└──────────────────────────────────────────────────────────────┘
```

| Subsystem           | Responsibility                                                                 | Status                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document model      | Schema, immutable tree, marks, positions, JSON, validation                     | ✅ (Phase 2); Word's model (schema v3, 8.3–8.7) current as schema v5 (tables and pictures 10.3, stories, fields and controls 11.3); v1–v4 read and migrated                                                                        |
| Editing engine      | Steps, position mapping, selection, state, history, commands                   | ✅ headless (Phase 3)                                                                                                                                                                                                              |
| View                | Render state to DOM, DOM ↔ model mapping, `beforeinput`, IME, clipboard, focus | ✅ (G3 provisional; manual IME/SR checks open)                                                                                                                                                                                     |
| Layout              | Measurement, line breaking, page flow, fragments, incremental reflow, print    | ✅ (Phase 5); sections with their own page setups (8.7d4), tables and floats (Phase 10), columns, headers, footers and notes (Phase 11); inside `@folijs/view` until the seam is proven                                            |
| React integration   | Components, hooks, toolbar                                                     | Hooks, provider, canvas, `FoliEditor` ✅ (6.1); toolbar ✅ (6.2); comments pane (9.7); Phase 11's menus and `FoliNavigation` (11.6–11.11)                                                                                          |
| Document processing | DOCX import/export with lossless round trip (`@folijs/docx`)                   | Package and XML reading ✅ (8.2), import to v3 ✅ (8.4), lossless export ✅ (8.5) ([ADR-0005](decisions/ADR-0005-word-compatible-model.md)); tables, pictures (Phase 10), stories, fields, controls, sections, settings (Phase 11) |
| PDF                 | A document printed to PDF from Foli's own pages (`@folijs/pdf`)                | ✅ (11.12, [ADR-0007](decisions/ADR-0007-stories-fields-controls.md)): Chromium's PDF through the app's headless page                                                                                                              |

## Editing data flow (target design)

```
DOM event (beforeinput / keydown / composition / paste)
  → view translates to a command
  → command builds a Transaction (steps + selection + metadata)
  → core applies it → new immutable EditorState
  → history records inverted steps (unless addToHistory: false)
  → view.update(state): re-render changed nodes only
  → layout reflows from the first changed block → page fragments
  → selection written back to the DOM
  → subscribers (React, onChange) notified
```

The DOM is never parsed as the source of truth. The one exception is IME composition and
Android input, where the browser must mutate the DOM; the view reads those changes back and
converts them into steps immediately.

## Editing engine (`@folijs/core`)

Implemented headless in Phase 3 (`packages/core/src/transform/`, `packages/core/src/state/`).
The design follows prosemirror-transform, -state, -history and -commands (MIT); the code is
Foli's own (see `THIRD_PARTY_NOTICES.md`).

- **Steps** change the document atomically and are invertible: `ReplaceStep`,
  `ReplaceAroundStep`, `AddMarkStep`, `RemoveMarkStep` and `NodeMarkupStep`. `NodeMarkupStep`
  handles type and attribute changes that keep inner positions; it replaces the planned
  `AttrStep`. `ReplaceAroundStep` replaces a range but keeps a gap of content inside it (moved
  into the new slice, not deleted and re-inserted), so wrapping blocks in a list and lifting
  them out map positions inside the moved blocks through. Structure steps (split, join, wrap,
  lift) fail instead of deleting content that, after mapping, now sits in their range. A
  failing step returns a failed `StepResult`; `Transform.step` throws `TransformError` and
  leaves the transform unchanged.
- **Mapping**: each step has a `StepMap` (one changed range, or two for `ReplaceAroundStep`).
  `Mapping` chains them, with association bias, deletion detection, and mirrored maps that
  recover positions inside re-inserted content.
- **Transform helpers**: replace/delete/insert/insertText, addMark/removeMark (exactly
  invertible), setBlockType, setNodeMarkup, and structure:
  - `split(pos, depth, typesAfter)` splits a node and `depth - 1` ancestors (a list item);
    `join(pos, depth)` joins adjacent nodes (two lists, two paragraphs), never a leaf.
  - `wrap(range, wrappers)` and `lift(range, target)` move a range of sibling blocks into
    wrappers or out of their ancestors, splitting the ancestors left around them.
  - Checks before acting: `findWrapping` (the wrappers a node type needs, e.g. list then list
    item), `liftTarget`, `canSplit`, `canJoin`; `ResolvedPos.blockRange` gives the range.
- **Schema specs** for structure: node `selectable`, mark `inclusive` (a link is not: typing
  at its end continues as plain text); node `atom` is declared for the view (7.3), unused yet. `ContentMatch.findWrapping` and
  `defaultType` answer which nodes fit where.
- **State**: an immutable `EditorState` holds the doc, selection, stored marks and plugin fields.
  A `Transaction` adds selection tracking, stored marks and metadata (`addToHistory`, time).
  Selections are `TextSelection`, `NodeSelection` (one selectable node; in schema v3 an opaque
  block such as a table) and `AllSelection`. Deleting a node-selected block that its parent
  cannot lose (its only child) leaves an empty paragraph where the parent takes one; otherwise
  the delete does not apply. Typing over a node-selected block replaces it with a paragraph of
  the text; Enter adds a paragraph after it.
- **Plugins** (the extension API, frozen for 1.x by ADR-0008; every built-in feature uses it):
  state fields, `filterTransaction`, `appendTransaction`, `keymap`, `commands` (named command
  factories the editor adds to `editor.commands`, typed by augmenting `FoliCommands`; a name
  taken twice throws in `createEditor`). Order: the user's plugins, the extensions' plugins, a
  `viewKeys` marker (`@folijs/core/internal`) where the view runs its own keys, then the
  built-ins (history, the Word context, tracking, fields, controls, comments, notes, tables,
  lists, the base keymap).
- **History**: undo/redo of inverted steps.
  - Changes are grouped by time (500 ms) and adjacency; consecutive typing collapses into one step.
  - Formatting and block-type changes get their own undo steps.
  - The selection is restored on undo.
  - Changes with `addToHistory: false` are rebased into the stored events.
    - Each rebased step is applied to a running copy of the document and dropped if it no longer
      applies. A step whose target node was deleted is dropped.
    - Positions keep the side of each changed range of the original step they were on (two
      ranges for a gap-replace), so a deletion right next to re-inserted content cannot move
      them across it.
    - Property tests cover recorded edits interleaved with unrecorded marker insertions and
      deletions and with plugin reactions, and recorded wrap, lift, split and join on nested
      blocks (blockquotes, lists) around unrecorded edits. Arbitrary unrecorded edits that overlap recorded
      content have no exact oracle; there, undo is best-effort but always valid and reversible.
  - Changes a plugin appends join the event of the transaction they react to.
  - A plugin's reaction to an undo or redo joins the reverse event, so it cannot trap the history,
    and the opposite stack is rebased past it. A reaction is recorded this way even when the plugin
    marks it `addToHistory: false`.
  - An undo or redo whose steps no longer apply (their effect was already reverted outside
    history) is discarded instead of leaving an empty reverse event.
  - Undo/redo replays mark steps through addMark/removeMark, so redo is exact even when marks
    were changed outside history.
- **Commands** have the shape `(state, dispatch?) => boolean`:
  - Editing: insertText, deleteBackward/Forward (by grapheme or word), deleteSelection,
    joinBackward/Forward, insertHardBreak, insertPageBreak (Mod-Enter).
  - splitBlock: Enter, formatting carrying over (on a v3 paragraph as Word splits it, below).
  - Formatting and selection: toggleMark, setBlockType, selectAll, undo, redo, plus `isMarkActive`.
  - `baseKeymap()` binds them to key names (`Mod-b`, `Enter`…).
  - Formatting (`state/format.ts`): `setAlign`, `setTextColor` / `setHighlight` (lowercase
    `#rrggbb`, else not applied) and `alignAt` / `colorAt` for the toolbar, Word's formatting
    (`state/wordformat.ts`, below).
  - Opaque blocks (a table) have no caret stop: `arrowAcrossLeaf(dir, from)` selects one from a
    caret at the edge of the paragraph beside it (Left/Right in `baseKeymap`; Up/Down when the
    view finds the caret on the block's first or last line, from the caret's and the lines'
    client rects) and leaves a selected one to the text beside it. Backspace and Delete next to
    one select it first; joining paragraphs never deletes it.
  - Links (7.6, `state/links.ts`): `setLink`, `removeLink`, `insertLink`, `linkAt`, with
    `normalizeHref` before `isSafeHref` at every entry (command, dialog, pasted URL); a link mark
    from `toggleMark` or a paste from elsewhere must be safe as it is (`isSafeLink`: a safe href,
    or a bookmark of the document without one). A caret at a link's edge edits that link. Mod-K is `openLinkEditor`: core has no UI, so it
    dispatches an empty transaction with `linkEditorRequest` metadata, and `FoliToolbar`
    (subscribed to the editor) opens its dialog. The link button runs the same command, so both
    paths meet.
  - Lists (`state/lists.ts`): Word's numbering (`wordformat.ts`, below) under the list command
    names: `toggleList(kind)`, `wrapInList(kind)`, `splitListItem` (Enter in an empty list
    paragraph), `sinkListItem` (Tab), `liftListItem` (Shift+Tab), `liftListItemAtStart`
    (Backspace at a list paragraph's start); `listKeymap()` binds them before `baseKeymap()`.
- **Headless editor**: `createEditor({ document })` returns `commands.*`, `run`, `can`,
  `handleKey`, `select`, `getDocument`, `setDocument` and `subscribe`.
- **Editing schema v3** (8.7a, `state/word.ts`; the only one since 8.7d2, older documents
  migrated when loaded): the editor keeps the document's envelope (styles, numbering, defaults, theme, sections) in a plugin state
  field with its `Resolver`, and the generic commands consult it (`wordContext(state)`).
  - Enter: the paragraph mark carries the section break, its tracked change and the paragraph's
    own attributes (`w14:paraId`), so a split leaves them on the second paragraph, which keeps
    the original mark; the first gets a copy of the properties without them. At the end of a
    paragraph whose style names another `next` style, the second paragraph is in that style
    without the direct formatting.
  - The toggles (bold, italic, underline, strike, double strike, caps, small caps, hidden) act
    on the resolved formatting: on a range, text that does not all show the property gets it,
    else none does; per text node a direct mark is written only where the styles do not
    already give the wanted value (`value: false` turns off a style's bold; `underline` `none`
    a character style's underline), and bold's and italic's complex-script twin is kept.
  - Joins (Backspace at a paragraph's start, Delete at its end) and deletions across paragraphs
    keep the last paragraph's mark: the merged paragraph takes its section break, tracked
    change and own attributes (`state/mark.ts`), so deleting a paragraph's mark merges its
    section into the next, as in Word.
  - Backspace and Delete step over the zero-width markers (bookmarks, comment ranges, comment
    reference marks), which stay, and select opaque content (a table kept verbatim) instead
    of deleting it; the next key deletes the selection. A word deletion stops at the inline node
    before or after it (a tab, a break, a marker).
  - Fields (`state/fields.ts`, ADR-0007) are markers paired by depth over a tree (`fieldsIn`,
    cached per tree). A plugin keeps the selection to Word's rules after every transaction: a
    caret never rests in what is hidden or at a result's very edge, a range with one end inside a
    field takes all of it, and Backspace or Delete at a field's edge selects it first. Two positions with only markers
    between them count as one place, as a browser reads them. `state/fieldupdate.ts` works results
    out (`updateFields`) in stages, so what a result depends on comes first: fields inside codes,
    values and `SEQ`, `REF` and `PAGEREF`, then tables of contents, which are built again only
    when their lines or styles differ. The view passes its pages (`FieldLayout`); the page numbers
    a rebuilt table moves are updated by a second pass joined to the same undo step
    (`joinHistory`). Renderers ask `fieldDisplay` what to hide: hidden nodes stay in the editing
    DOM inside `display: none`, as deleted text does in the simple views, so positions and the
    read-back are unchanged.
  - Content controls (`state/controls.ts`, ADR-0007): `controlsIn` pairs the inline markers and
    joins the blocks, rows and cells listing an id, cached per tree. One plugin holds their rules:
    its filter compares each control's content before and after a transaction (locks, what a kind
    holds; undo passes), so no command needs to know them; `appendTransaction` leaves or restores
    placeholders in the same undo step, keeps a text control's formatting even and settles the
    selection (a placeholder selected whole, a range over an edge taking the control); a keymap gives
    Backspace, Delete, Enter and Space Word's meaning at their edges. Properties change through
    `EnvelopeStep("controls")`. In the view `word/controls.ts` draws frames on the pages after each
    render, its own marked elements the read-back and the observer ignore, and opens the lists and
    date picker outside the host; the two sides of a marker count as one place when the selection
    is read.
  - Typed, inserted and pasted text never takes a tracked-change mark (`insertion`, `deletion`,
    `formatChange`) from the text around it (`typedMarks`; changes are recorded from Phase 9).

Known limits:
- No general slice fitting: paste joins open content, replaces an empty textblock with whole
  blocks, and inserts whole blocks at the caret only when an opaque block is at an end of the
  pasted content; see Clipboard below.
- Each unrecorded change (and each plugin reaction to undo/redo) rebases the stored history.
  This costs O(n²) in the number of stored steps (not events), and every step is re-applied to the
  document, which also scales with document size.
  - Typing runs collapse to one step, and depth is capped at 100 events.
  - Formatting across many paragraphs is the worst case: `addMark` makes one step per paragraph.
    One reviewer measurement, select-all bold on 4,000 paragraphs:
    - the bold itself took about 0.6 s;
    - a later unrecorded insert took about 0.7 s;
    - the undo took about 0.5 s.

  Batch per-paragraph mark steps before documents get that large.
- Selections snap out of surrogate pairs but not to full grapheme clusters; the view shows them
  at cluster boundaries (Phase 4.4).
- `setBlockType` adds one `NodeMarkupBatchStep` for all changed blocks, which rebuilds the
  document once: linear in the number of blocks (H1 over 4,000 selected paragraphs takes about
  2-3 ms, was about 1.4 s with a step per block; [benchmarks.md](benchmarks.md)). If any block
  cannot take the new markup the whole step fails, and so does its undo after a rebase that
  makes one block invalid (per-block steps dropped only that block). Command dry runs
  (`editor.can`) still build the whole transaction, so nothing that runs per transaction uses
  them (the toolbar uses cheap checks).
- Plugins, `Transaction` metadata and mapping internals are exported but not yet a stable API.

Find and navigation (11.11, `state/find.ts`, `state/navigation.ts`): each tree is read once into
lines, a paragraph's searchable text with the pieces of the tree behind it, kept per tree in a
`WeakMap` while what shows stays the same (codes, review view, controls), so a keystroke in the panel
is an `indexOf` per line. What draws nothing adds no text, so a match runs across it; what draws
something else adds a barrier character. `replaceAll` builds one edit per tree and `editTrees` (in
`state/stories.ts`) makes them one body transaction, each story's as a `StoryStep` after its own
tracking, filters and appended transactions, so tracking, control locks and placeholders work as
when typing and undo is one step. A floor on revision ids keeps the trees' new ids apart. A match is
checked first: code, deleted text, a field's or control's edge, then, inside a control, a dry run
through the filter. Bookmark changes go through `editTrees` untracked. A custom node adds its
`text(attrs)` as one piece standing for one position, as a field code does.

Custom nodes and marks (12.3, ADR-0008, `v3/extensions.ts`): `schemaWith(extensions)` builds the
Word schema plus the extensions' types (checked: namespaced, not taken twice, leaves), cached for
the last list given. An editor keeps that schema; every place that parses content inside it
(`load`, stories, paste, notes, headers, rich control values) passes `state.schema` to
`parseContent`. `parseContent` first rewrites the JSON (`resolveCustom`): a namespaced type the
schema lacks becomes `foreignInline`/`foreignBlock`/the `foreign` mark (Word schema types holding
the type and attributes), a foreign one whose type it has becomes that type. Output goes the other
way (`writeCustom`) in `parseDocument` and `getDocument`; nothing else changes, so commands,
history, tracking and the clipboard's JSON carry foreign content as ordinary leaves and marks.
A foreign node's text from a `.docx` control rides on its JSON in memory (a non-enumerable symbol:
`withForeignText`, `foreignTextOf`), never saved. `@folijs/docx` maps custom content to tagged
content controls and back on the document's JSON (`src/custom.ts`), after `parseDocument` on
export and before it on import.

View hooks (12.4, ADR-0008, `view/src/extension.ts`): a `ViewExtension` is an extension with
`nodeViews`, `markViews`, `decorations(state)` and `view(editorView)`; the editor keeps its
extensions (`editor.extensions`), and `EditorView` reads them when it is made. The renderer
(`word/edit.ts`) draws a custom inline node's view inside its leaf span (one position, not
editable) and a custom block's view in a `div` of its own, which the flow measures as any block.
A block view that may split gives the flow its parts (`WordBlockDesc.parts`: the bottoms of its
root's children) as lines, without widow or orphan control (`anyLine`); its `splits` are then the
layout px where each page's part starts, and each part is the view drawn again in a clipping box
shifted up (`aria-hidden` after the first). Mark views and the `data-foli-mark` name go on the
run's span (`#run`). Decorations are asked on every update and compared as JSON; when they
changed the view renders, and `decorationsByBlock` gives each block its own, relative to its
content: they are part of the block's key, so only blocks whose decorations changed are drawn and
measured again, and the flow restarts from the first of them as after an edit. Inline ones cut
text runs at their ends. Plugin views are made after the first render, told after each update and
destroyed first in `destroy`. Find's matches and the selected field's shading do not use
decorations: the Custom Highlight API and one attribute draw them without redrawing a block.

## Editor view (`@folijs/view`)

`packages/view/src/view.ts`, design per ADR-0003: one `contenteditable` host holding real pages.
Since 8.7d2 a document's blocks are a flat list (schema v3 has no containers: a list is numbered
paragraphs), so ADR-0004's containers per page are gone with v2.
Built in Phase 5 (gate G4 passed provisionally): blocks flow from page to page (5.1) and split
across pages at a line (5.2), with pagination rules (5.3), incremental reflow (5.4), print (5.6)
and benchmarks (5.7, [benchmarks.md](benchmarks.md)); overview in [pagination.md](pagination.md).

- `new EditorView(host, editor, { editable, placeholder })` renders the state of a core
  `Editor` into `host` and subscribes to it. Edits go through `editor.dispatch`, so history,
  plugins and subscribers see every change. `setOptions()` changes the options; `destroy()`
  detaches the view and removes every attribute it added.
- **Blocks are the document's children** (paragraphs and opaque blocks), in document order,
  each with its position. `place` puts each block fragment into its page; anything else in the
  host or a page is stray DOM and removed. They are drawn by the Word renderer
  (`word/edit.ts`, below).
  - **Opaque blocks** have no leaves or lines: never split, moved whole. A click on one selects
    it as a `NodeSelection`, shown as a DOM range around the element plus the class
    `foli-selected-node`, and read back as a node selection.
  - **Links** are `<a href>` only for a safe target and do not navigate on click
    (Ctrl/Cmd+click opens the model's href in a new tab, `noopener`, again only a safe one).
- **Descriptors:** one per block (model node, its elements, leaves) and one per inline leaf
  (text node or hard break with its offset in the block). A block split across pages has one
  element per page (`fragments`, with `splits` = the content offsets where each later one
  starts); a text node crossing a split is two leaves. `posFromDOM` / `domFromPos` map through
  them; the DOM is never parsed for content.
  - An element point maps to the start of the first leaf at or after it, else the block end.
    A point in a page (between blocks) maps to the start of the next block
    fragment; a position between blocks maps to the start of the next block (before an opaque
    block).
  - At a mark boundary the caret is placed in the text before it, matching the marks typed text
    gets.
  - Empty blocks and blocks ending in a hard break get an extra `<br>` without a descriptor.
- **Rendering:** blocks whose model node is unchanged (same identity) keep their DOM; changed
  blocks are rebuilt; stray DOM is removed. Built with `createElement`/`textContent` only.
- **Pages:** the host's only children are `section.foli-page` elements. Each gets its
  section's page size (`width`, `min-height`) and margins (`padding`) inline in mm (an empty
  document's page: the last section's, `editor.settings`); the theme adds the background,
  shadow and gap. Blocks are page children.
  - Every render places blocks where they were (a new block joins the page of the block
    before it), measures the blocks it has no measurement for (border-box height and vertical
    margins, in place), and flows them with the pure `flow` (`src/layout/flow.ts`): CSS margin collapsing between
    blocks, the first block keeps its top margin, the last block's bottom margin must fit too
    (it stays inside the padded page, which would otherwise grow), half a pixel of slack.
  - A block that does not fit is split at a line boundary: the lines that fit stay, the rest
    continues at the top of the next page (over as many pages as it takes). Lines are measured
    only for such blocks: per-character `Range` rects, a binary search per line (a line ends
    where an item starts below the middle of the line's first one, which also holds for a
    line-height smaller than the glyph boxes), line boundaries halfway
    between lines; splits are snapped to grapheme-cluster edges. Each fragment is the same
    element type, rendered with its slice of the content and marks; a continued fragment has
    no bottom margin and a continuation no top margin (inline), so the fragments take the
    block's height. Fragments carry `data-fragment` (their index). Measuring the fragments of a
    split block gives the lines of the whole block, so a reload gives the same split.
    Heights are in layout px: a scaled ancestor (`transform`, `zoom`) is divided out. Blocks
    that changed page are moved; empty pages are removed; blocks found loose in the host (an
    extension unwrapping a page) are put back.
  - Only a single line taller than a page makes its page grow (`min-height`).
  - Rules (`flow`): a line holding a `pageBreak` (rendered as `<br data-page-break>`) is the
    last on its page; a split leaves at least 2 lines on each page (widows and orphans,
    `DEFAULT_RULES`; a block too short for both moves whole; not applied across a page break,
    nor where only an empty page could hold the lines); a paragraph with Word's keep with next
    (headings through their style) keeps with the next block (it, or a chain of them, moves to
    the next page when the block after it would start there, unless it already starts its
    page; the flow restarts from a snapshot before it); keep lines together moves a paragraph
    that fits on a page whole; page break before starts a paragraph on a new page.
  - No reflow or re-split during a composition (moving the DOM the browser composes in would
    break the IME); the next render after it flows.
  - **Print (5.6):** the view keeps a `<style data-foli-print>` in the document's head (and
    in the shadow root holding the host, if any) with the page settings: `@page` of the last
    section's page size without margins (the page's padding holds them), and a named `@page`
    for each section's setup when they differ (engines without named pages print every sheet
    at the last section's size); for this view's pages only (the
    host's `data-foli-view`), each page exactly one sheet tall, no gap between pages,
    `break-after: page` but after the last. Content taller than a page is not cut (it prints
    over the next sheet). A print lays out the screen's pagination: print-only CSS that
    changes text metrics (font size, line height) makes pages overflow their sheets.
    Checked by Playwright: in print media every page's content fits its sheet (all three
    engines, re-flow frozen as in a real print); a PDF has one sheet of the page size per
    page (Chromium only: `page.pdf`; Firefox and Safari printing is not checked). The React
    theme drops the canvas and shadows in print; everything else on the web page prints too
    and must be hidden by the app (the playground hides its bar), or it adds sheets. `@page`
    is per document: with several editors of different page sizes, the last one's sheet
    size wins. The rules are made by `print.ts`, shared with the read-only renderer
    (`DocumentPages.printStyles()`), so that `@folijs/pdf` prints its pages as the editor does
    (11.12).
  - **Incremental reflow (5.4):** measurements (height, margins, and lines once needed) are
    cached by model node: an unchanged node (same identity) renders the same at the same page
    width, so an edit reads the DOM only for the blocks it changed. The flow (`flowFrom`)
    starts at the first changed block (backed up over a chain of keep-with-next blocks) from
    the previous flow's state there, and stops once the state before an unchanged block of the
    edit's tail equals the previous state before it: the rest is the previous flow (property
    test: equal to a full flow for random documents and edits). Unchanged fragments keep
    their DOM. A `ResizeObserver` on every block element notices a block whose height no
    longer matches its measurement without an edit (CSS, a web font, a container) and marks
    it stale. Any such change also drops every cached line list (CSS or a font may rewrap
    other blocks without changing their height; WebKit fires no `loadingdone` for CSS fonts,
    so this is how it notices them), and a split block measured again is first rendered whole
    (a fragment's end breaks its line, so lines measured across the old split would depend
    on it). Web fonts finishing loading (`document.fonts` `loadingdone`) drop every
    measurement; these re-flows are batched into one per animation frame, and one due during a
    composition waits for its end. A change of page settings (`setDocument`) drops every
    measurement too, in the synchronous render that applies it. A block is measured
    whole, so its fragments are compared with that height plus the vertical padding and
    border every further fragment repeats, within a pixel per split for rounding (compared
    with the height alone, a split block would re-flow every frame); the zoom scale comes
    from the page's width in mm (`offsetWidth`/`offsetHeight` are rounded). Sizes of a hidden host (0 wide) are not compared. Edits flow synchronously:
    the DOM must match the model for the next mapping.
  - DOM ↔ model mapping walks up to the page child (a block or a fragment); a point between
    them (on a page or the host) maps to the start of the next one. The read-back joins a
    block's fragments into one text. At a split the caret is shown at the start of the next
    page's fragment, as at a soft wrap.
  - **Caret affinity at a split:** the end of one fragment and the start of the next are two DOM
    caret stops for one model position. ArrowLeft/Right (with Shift, and word moves:
    Ctrl, Alt on Apple platforms) at such an edge first step over it, then let the browser
    move (`Selection.modify`), so each press moves once. Stepping back over an edge that
    follows a hard break lands before the `<br>`, which already is the one-character move. Backspace/Delete there need nothing:
    the browser's target range collapses to one model position and the character delete runs.
    Arrow up/down, Home/End and clicks are native.
- **Input:** `keydown` → first the reserved caret fixes (page splits, list numbers, field parts,
  control edges), then the plugin keymaps in order (as `editor.handleKey`, through the view's
  dispatch), the view running its own overridable keys (Ctrl+Home/End, F9, Alt+F9, Alt+Down,
  note keys, Word's find and go-to keys) where the `viewKeys` marker stands, after the user's
  plugins ([keyboard.md](keyboard.md)). Names are normalized as
  `Mod-Ctrl-Meta-Alt-Shift-key` (`Mod` = Cmd on Apple platforms, Ctrl elsewhere; with Mod or Alt,
  non-Latin layouts and macOS Option characters fall back to the physical key). Everything else arrives as `beforeinput` and is always
  prevented. It maps to commands: insertText, insertReplacementText (target range),
  insertParagraph, insertLineBreak, the delete types, historyUndo/Redo, and format*.
  - Deletes use the browser's target range. Without one, characters and words use the core's
    grapheme and word boundaries; line deletes extend the DOM selection to the visual line edge
    (`Selection.modify`) and never fall back to deleting a character.
  - Word and line deletion keys are not in the keymap (they differ per platform: Ctrl+Backspace,
    Option+Backspace, Cmd+Backspace), so they reach the view as `beforeinput` types. Measured on
    Windows in all three engines (Ctrl+Backspace/Delete arrive as `deleteWord*` with a target
    range); the macOS keys are expected to work the same way, manual check open (ADR-0003).
- **Caret movement** (arrows, Home/End, word and line moves, Shift-extension) is native: the
  browser moves the DOM caret and the view reads it back. Playwright checks it in all three
  engines across marks, hard breaks, empty blocks and grapheme clusters; macOS key bindings
  (Cmd/Option+arrows) are in the manual checklist.
- **Selection:** read from the live DOM before every key and input event (`selectionchange` is
  asynchronous) and on `selectionchange`, and compared with the model selection by position.
  A user caret move clears stored marks. The model selection is written back only when the DOM
  does not already show it, so native caret affinity survives. An `AllSelection` is shown as the
  text range between its ends. Triple-click selects the clicked block's content (natively,
  Chromium and WebKit extend it into the next block, and typing would merge the two).
  - A model selection inside a grapheme cluster (only possible programmatically) is shown
    snapped to the cluster's edges; the model takes the snapped selection back on its next read.
  - After every change the view scrolls the selection head into view (scrollable ancestors,
    then the window, honouring `scroll-padding`): browsers do not when the view edits the DOM
    and sets the selection itself. Vertical only, since text wraps.
- **Focus:** focus from the keyboard or from code (`view.focus()`) shows the model selection and
  scrolls to it. Once the page selection has moved elsewhere (text selected outside the
  editor), browsers otherwise put the caret at the start of the host (measured with Tab in
  Chromium, Firefox and WebKit). A DOM selection that already shows the model selection (the
  window or tab regaining focus) is left alone, with the scroll position. A click that
  focuses the host keeps the caret where it lands.
- **Read-only** (`editable: false`): the host gets `contenteditable="false"` and
  `aria-readonly="true"` and stays focusable (the view adds `tabindex="0"` if the host has
  none). Every change from user input goes through one dispatch gate that drops document
  changes and newly stored marks (Mod+B on a caret), so keymaps, `beforeinput`, paste, cut and DOM read-back cannot edit; read-back
  restores the DOM instead. Selection, Mod+A and copy (the model's content) still work; code
  can change the document through the editor. Switching to read-only first ends a running
  composition so its text is kept.
- **Placeholder:** while the document is one empty textblock (and no composition runs) that
  block gets `data-foli-placeholder`; a stylesheet the view adds once per document or shadow
  root shows it as `::before` content: a zero-height float, so the caret stays at the line
  start, with empty alternative text, so screen readers rely on the host's `aria-placeholder`.
- **Accessibility baseline:** the host is `role="textbox"` with `aria-multiline`; React gives it
  an `aria-label` (`label` prop). Blocks are semantic `<p>` and `<h1>`–`<h6>`. Playwright runs
  axe on the playground (editable, read-only, empty) in all three engines; screen-reader checks
  are manual and still open (ADR-0003).
- **Composition and DOM read-back:** during composition (IME, dead keys) the browser edits the
  DOM and the view leaves it alone. A `MutationObserver` records every DOM change the view did
  not make itself. At `compositionend` (or right away when no composition is running: Android
  keyboards, extensions, any unprevented change) the view diffs the DOM text with the model
  text and turns the difference into one transaction, using the same `insertText` /
  `deleteSelection` commands as typing.
  - Text is compared as one string: blocks joined by a line feed, hard breaks as U+FFFC. The
    diff never splits a surrogate pair.
  - The marks of the inserted text follow `insertText` (stored marks, else the marks before).
    A composition is one undo step and groups with adjacent typing.
  - Blocks whose DOM changed are always re-rendered, even if their text did not change.
  - The diff is minimal (common prefix, then common suffix); the caret only decides where a pure
    insertion or deletion inside repeated text happened.
  - A render during a composition keeps the browser's pending changes for the read-back.
  - A blur ends a composition the browser never closed. Composition input types that arrive
    outside a composition are not prevented; their DOM effect is read back. Empty stray nodes
    are removed silently.

Known limits:
- Pages: an edit that shifts every later block (a new block in the middle) re-runs the flow
  over the rest of the document (arithmetic over cached measurements, plus the first line
  measurement of blocks that now cross a page end); the reconciliation walks every block's
  DOM position (no layout reads). A CSS change that alters only margins, or rewraps blocks
  without changing any block's height, is not noticed (the `ResizeObserver` watches sizes;
  the old line starts stay until some block's height changes). One block resized without an
  edit makes a full flow that renders every split block whole and measures again the lines of
  every block crossing a page end (about one per page): fine for a font swap, costly for a
  CSS animation of one block's height. Line measurement assumes
  left-to-right text without vertical-align offsets; block padding and borders are not split
  (a fragment keeps both). Justified text keeps its fragments' last lines justified
  (`text-align-last`, 7.4). Page breaks depend on the fonts available: the tests use
  a bundled font (see [testing/visual-regression.md](testing/visual-regression.md)). Negative block margins
  are not modelled.
- A read-back that would add blocks or line breaks is discarded with a `Foli:` console warning
  (some Android keyboards insert paragraphs without `beforeinput`). A `<br>` the browser adds in
  place of a hard break is not recognized, so that hard break would be read as deleted
  (untested). The read-back diffs the whole document text, O(document) per composition.
- Real IME and dead keys are verified only through Chromium's emulation so far; the manual
  checklist is [testing/ime.md](testing/ime.md); not run yet, open risk in ADR-0003.
- A line delete without a target range stops at the visual line edge, also for hard-line
  deletes. The fallback is tested only with synthetic events; whether every engine gives a
  target range for line deletes (macOS Cmd+Backspace, Ctrl+K) is part of the manual checks.
- Drag and drop does nothing (both the drop and the drag source are prevented).
- Paste maps HTML to schema v2 (7.8): tables become paragraphs and images are dropped. Word
  and Google Docs list markup is read best effort. The fixture corpus is hand-written
  approximations; real Word, Google Docs and LibreOffice captures are part of the open manual
  checks (ADR-0003).
- Content the schema cannot fit at the selection, neither as a slice nor as whole blocks, is
  not pasted (no case known: the T3 sweep pastes every fixture at every text position).
- The placeholder stylesheet is added when a placeholder is first shown, to the host's shadow
  root or the document head; a host moved into a shadow root after that keeps no styles there.
- The placeholder stylesheet is an inline `<style>`: a Content Security Policy without
  `'unsafe-inline'` for styles blocks it, and the placeholder is not shown (`aria-placeholder`
  still is announced).
- `setDocument` during an IME composition is not handled: the composition's read-back would
  compare the browser's DOM with the new document. Load documents when the user is not
  composing (a file picker or a button click already ends it).
- Server rendering gives no document content (an empty editable area until the JavaScript
  runs): no preview without JavaScript, nothing for crawlers. A static server render of the
  pages could come later.

### Word formatting on schema v3 (`packages/core/src/state/wordformat.ts`, 8.7b)

The generic commands branch to it (`setAlign`, `setTextColor`, `setHighlight`, `toggleList`,
`wrapInList`, `sinkListItem`, `liftListItem`, list Enter and Backspace, `setBlockType`, links):
schema v3 is the only editing schema. Run properties, alignment and line spacing are written
directly only where the resolved formatting without them differs (picking a heading's own size,
color or alignment leaves no direct value; "Automatic" color and "no highlight" write `auto` and
`none` where a style gives one); space before and after and indents are always written. Paragraph changes are one
`NodeMarkupBatchStep`. A transaction can replace the document's envelope (`withEnvelope`,
plugin state): a new list's numbering definition, and a built-in style the document has not
used yet (headings, List Paragraph, Hyperlink, with the Word 2013 to 2019 template's
definitions, not checked against newer Word), are added that way. Undo keeps such a definition,
unused (a choice; not checked against what Word does). Comments are not changed that way:
`withEnvelope` ignores them, and a `CommentStep` (made by `setComments`) adds, changes or
removes one. It leaves the tree as it is, so history records it with the text it belongs to
and undo and redo take it back.

Tracked changes (9.2, `state/track.ts`) do not change the commands. With tracking on (a plugin
state: on/off and the author), `createEditor`'s dispatch rebuilds each transaction from what
it changed: the ranges its steps replaced, merged and compared before and after. Each range
becomes a tracked deletion of the old content (a `deletion` mark on inline content, the
paragraph's `revision.deletion` for a paragraph mark; one's own insertion removed for real,
its paragraphs joined keeping the last one's mark) followed by the new content inserted with an
`insertion` mark (inserted paragraph marks get `revision.insertion`). Steps that move nothing
(marks, attributes, comments) are then replayed through a mapping from the transaction's
document to the rebuilt one, except attribute changes of a paragraph the edit joined and the
rebuilt document keeps apart. Paragraph revisions are set last, so a replayed attribute
change does not drop them. History records the rebuilt steps; undo and redo are not tracked.
A property test checks that "accept all" equals the same edits untracked and "reject all"
the original. Formatting (9.3) is recorded on the replayed steps: before a mark step of a run
property, the runs it changes get a `formatChange` mark with their run properties; a markup
step that changes a paragraph's properties gets the paragraph's `formatChange` attribute. Text
and paragraph marks of one's own insertion record nothing, and an existing record is kept (the
properties before the first change). A join that removes one's own inserted mark keeps the first
paragraph's properties, as untracked; when they differ from the last one's (whose mark stays),
that is recorded as the last one's formatting change, so rejecting restores it. Whether tracking
is on is not part of the document format: the editor option
and the `.docx`'s `w:trackRevisions` (read and written by `@folijs/docx`) carry it.

Accepting and rejecting (9.4, `state/review.ts`) work on the list `trackedChanges` makes
(runs with one change mark, paragraph marks, paragraphs' recorded formatting): mark and attribute
changes first, then removals and joins from the end of the document, so earlier positions stay.
They carry the `untracked` meta, so tracking leaves them as they are.

Comments (9.6, `state/comments.ts`) are anchors in the text (`commentStart`, `commentEnd`, then
`commentReference`, as Word writes them) and `CommentStep`s for their content, in untracked
transactions that are undo steps of their own (`closeHistory` now keeps what follows from
joining them too). A plugin's `appendTransaction` removes a comment, with
its replies and remaining anchors, when an edit removed its reference mark; it scans only the
ranges the edit replaced.

Lists: bullets reuse a plain definition of the document (not a numbering style's, nor one whose
levels number headings) or add Word's (Symbol, Courier New, Wingdings bullets, half-inch levels);
numbers start a new instance with a start override at 1, on a plain decimal definition or a new
one, unless the paragraph before is in a plain list of the kind, which goes on. Bullets in
Symbol and Wingdings are shown as the Unicode characters they draw (the view, `blocks.ts`).
Tab types a tab on v3 (a list's Tab first). The view lets the keyboard leave: Escape, then Tab
or Shift+Tab, keeps the browser's focus move, and so does Tab in a read-only view. Tab on a numbered heading takes the next
level's linked style (Heading 1 to Heading 2) where the document has it.

### Editing schema v3 in the view (`packages/view/src/word/edit.ts`, 8.7a)

`EditorView` renders an editor holding a v3 document with `WordRenderer`: the paragraphs of the
Word pages below, built from model nodes with their leaves (text nodes; a tab is a `"\t"` text
node, read back as one; hard, column and page breaks are `<br>`; bookmarks, comment anchors
and reference marks empty spans; an opaque inline node a non-editable span showing its text),
split into fragments at content offsets like the v2 blocks (the first-line indent and the list
number on the first fragment only). An opaque block is a non-editable block leaf, selected as a
node. List numbers and comment shading depend on the blocks before, so a block is drawn again
when they change (`key`), not only when its node does. What is shown but is not document text
(`contenteditable="false"`: list numbers, opaque content) is skipped by the read-back. The flow
uses Word's spacing (`spacing: "word"`, contextual spacing between paragraphs of one style,
keep with next, keep lines together, page break before); the space above each block is written
as its top margin after the flow (`FlowResult.gaps`: none at the top of a page or column the text
flowed onto). Each block belongs to a section (the one a paragraph's `section` ends, else the
envelope's), given to the flow as `BlockBox.section` (`FlowSection`: how it starts, its columns,
whether they are balanced, its page box as a function of the page). A page holds **bands**, one
per section on it, each with its section's **columns** (`.foli-band`, `.foli-column`, from
`word/columns.ts`; a page of one section in one column keeps its blocks as direct children).
`place` puts each fragment in its slot (page, band, column); positions still map through block
descriptors, and bands and columns count as holding blocks (`holdsBlocks`). Before a flow, blocks
stay where they were (`initialPlaces`), each section in a band of its own, so each is measured in
its own column's width; with columns of different widths a block is also measured at the width of
the column it lands in (the fragment's width set for the reading, `Measure.widths`). A block whose
section's layout changed, or that became a section's first, is measured and flowed again. A
section's empty last paragraph takes no room (`position: absolute`, still a place for the caret).
Print gives each page setup a named `@page`. Fonts' line height ratios are measured once per family
outside the host and measured again after web fonts load (every block is drawn again).

Copy from a v3 document: plain text has tabs as tabs, opaque content as its text (a table's
paragraphs on their lines), markers as nothing. The HTML is the blocks as the editor draws them
(`clipboardBlocks`): the resolved formatting as inline CSS, outline levels as `h1`–`h6`, Word's
spacing as margins, a list number as Word's HTML writes it (`mso-list:Ignore` on the number,
`mso-list:lN levelM lfoN` on its paragraph, which Foli's reader and Word take back as a list),
links whose target `isSafeHref` takes as `<a>` (schema v3 keeps any target), and nothing only
the editor needs (comment shading, `contenteditable`). Text copied from inside one paragraph
takes no number. The Foli JSON carries the definitions the content references
(`copiedDefinitions`: its styles, the paragraph mark's and a tracked change's included, with
those they are based on, link to or are followed by, its lists' numbering, its comments) and
the document's id (`WordContext.id`, made when the document is loaded).

Paste on v3 (8.7c, `state/wordclip.ts`) fits the content to the document as Word does with
"use destination styles" (`fitPaste`): a style the document has by name is used, any other is
added (a free id when its id is taken, never as the document's default); a list copied
inside the same document (the copy carries its id) goes on numbering where the instance and
definition are unchanged, any other gets an instance of its own (on the document's definition
when one is the same): Foli makes equal ids and definitions in every document, so equality alone
would join lists of different documents (Word tells them apart by `w:nsid`); from another
document, a style or list the copy does not define is none (default style, not numbered), not
the target's of that id; comments are copied with new ids (as Word duplicates them), a reply
whose comment was not copied becoming a comment of its own, an anchor without its comment left
out; a bookmark whose name the document uses outside the replaced selection is left out, others
get new ids; paragraph ids (`w14:paraId`, `w14:textId`) are left for export to make. The definitions are
validated as a document's envelope first (`parseDocument`): invalid ones fall through to the
HTML. HTML is read as schema v2 (`htmlToDoc`) and structured by `migrateToV3` (`fitPastedV2`),
with Word's built-in heading, List Paragraph and Hyperlink styles where the document lacks
them, the list levels the list buttons make, each list a new one, and without bold, italic,
underline or strike the paragraph's style already gives (HTML writes a heading's bold on its
text). What a paste adds to the envelope stays after undo, styles and list definitions, as in
Word; copied comments are `CommentStep`s, which undo removes with the pasted text, as Word's
undo does. Ids inside opaque content and
tracked-change ids are pasted as they are (Word tolerates repeats of both). Pasted definitions
keep their verbatim `ext` XML, which export writes back when it still matches the model: a
page that sets Foli's clipboard type can put XML into `styles.xml` and `numbering.xml`, as
opaque content could already put it into the body (both arrive as strings checked only for
type and length; export writes `ext` back only where it reads back as the model's values). Each copy resolves the list numbers of the whole document, and
each paste walks it once for comment and bookmark ids (O(document); not measured on large
documents yet).

The view moves the caret over a list number in one press: browsers stop before and after the
non-editable number, the same model position, so Right at the end of the paragraph before and
Left at a numbered paragraph's start step over the boundary themselves.

**Stories (11.7, ADR-0007).** The word plugin's context holds each story as a tree
(`context.stories`, `Story`), mirrored as JSON in the envelope. `StoryStep(id, before, after, ...)`
changes one in a body transaction; it maps nothing and inverts by swapping. `editor.story(id)`
(`state/stories.ts`) gives an `Editor` with its own `EditorState` (selection, stored marks, the
word context and tracking state of the body's, no history): its `dispatch` computes the next state,
sends the body a `StoryStep` (and the comment and envelope steps, the numbering, styles and
resources it changed, a change of tracking), and takes the state only if the body then holds its
tree. `undo` and `redo` on a story's state run on the body (`storyBody`); history groups story
typing by the story's own transaction (`storyEdit` meta) and merges consecutive steps of a story.
A stale `StoryStep` or `EnvelopeStep` drops its whole event (`storedStepsApply`). Revision and
bookmark ids are allocated over every tree (`otherTrees`), and accepting or rejecting all changes
reaches every story.

A note opens the same way (`openNote`: double click on it or its number, Shift+Alt+N, the Notes
menu), mounted in its piece at the foot of its reference's page, whole. A plugin in core
(`notesPlugin`) keeps a note with its reference: removed with it, tracked with it, settled with it.

The main view shows every header and footer read-only (`word/regions.ts`, both renderers). To edit
one, `EditorView.openStory(side, page?)` (a double click in the page's margin, or
`editor.storyView.edit` from the toolbar) makes the host read-only, stops its mutation observer,
hides that occurrence and mounts a second `EditorView` of the story's editor (`paged: false`) in a
`contenteditable="false"` wrapper in its place. The main view's listeners ignore events from the
wrapper, its selection reading and `hasFocus` too, and `place` keeps the region. Escape, or a press
on the host outside the wrapper, closes it (`closeStory`). A `StoryStep` reaching the main view
redraws the story's other occurrences, and flows the pages only if a height changed; the renderer
and the layout cache stay.

Not yet in the editor: a
horizontal rule button (a rule is a paragraph's bottom
border). Links are drawn as `<a>` where `isSafeHref` takes the target (schema v3 keeps any),
inheriting the run's own color and underline (Word shows a link without the Hyperlink style
plain), so Ctrl+click opens them (8.7d1). A link from another source (a paste without the
document's id, a command) must have a safe target; the document's own keep theirs. Each render resolves the list numbers and open comment
ranges of every paragraph and writes the gaps of every block (O(document); measured before
8.7d). Whether Word keeps the mark's run properties (`markFormat`) on the paragraph after a
heading, and a tracked formatting change on both halves of a split, is not checked against
Word yet: Foli keeps neither on the new paragraph.

Tables in the editable view (10.5, `word/table.ts`, ADR-0006): the view's blocks are every
paragraph and opaque block in document order, those in table cells (nested tables' included)
too, each with its own position, leaves and fragments, so position mapping, splitting and the
read-back work in cells as they do in top-level paragraphs. The page flow's items are the
top-level blocks and tables. A table is drawn from the model (`collect`, `frameElement`): a
wrapper per page with its table, the grid's columns, the rows that page holds, and cells with
the table style's formatting (`Resolver.cell`: shading, borders, margins, vertical alignment;
`border-collapse` resolves conflicts); a cell's paragraphs get its paragraph and run formatting
(`Resolver.paragraph(attrs, cell)`) and their spacing as margins. A merged-down cell spans the
rows it covers on a page (`rowspan`); one continued from the page before gets a cell of its
own; a covered cell's paragraph stays in the DOM, in document order, in a cell the table does
not lay out (`display: none`). A changed table is drawn whole and measured (its rows, where each
block starts); its break points are the ends of its rows and, inside a row that may split, its
cells' line ends (`breaksOf`): a row that may not split (`cantSplit`, unless taller than a page)
moves whole, and a row in a vertical merge or holding a nested table splits only between rows
(shortcut). After the flow (`cutTable`) each page's wrapper shows the rows it holds; a row split
across pages is in both, each cell's paragraphs split at their own lines (the paragraph
fragments above). The leading header rows are drawn again above a continuation, not editable
and not read back; a click there puts the caret in the first row below.

Editing in tables, core (10.6, `state/tables.ts`, ADR-0006): a cell's content is never joined
with what is outside it (Backspace at a cell's start and Delete at its end do nothing; Enter
splits the paragraph). Backspace at the start of the paragraph after a table moves the caret
to the end of the table's last cell, Delete at the end of the one before to its first cell's
start, as Word moves into a table. Deleting a selection that runs from outside a table into it
takes the whole rows it touches (the table when it touches every row), with the text outside;
one across cells of one table empties those cells (`deleteAcrossTables`); a paragraph is put
back between two tables that became adjacent and after a table that ends the body
(`keepTablesApart`). While tracking, text in cells is tracked as everywhere, a whole row
deleted is the row's deletion (one's own inserted row goes) and a whole row inserted the row's
insertion; review lists the changes in cells and the rows' revisions, and accepting a deleted
row (rejecting an inserted one) removes it, the table with its last row.

Moving in tables (10.6b): Tab and Shift+Tab go to the next and previous cell, selecting its
content (`goToCell`, bound before the lists' Tab: in a cell Word moves, numbered or not); Tab in
the last cell adds a row like the last one (empty cells, no merge; its paragraphs keep the
properties but not the ids, revisions or section of the last row's), recorded as an inserted row
while tracking. Cells a merge covers are skipped. Not yet: Ctrl+Tab for a tab character, and a
list's level changed by Tab, in a cell.

Cell selections (10.6c, `CellSelection`): anchor and head are the positions before two cells
of one table; the selection is the rectangle between them, widened until no merged cell sticks
out (`cells`); its JSON is `{ type: "cell", anchor, head }` (`Selection.fromJSON` reads it
through `Selection.kinds`); it maps by its cells and falls back to a caret when one goes.
Delete and Backspace empty the selected cells; typing replaces the anchor cell's content.
Shift+Up/Down from a cell's first or last line start one, Shift+arrows grow it
(`extendCellSelection`). The view reads a native selection whose ends are in two cells of one
table (a drag) as one, and Firefox's one range per cell too; it marks the cells with a class
and keeps the native caret in the head cell (the browser's own highlight, in DOM order, is
hidden while cells are selected). `Selection.ranges` gives one range per selected cell, so
marks, links, paragraph and run formatting, and accepting or rejecting changes act on those
cells only.

Copy, cut and paste of cells (10.6d, ADR-0006): selected cells copy as a table of their own
(`cellsAsTable`: the rows the rectangle covers, each cut to its columns, the grid's widths of
those columns), as Foli JSON, the HTML the Word renderer draws, and text with a tab between
cells and a line per row; cut copies, then empties them. Pasted content that is a table alone
fills the cells from the selected cell (a cell selection's first cell, or the cell holding the
caret) when pasted into a table (`pasteCells`): each pasted cell's content replaces the cell at
the same place (a target cell a merge covers takes only the first pasted cell it covers), rows
like the last one are added as needed in one step (tracked as inserted rows when tracking),
cells past the table's last column are dropped (not yet reported), and the rectangle of the
filled cells ends up selected. A copy is new rows: not their identity (`w14:paraId`) nor their
row revision (tracked text in them keeps its marks); a table's style and a row's exceptions'
style travel with it (`copiedDefinitions`, mapped by name as paragraph styles are). Not yet: a
copied row with no cell in the copied columns is left out (the rows after it paste one row
higher), and pictures pasted from another document lose their resources (10.8). Pasted into text, it is a table between the paragraph's two halves.
Other content over selected cells goes into the anchor cell. Clipboard JSON is validated as
schema 4 content to paste (`parseContent(…, fragment)`: a table may end it); after a paste a
paragraph is put after a table that would end the body or touch another (`keepTablesApart`).
HTML tables from other applications still paste as paragraphs. Known: in Firefox, Shift+Home
right after typing in a cell does not extend the selection (Shift+arrows do).

Up and Down from a cell's first or last line (or with a cell's content
selected) go to the cell above or below covering the same grid column (a merge's first cell),
or out of the table from its first or last row (`goToCellVertically`, run by the view, which
knows the lines): browsers go to the next cell in the DOM, or to the wrong row across pages. Left,
Right and typing stay native. Enter and inline insertions over a selection that crosses a
table's edge delete it as `deleteSelection` does. A table's breaks
have no widow and orphan control (`BlockBox.anyLine`): Word keeps no lines together across
rows. During a composition nothing moves: a table keeps its wrappers (the ones at its place,
if its node changed), and a cell paragraph drawn again takes its old element's place; the
read-back counts a block it finds nowhere, with no recorded removal, as unchanged. Not yet: column
widths are the grid Word saved (an autofit table is not recomputed), an exact row height is
drawn as at least, contextual spacing between paragraphs in a cell.

Table commands (10.7a, `packages/core/src/state/tablecommands.ts`) act on the table around the
selection, on the rows and columns of a cell selection's rectangle or the caret's cell:
`insertTable(rows, columns)` (up to Word's 63 columns, 1000 rows) inserts empty cells sharing
the section's text width with Word's "Table Grid" style (added from `builtinStyle` when the
document lacks it), before the caret's paragraph at its start, after it at its end (and,
while tracking, after it from its middle: a tracked split would stay when the table is
rejected), else between its halves as Enter splits (the first half gets a new paragraph mark),
with a paragraph after it where nothing follows; `insertRow(dir)` adds an
empty row like the first or last selected one, a vertical merge running across it going on;
`deleteRows` deletes the selected rows (a merge starting in one restarts in the first kept row,
with its cell's properties and text; while tracking the rows stay as deletions, and accepting
them leaves the merge's covered cells without its start: not yet fixed up), the table when they
are all of them; `insertColumn(dir)` adds a column (up to 63) as wide as its neighbour (a cell spanning its place widens, the new cells take their neighbour's
properties, `gridBefore` grows where a row starts after its place, a row ending before it stays
short, a table without a grid keeps none); `deleteColumns`
removes cells and narrows spanning ones (a row left with no cell goes); `deleteTable`. Rows
inserted and deleted while tracking are tracked (the rebuild records them); column commands do
not apply while tracking. A caret in a cell a merge covers acts as from the merge's cell. Cell
widths in twips follow the grid. `insertTable` takes the text width of the document's last
section, not the caret's.

Cells and properties (10.7b, same file): `mergeCells` merges a cell selection's rectangle (when
every grid place of it has a cell) into its first cell, spanning its columns and, over several
rows, starting a vertical merge the rows below continue; it holds every selected cell's blocks
row by row (a covered cell's own text too; empty cells left out). `splitCell` splits the selected merged cells back into their
grid's cells, the text in the first (not Word's split into n columns of an unmerged cell).
`toggleHeaderRow` makes the selection's rows header rows with every row above them (Word
repeats only a run from the top), or, when they all are, makes them and the header rows below
ordinary (`isHeaderRow`). `setTableStyle(name)` gives the table a table style by name (Word's
Table Grid added when missing; `tableStyles`, `tableStyleAt`). `setCellShading(fill)` sets or
removes the selected cells' shading (`clear` pattern), on every cell of a vertical merge (Word
paints each row's part from its own properties). `setColumnWidth(pos, column, twips)` is
a border drag: the next column gives or takes the difference, neither under 0.1 inch; the last
column's border widens the table (and its width in twips); cell widths in twips follow (up to 22
inches), and the selection stays. None of them applies while tracking. New empty paragraphs
take a cell's last paragraph's properties without its identity or revision. Every table
command (10.7a and b) is its own undo step. Export writes a new table style (Table Grid) from
the model; a table style read from a file and then changed is still refused.

Column borders in the editable view (10.7c): over a border of a top-level table (within 4 px of
an edge of the cell under the pointer, or of the table's right edge from outside it; a grid line
through a spanning cell is no border) the pointer shows `col-resize`, except in read-only mode,
during a composition and while tracking. A press there (without Shift) starts a drag: no caret
or text selection comes from it, an unfocused editor takes the focus with the selection it had,
a dashed guide follows the pointer, and the release moves the border by as much as the pointer
moved (`setColumnWidth`, one undo step); a press without a move changes nothing. Escape, the
button let go outside the page or the window losing the focus cancel. Not yet: the borders of a
nested table, and a keyboard way to set a column's width (the table menu's).

Picture commands (10.8c, `packages/core/src/state/pictures.ts`): `insertPicture` adds the image
as a new resource (`foli-picture-N`, its `url` or opted-in `data:` URL checked as the envelope's
resources are, a `data:` URL of the stated type) and inserts the picture at the selection
(over selected cells, in the anchor cell) with the marks typing would get there (never a
tracked change's), as one undo step; it needs alt text unless the picture is marked decorative
(which has none). Undo takes the picture away and leaves its resource (the envelope is not in
the history; export writes only the images pictures use). Inserting and
deleting a picture is tracked as text is (insertion and deletion marks, exported as `w:ins` and
`w:del` around its run). `setPictureSize` does not apply while tracking (Foli does not record
the change yet); `setPictureAlt` does (Word does not track alt text either).

Pictures in the views (10.8b, `pictureElement` in `word/blocks.ts`): an inline picture is drawn
in its line at its size (EMU / 9525 px) as an `img` with its alt text (empty when decorative),
from the URL `imageSource` gives for its resource: the app's (`EditorViewOptions.resource`,
`RenderDocumentOptions.resource`, its `null` showing the box; `packageImages` in `@folijs/docx` makes
object URLs for a package's raster images and `data:` URLs for its SVGs, never same-origin
`blob:` SVGs), else the resource's own image `data:` URL or web or `blob:` URL, fetched with no
referrer (nothing else: a `javascript:` URL is no image); with none, a box of its size with the
alt text as its label (`role="img"`). Its display, vertical alignment and maximum sizes are set
inline, so an app's image CSS (`display: block`) cannot take it out of its line. In the
editable view it sits in a `contenteditable="false"` span, one position like opaque content
(no browser resize handles); one without alt text and not decorative is named "Picture without
alt text" and has a dashed outline (`data-foli-no-alt`, not printed). The line takes the
picture's height and its size is set before the image loads (no reflow on load).

Selecting, resizing and inserting pictures in the editable view (10.8d): a press on a picture
selects it (a node selection; a native selection exactly around one reads back as one), its
span outlined and given a resize handle (`data-foli-resize`, the view's own DOM: its changes
are not read back as input). Dragging the handle resizes the picture live, keeping its aspect
ratio (the larger of the two moves), from 8 px to the text's width; the release sets its size
(`setPictureSize`, refused while tracking: the picture goes back), a press without a move
changes nothing, and Escape, the window losing the focus or a document change cancel. In
read-only mode the selected picture has no handle. Image files pasted alone (no text, no Foli
JSON) or dropped go to the app's `upload` hook (none, nothing happens; a file drop never opens
the file in the page), then in as pictures (`insertFiles`): each measured first from a local
object URL (one the browser cannot show is not uploaded), then uploaded (a failure is reported
on the console and skipped), then inserted at its natural size no wider than the last
section's text, where the paste or drop was, mapped through every change made meanwhile and
after any composition then running; the type a returned `data:` URL says; no alt text unless
the hook gave it, marked.
shortcut: in the editing view a picture's line is measured from its span's box, not the
image's, so a line holding only a picture can end a page a little early; `renderDocument`
measures text lines only (a picture-only paragraph moves whole; a break may fall inside a
picture between text lines); measure the image when it matters.

Floating pictures (10.9, ADR-0006; `floatElements` in `word/blocks.ts`): a picture with `float`
is drawn first in its paragraph (the fragment its place in the text is in, on a split
paragraph), and the browser lays the lines out around it, in that paragraph and the ones after
it on the page (the 10.9 spike). Square wrapping (tight and through shown as square) is a CSS
float on the side of the column the picture is on (or the side `side` names), its distance from
the text as its margin, a zero-width spacer float before it giving its offset down from the
paragraph's top; text goes on the other side only. Top and bottom is a float as wide as the
paragraph. Behind and in front of text are absolutely positioned against the page (each page
is `position: relative; isolation: isolate; display: flow-root`), z-index -1 (under the text,
over the page's background) or 1. Positions are against the column, the page, its margins
(left, right, top, bottom) or the page's text, as offsets or alignments, on the last section's
page (`floatGeometry`); the distance from the text above and below is the float's margin. In the editable view the holder and spacer are the view's own
(`contenteditable="false"`, not read back, like a list marker); the picture's place in the text
is an empty non-editable anchor span (`FLOAT_ANCHORS` maps the holder to it): a press on the
picture selects that position, and the selected picture's outline and resize handle are on the
holder. A paragraph holding only a floating picture shows its empty line. A block that changed
(new, drawn again or stale) on a page holding a floating picture has the blocks after it on that
page and the next measured again (their lines go around it); a float in a paragraph split across
pages settles (`word-floats.spec.ts`). In the editing view the
corpus's picture report (07) has its three floats on Word's page and paragraph, at Word's
offsets to the pixel (`apps/playground/e2e/word-floats.spec.ts`, three engines).
shortcut: a wrapping picture placed against the page or its margins vertically is drawn at its
paragraph's top; horizontal positions are against the paragraph's box (its indents in), in a
table cell against the page too; a float's top is never above an earlier float's and `clear`
stacks floats on one side, so several floats in a paragraph (or one placed above a float of an
earlier paragraph) add their offsets down instead of sitting side by side; a float reaching past
its page's text makes the page taller (pages contain their floats) instead of moving to the next
page; the clipboard writes it inline.

Review in the editable view (9.5): `EditorView` draws tracked changes as the editor's state says
(`trackState(state).view`, `setReviewView`), every block again when it changes. `markup`:
`ins`/`del` in the author's color (eight colors, picked by the author's name), titled with the
author and date, and a bar (a `box-shadow`) beside paragraphs with changes; `simple`: the text
as accepted, with the bar; `final`: the text as accepted. Deleted text is hidden (`display:
none`), not left out, so positions map through it; the caret is never written into it (the shown
text next to it takes it), and Backspace and Delete step over it wherever it is hidden or while
tracking. A paragraph whose mark is deleted is not drawn joined with the next while editing.
Commented text carries `data-foli-comments` (the ids of the comments whose range holds it).

The comments pane (9.7) is React's `FoliComments`: it reads the comments from the editor's state,
orders the threads by their anchors (`commentAnchors`), finds each thread's text through
`data-foli-comments` in the nearest ancestor holding the pages, and places each thread level with
it, below the one before, measuring after every change and on resize. It edits through the
comment commands only. `FoliEditor` puts it beside the canvas in `.foli-editor-body`.

### Word pages (`packages/view/src/word/`, 8.6b)

`renderDocument(document, container, { review })` shows a schema v3 document on pages, as
Word lays it out, read-only and without an editor (`EditorView` edits on the same blocks).

- **Blocks** (`blocks.ts`): each paragraph's and run's formatting from core's `Resolver` as
  inline CSS, built with createElement and textContent only. Paragraphs with an outline level
  1-6 are `h1`-`h6`. List markers sit in the hanging indent. Fonts are listed with their
  metric-compatible substitutes (Calibri, Carlito; Cambria, Caladea; Arial, Liberation Sans;
  Times New Roman, Liberation Serif; Courier New, Liberation Mono; Georgia, Gelasio); Foli
  ships no font. Word's line spacing is a multiple of the font's own line height, measured in
  the page (`line-height: normal` of each font) and set per run. Tracked changes show as
  `ins`/`del` (`markup`: in the author's color, titled "Inserted/Deleted by …, date") or are applied (`simple` and `final`: deletions left out, a paragraph whose mark was
  deleted merged into the next, numbered once; not into a table). Commented text is shaded. Content the model keeps opaque is
  read from its XML with the browser's XML parser (an inert document; text, table structure,
  paragraph style and alignment, and basic run properties are read): a table as a table (grid,
  spans, margins, borders, shading, header rows; rows and cells inside content controls; nested
  tables), a content control or field as its text, a picture or text box as nothing (the text
  of a text box, and the fallback copy of alternate content, are left out of the line).
- **Pages** (`pages.ts`): one flow over the sections in order, each with its page size, margins
  and columns (bands and columns as in the editor, a blank page before an even or odd page section
  when the number asks for one), each page with its header and footer (`regions.ts`). The blocks are measured in a hidden page of the section's, in a
  column of its first column's width (other widths on demand); their lines are the clusters of
  their text's client rects. The pure `flow` places them with Word's spacing (`spacing: "word"`):
  the larger of the space after one paragraph and the space before the next, a page or column the
  text flowed onto drops the space before its first paragraph (one an explicit break started
  keeps it), and the space after the last paragraph on a page may hang below it. Keep with next, keep lines together (not for a paragraph taller
  than a page, or one with a break in it), page break before, explicit page and column breaks, widow
  and orphan control (two lines) apply; a table's header rows are repeated
  at the top of each page it continues on (`BlockBox.repeat`), and a row that may not split
  (`cantSplit`) has no break inside it. A block split across pages is
  shown as a clip of the whole block per page. A table of the model (schema v4) is drawn from it
  read-only, with its table style's formatting per cell.
- `cellParagraphs()` gives the page of every paragraph in table cells, in document order.
- `pageOf(index)` and `lineOf(index)` give where a top-level node starts (the page, and the
  line on it as Word numbers lines); the corpus harness compares them with Word's, and each
  page's ink with Word's PDF of it (`pnpm corpus:pages`, numbers in corpus/README.md).
- `fieldLayout` gives the pages to `updateFields` (11.12): a body position's page is the page its
  top-level block starts on (shortcut: a bookmark in a paragraph split across pages gets the
  first), its number with the section's restart and format, and its section's page count.
  `printStyles()` gives the editor's print rules for these pages (each page carries its
  section's `data-foli-sheet`). A bookmark's start is an empty, absolutely positioned
  `data-foli-bookmark` mark: where `@folijs/pdf` points a link to it.

PDF (11.12, `packages/pdf`): `exportPdf` (Node's side) validates the document, builds the pictures'
`data:` URLs from `resources` (any other URL becomes the picture's box), and drives the app's page:
`setContent` of an empty document whose Content Security Policy allows `data:` images and fonts
and inline scripts and styles only (nothing is requested: a document cannot make the server
fetch an address),
`addScriptTag` of `dist/renderer.js` (Vite bundles `src/renderer.ts` with core and the view from
source into one classic script at build; the Node side reads it from `../dist/renderer.js`
relative to itself), `evaluate` of `foliPdf.render`, and `pdf`. In the page: the app's `styles`,
every declared font face loaded, `renderDocument` into the body, `updateFields` on an editor of the
document with `fieldLayout`, laid out again when a result changed and once more for what depends on
the pages (as `view.updateFields` does), spans with a safe `data-href` or one naming a bookmark on
the pages wrapped in `a` (the bookmark's mark given an id), `printStyles()` added, images decoded.
Chromium's `page.pdf` with `preferCSSPageSize` prints each named page at its own size, and with
`outline` and `tagged` (Playwright 1.42+) turns `h1`-`h6` (paragraphs with an outline level; the
hidden copies of split blocks are `aria-hidden`) into PDF bookmarks.

Marks of find (11.11, `word/matches.ts`): ranges in two `Highlight` objects shared by a document's
views, so the pages' DOM never changes and the mutation observer has nothing to read back. They
are made for the pages within a screen of the window (from `itemPages`), again after each placement
and when scrolling brings other pages near; an open story's view marks its own tree, and the drawn
copies of other stories are searched as text. `reveal` opens a story through the same path as a
double click, without moving the focus, so the panel keeps it.

Footnotes and endnotes (11.10, `word/notes.ts`, both renderers): `PageNotes` draws each note from
its story with its number and measures it as lines for the flow (`BlockBox.notes`, `endnotes`,
`FlowRules.notes`); the flow's `NotePiece`s, held by the fragments that brought them, say which
lines go where, and the renderers put them at the band's foot (absolute, above the bottom margin)
or after the text. Numbers come from `noteNumbers` in core and are drawn, never stored.

Not yet: floating objects other than pictures (10.9: drawn as
in the editing view; the blocks are measured on one long page without the space between
paragraphs, so the lines after a floating picture may go around it a little differently than
on the page), custom tab stops (default
stops every half inch), widow control turned off for one paragraph, right-aligned or centered
list numbers, and a marker wider than its hanging indent (Word moves the text to the next tab
stop). A table row
splits between its lines. Paragraphs inside opaque blocks and table cells collapse their
spacing (the larger of after and before) where Word adds it. Measuring is synchronous: fonts
must have loaded, and the container must not be scaled (`transform`, `zoom`).

### Clipboard (`packages/view/src/clipboard.ts`)

- **Copy and cut** come from the model, never from the DOM (ADR-0003 finding 5). The selected
  range is written as `text/plain` (blocks, hard and page breaks as line feeds), `text/html`
  (Word's HTML, see "Copy from a v3 document" above; page breaks as
  `<br data-page-break style="page-break-before: always; …">`) and `application/x-foli+json`:
  `{ open, content, word }`, the copied blocks as JSON, whether the copy was inside one block,
  and the definitions they reference (`copiedDefinitions`). Cut is copy plus
  `deleteSelection`, as its own undo step.
- A copy holding custom or foreign content also puts its Foli JSON in the HTML, as the
  `data-foli-clipboard` attribute of a wrapping `div` (set through the DOM, so escaped), because
  some browsers (Firefox) give a paste only `text/html` and `text/plain`; paste reads it right
  after the Foli type, parsing the HTML inert, and validates it the same way.
- **Paste** reads, in order: Foli JSON, then HTML, then plain text (Ctrl/Cmd+Shift+V: plain
  text only). Foli JSON and plain text are fitted to the document by `fitPaste(state, content,
  word)`, HTML (read as schema v2) by `fitPastedV2` (see "Paste on v3" above), both validating
  as loading a document does; one that fails falls through to the next. Plain text becomes one
  paragraph per line, with the marks typing would get. A paste during a composition is
  ignored.
  - Content is **open** when no block boundary was copied: plain text, HTML without block
    elements, Foli JSON copied from inside one block. It always joins the text around the
    selection, so the target block keeps its type (text pasted into an empty heading stays a
    heading).
  - **Closed** content (whole blocks) pasted into an empty textblock replaces it, so a pasted
    heading stays a heading. Elsewhere its first and last blocks join the text around the
    selection; text after the selection then ends up in the last pasted block (ProseMirror's
    open-slice behaviour). An opaque block at either end has no inside to join, so then the
    blocks go in whole (`insertBlocks`): before or after the caret's paragraph, else between
    its two halves.
  - A paste starts a new undo step; typing right after it (within the 500 ms grouping window)
    joins that step.
- **HTML reader** (`htmlToDoc`): the HTML is parsed with `DOMParser` into an inert document and
  never inserted. It builds blocks on a stack of containers. Known block tags become paragraphs
  or headings, with their `text-align` (or `align`), inherited by blocks inside; `ul`/`ol`/`li`
  become lists at any depth (`start` kept when the schema takes it; a list directly inside a
  list, as Google Docs writes nesting, goes into the previous item; an item gets a first
  paragraph when it has none, a heading becoming one); `hr` is a rule. Each list and item
  closes everything opened inside it, so unbalanced markup cannot leak into what follows.
  Word's list paragraphs (`<p style="mso-list:lN levelM">`, not headings, not inside an HTML
  list) become nested lists by level, numbered when their marker (the `mso-list:Ignore` span)
  ends in "." or ")" or is multi-level ("1.2"), starting at its last number. `a[href]` is a link when
  the href is safe (`isSafeHref`, after trimming and encoding spaces; `#…` anchors into the
  source document are dropped); inline `color`, `<font color>` and `background-color` become
  text color and highlight (hex, `rgb()` read by splitting, not a backtracking pattern, basic
  names; black text and white highlight are the defaults and dropped, white text too (dark
  pages), system colors such as `windowtext` and malformed values ignored), only on inline elements: a
  page's colored containers are layout. A link's underline and color are its look, dropped.
  `b/strong`, `i/em`, `u/ins`,
  `s/strike/del` and inline `font-weight`, `font-style` and `text-decoration` become marks
  (Google Docs' `<b style="font-weight:normal">` wrapper is honoured; a child's
  `text-decoration: none` keeps the parent's line, as in CSS). Whitespace collapses as in HTML
  layout, except in `pre` and `white-space: pre*`; non-breaking spaces become spaces. Hidden
  text (`display: none`, `hidden`, Word's `mso-hide: all`), scripts, styles, images, media, form
  controls, Word's list markers and empty `<o:p>` are dropped; everything else keeps only its
  text. Foli's own HTML (Word's, from copy) reads back with its headings, lists, links, colors
  and alignment; fonts, sizes and spacing are not read, and a rule (a paragraph's bottom
  border) does not read back as a rule. Between Foli editors the Foli JSON is read first.
  Fixtures: `packages/view/fixtures/clipboard/`.

## Packages

```
foli/
├── apps/playground/     Vite demo; consumes packages by name; no engine logic.
├── apps/site/           foli.josepaudenis.com: landing, the editor at /test/, the docs at /docs/ (private).
├── packages/
│   ├── core/  @folijs/core   Envelope, schema, immutable model, positions, slices. Pure TS, no DOM.
│   ├── view/  @folijs/view   Editable DOM view (EditorView). Framework-agnostic.
│   ├── react/ @folijs/react  React components + default stylesheet.
│   ├── docx/  @folijs/docx   DOCX import to Word's model (schema v5) and lossless export; package (zip, parts, relationships), XML keeping source text. No DOM.
│   └── pdf/   @folijs/pdf    exportPdf: a document printed by the app's headless Chromium page; ships the read-only renderer as a page script.
├── spikes/two-page/     Phase 1 spike; throwaway, never published.
├── examples/            Vite and Next.js apps installing the packed packages (6.4); never published.
└── docs/
```

Dependency direction: `playground → react → view → core`, `docx → core`, `pdf → core`
(and `view`, bundled at build time into `pdf`'s page script, `dist/renderer.js`), and
`playground → docx, pdf`. Never the reverse.

Planned, created only when needed:

| Package / folder           | When                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| `@folijs/layout`           | Split out of `@folijs/view` once the layout/view boundary is stable             |
| `@folijs/ui`               | Only if a non-React UI appears; until then the toolbar lives in `@folijs/react` |
| `crates/*`, `@folijs/wasm` | Only for a measured need                                                        |

## Dependency policy

- **Forbidden in published packages:** any editor engine (ProseMirror, Tiptap, Lexical, Slate,
  Quill, CKEditor, Draft.js, Editor.js …).
- **Allowed:** general-purpose libraries under permissive licenses (MIT, Apache-2.0, BSD, ISC),
  after checking size and whether existing code already covers the need.
- **Copied code:** only with provenance in `THIRD_PARTY_NOTICES.md` and preserved notices.
- Runtime dependencies today: none besides React (peer) and our own packages. `@folijs/pdf`
  needs the app's headless Chromium (Playwright or Puppeteer), which it does not depend on.
- Dev-only exception: `@axe-core/playwright` / `axe-core` (MPL-2.0) for the accessibility check
  in Playwright. Test tooling, never bundled or published.
- Dev-only: `pdfjs-dist` (Apache-2.0) renders Word's PDF pages in the corpus harness
  (`pnpm corpus:pages`, playground only) and Foli's own PDFs there and in `e2e/pdf.spec.ts`. Never bundled or published. Its optional Node
  canvas (`@napi-rs/canvas`, native binaries) is not installed (`ignoredOptionalDependencies`):
  the harness renders in the browser.
- Dev-only: `marked` (MIT, no dependencies) renders the docs site's markdown at build time, in
  the private `apps/site` only.

## Build and dev wiring

- Each package exports an `@folijs/source` condition pointing at `src/index.ts` (and core's
  `./internal` at `src/internal.ts`). Vite, Vitest and `tsc --noEmit` resolve it, so dev and tests
  run on source while importing by package name.
- `pnpm build` runs `tsc` per package (topological) to `dist/` with `.d.ts`; build configs drop
  the condition so published types point at `dist`.
- ESM-only, `sideEffects` declared (`@folijs/react`: its CSS only), `repository` per package (npm
  provenance checks that it matches the repository that built the package; `directory` links the
  package's folder). Peer dependencies: React and React DOM (18.2+ or 19) for `@folijs/react`, and
  since 12.2 (ADR-0008) `@folijs/core` for the other four and `@folijs/view` for `@folijs/react`,
  as `workspace:*` (published as the exact version), so an app has one copy of core.
  Exports: `.` (`types`, `default`), `@folijs/core/internal` (what the other packages need from
  core without a promise) and `@folijs/react/styles.css`; inside the workspace the
  `@folijs/source` condition also maps them to `src`, and `publishConfig.exports` leaves it out of
  the published packages. `build` empties `dist` first, so deleted modules are not shipped.
- `pnpm check` also runs `publint --strict` on every package (exports, `files`, types), `pnpm api`
  (each package's built `.d.ts` against its committed `api-report.d.ts`, forgotten exports, the
  published types compiled alone: [contributing.md](contributing.md#api-reports)) and
  `pnpm size`: each package's published entry bundled as an app would (fully minified, its
  Foli dependencies included, React external), and an app importing only `FoliEditor`, against
  gzip budgets in `scripts/size.mjs` (as of 0.6.0: core 85.9 kB, view 107.9 kB, react 151.4 kB,
  docx 57.0 kB, pdf 18.4 kB and its renderer bundle 95.2 kB; each raise and its reason is recorded
  there).
- `pnpm examples` installs the packed tarballs into `examples/vite` (React 18, strict
  TypeScript) and `examples/next` (React 19, server rendering) with npm, builds them, and runs
  the success criterion in Playwright; see [examples/README.md](../examples/README.md).

## Docs site (`apps/site`, 12.8)

The site (private, never published) is a Vite multi-page app: the landing page (`index.html`),
the real editor (`test/index.html`) and the docs under `/docs/`. The docs are not written for the
site: `src/docs/build.ts`, called by `vite.config.ts` before Vite reads its inputs (dev and
build), renders the repository's files to static HTML pages in `apps/site/docs/` (git-ignored),
which become Vite inputs:

- the pages listed in `src/docs/nav.ts`, in nav order: markdown files of `docs/` (getting
  started, guides, limitations, API, keyboard, architecture, contributing, ADRs…), one page per
  package's API report (`packages/<name>/api-report.d.ts`: each entry's exports, then each
  declaration by source file with its doc comment, tagged `internal` or `not exported` when it is
  not in the package's public entry), the five changelogs on one page, and the live examples
  (`src/examples/<name>.md` and `<name>.tsx`: the page shows the script that runs on it). A new
  page is a markdown file and one entry in `nav.ts`.
- Markdown by `marked` at build time: heading ids as GitHub makes them, so `file.md#heading`
  links work on both; a relative link to a page of the site goes there, to any other file to
  GitHub (`blob/main`); raw HTML in the markdown is shown as text. The build fails on a link to a
  heading that does not exist.
- Search: the build writes `docs/search.json` (headings h1–h3 and API names, about 67 kB, 11 kB
  gzipped), fetched on the first search; results are built with `textContent`.
- The examples (`FoliEditor`, a custom node with a node view and a toolbar button, a plugin with a
  command, a key and decorations) run the packages from source like the rest of the site; they
  use only the public API. In dev a changed markdown file, changelog, API report or example writes
  the pages again (a new page needs a restart).
- Tests: `src/docs/build.test.ts` (ids, links, raw HTML, report parsing) and `apps/site/e2e`
  (every nav page, links, API pages, search, keyboard, axe on the pages and the examples, light
  and dark, no sideways scroll at 375px), in three engines (`pnpm test:e2e --project=site-*`).

Deploying it is the owner's step ([contributing.md](contributing.md#the-site)).

## React integration (`@folijs/react`)

Uncontrolled: the engine owns document state; React observes. `initialContent` is read once;
external replacement goes through an imperative `setDocument()`. No fully controlled `value`
prop: feeding the whole document back on every keystroke defeats incremental rendering.
The view owns its DOM subtree; React never renders children into it. Built in 6.1 (API not
stable before 1.0):

- `useFoliEditor({ initialContent, plugins })`: a headless `Editor` (`initialContent` of any
  version, migrated by `createEditor`) created on the first render and kept for the component's lifetime (later options are ignored; StrictMode's extra
  initializer call only creates a discarded editor, which has no side effects).
- `FoliEditorProvider` / `useCurrentEditor()`: the editor for a subtree (throws outside one).
- `FoliCanvas`: the editable pages for an editor (prop or context): creates the `EditorView` in
  a layout effect, destroys it on unmount or when the editor changes, passes `readOnly` and
  `placeholder` to every view it creates; `label` names the textbox.
- `useEditorState(selector, { editor, isEqual })`: `useSyncExternalStore` over
  `editor.subscribe`; the selected value is cached per state and selector, and an equal one
  (`isEqual`, default `Object.is`) keeps its identity, so the component re-renders only when
  its slice changes. The selector runs after every transaction and after `setDocument`.
- `FoliEditor`: `useFoliEditor` + provider + `FoliToolbar` (unless `toolbar={false}`, disabled
  when `readOnly`) + canvas, `children` rendered between the toolbar and the pages inside the
  provider. A `ref` gives `{ editor, focus() }` (`FoliCanvas`'s ref: `{ focus() }`), so a parent
  can load a document (`setDocument`) or run commands. `onChange(change)` fires after
  transactions that change the content (not
  selection-only ones, nor `setDocument`) with `{ editor, transactions, document }`.
  `document` is the v3 document right after that change (the change keeps the immutable state:
  its content and the envelope in its word plugin state),
  serialized on first read, so an app that saves later (the playground: after a 300 ms pause)
  pays nothing per keystroke.
- **Replacing the document (6.3):** `editor.setDocument(doc)` (e.g. through `FoliEditor`'s
  `ref`) validates the content, applies the new page settings, starts a new history (nothing to
  undo; the old document cannot come back) and puts the selection at the start; the view
  renders every block again and flows the pages synchronously. It notifies subscribers, so
  `useEditorState` re-renders, but `onChange` is not called: the caller has the document. The
  playground's "Open…" button loads a JSON file this way and then saves it itself.
- **Server rendering (6.3):** every package imports in Node without a DOM (nothing touches
  `document` or `window` at import time). `renderToString(<FoliEditor />)` gives the shell: the
  toolbar and an empty labelled `role="textbox"`; the view fills it in a layout effect after
  hydration, with no hydration mismatch (tested with `hydrateRoot`). Layout effects go through
  `useIsomorphicLayoutEffect` (`useEffect` where there is no `document`), so React 18 does not
  warn during server rendering; React 18 itself is exercised by the 6.4 example apps.
- `FoliToolbar` (6.2; Word's controls since 8.7b): paragraph style, font and font size boxes;
  bold, italic, underline, strikethrough; link (a dialog, also on Mod-K in the document); text
  color and highlight menus; align left, center, right, justify; line spacing; bulleted and
  numbered lists, decrease and increase indent; undo, redo; the table group (10.7d: a Table menu
  button whose WAI-ARIA menu runs Insert table… (a dialog for rows and columns, within Word's
  limits), insert row above or below, insert column left or right, delete rows, columns or the
  table, merge cells, split cell and the "Repeat as header row" checkbox item, each
  `aria-disabled` where it cannot apply, from a dry run when the menu opens; a table style box;
  a cell shading menu of light fills); Picture… (10.8e: a dialog inserting a picture from a
  file through the `upload` prop, alt text required unless decorative, or editing the selected
  picture's alt text and size, proportions kept); page break. Its state is one
  module-level `useEditorState` selector, compared item by item so typing does not re-render it:
  `aria-pressed` and the boxes' values from the marks, alignment, list and formatting at the
  selection (O(selection)), `aria-disabled` from cheap checks (undo/redo depth, a paragraph in
  the selection, whether it can be outdented), not command dry runs: `editor.can` builds the
  whole transaction, which over a select-all costs O(blocks) per keystroke.
  One tab stop (`role="toolbar"`, roving `tabindex`: arrows, Home, End, wrapping; with Alt, Ctrl
  or Meta the keys are the browser's; the last button reached by keyboard keeps the stop);
  disabled buttons stay focusable (`aria-disabled`, not `disabled`). `mousedown` is prevented,
  so a click leaves the focus and the selection in the document; a click while the document is
  not focused focuses it (`onClickCommand`, which `FoliEditor` sets), so the change is visible.
  Keyboard activation keeps the focus on the button, and Tab returns to the document at its
  selection; meanwhile a selected range is not highlighted (the view writes the DOM selection
  only into a focused host). `FoliToolbar` has no read-only state of its own: composed with
  `<FoliCanvas readOnly />` it needs `disabled` too (commands run through the editor, which
  code may always change). Buttons with a symbol (B, I, U, S, the color, alignment and list
  buttons) are named by `aria-label`; the others by their visible text (Link, Undo), so speech
  input matches what is on screen; the boxes are named by `aria-label`; every button has a
  `title`. Axe (scoped to the toolbar, editable and read-only) and keyboard-only flows run in
  Playwright in all three engines.
- Phase 11 adds menus of the same kind: Section (breaks, columns, a Page setup dialog), Header
  (open the header or footer, different first page and even pages, link to previous), Fields
  (page number, date, cross-reference dialog, table of contents, update, show codes), Navigate,
  Notes (insert, go between note and reference, a Note options dialog) and Controls (insert each
  kind, a properties dialog). `FoliNavigation` (11.11, inside `FoliEditor`) is the find, replace
  and go to panel, the bookmarks dialog and the outline, and takes Word's keys (Ctrl+F, Ctrl+H,
  Ctrl+G, F3, Shift+F3, Ctrl+Shift+F5) while the focus is in the document or its panels. Each
  menu and dialog is keyboard-usable and axe-clean in three engines.

## Styling

Plain CSS with custom properties (`--foli-*`) declared on `:root` and `:host` (page, canvas
and toolbar colors, `--foli-focus-ring`; [styling.md](styling.md)). Page geometry is applied in
`mm` from each section's page setup. In print the canvas chrome and the toolbar are hidden. No
CSS framework.

## Risk register

| Area                | Risk                                                                                                     | Mitigation                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Rendering approach  | Paragraph fragments across pages inside one `contenteditable` may break IME, selection or screen readers | Phase 1 spike before any view code; fallback approaches defined in ADR-0002                     |
| IME / mobile input  | Android and Safari composition behave differently; `beforeinput` unreliable on Android                   | Composition read-back + MutationObserver; automated Chromium IME tests; manual device checklist |
| Model correctness   | Data corruption from step or mapping bugs                                                                | Property-based tests on steps, mapping, undo; strict validation at load                         |
| Undo history        | Layout or programmatic changes leaking into history                                                      | Transaction metadata (`addToHistory`); tests per command                                        |
| Clipboard           | Office HTML is messy; unsafe HTML                                                                        | Own sanitizing parser to schema; fixture corpus; never insert raw HTML                          |
| DOM measurement     | Layout thrash; fonts/images not loaded                                                                   | Read-then-write per frame; reflow on font/image load                                            |
| Font metrics        | Different fonts per OS change pagination                                                                 | Bundled default font; pinned test environments; documented as environment-dependent             |
| Large documents     | O(n) measurement and DOM size                                                                            | Node-identity caches, incremental reflow; benchmarks before optimizing                          |
| Accessibility       | Custom input handling can break assistive tech                                                           | Keep native `contenteditable` semantics; screen-reader checks per release                       |
| DOCX                | Word layout not reproducible; spec is vast                                                               | Target content fidelity; real-world corpus; never claim full compatibility                      |
| Scope / maintenance | We own every editing bug                                                                                 | Gates, small feature set, tests first                                                           |
| Tooling             | TypeScript 7 (native) and Vite 8 are new majors                                                          | If a tool breaks, pin TypeScript 5.9 / Vite 7 rather than work around                           |
