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

| Subsystem           | Responsibility                                                                 | Status                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Document model      | Schema, immutable tree, marks, positions, JSON, validation                     | ✅ (Phase 2); schema v3 (Word model) defined beside v2 (8.3)                                                                                |
| Editing engine      | Steps, position mapping, selection, state, history, commands                   | ✅ headless (Phase 3)                                                                                                                       |
| View                | Render state to DOM, DOM ↔ model mapping, `beforeinput`, IME, clipboard, focus | ✅ (G3 provisional; manual IME/SR checks open)                                                                                              |
| Layout              | Measurement, line breaking, page flow, fragments, incremental reflow, print    | Phase 5 (inside `@folijs/view` until the seam is proven)                                                                                    |
| React integration   | Components, hooks, toolbar                                                     | Hooks, provider, canvas, `FoliEditor` ✅ (6.1); toolbar ✅ (6.2)                                                                            |
| Document processing | DOCX import/export with lossless round trip (`@folijs/docx`)                   | Package and XML reading ✅ (8.2), import to v3 ✅ (8.4), lossless export ✅ (8.5) ([ADR-0005](decisions/ADR-0005-word-compatible-model.md)) |

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
  Selections are `TextSelection`, `NodeSelection` (one selectable node, e.g. a rule) and
  `AllSelection`. Deleting a node-selected block that its parent cannot lose (its only child)
  leaves an empty paragraph where the parent takes one; otherwise the delete does not apply
  (e.g. the only item of a list). Typing over a node-selected block replaces it with a
  paragraph of the text; Enter adds a paragraph after it.
- **Plugins** (internal API, used by history and keymaps): state fields, `filterTransaction`,
  `appendTransaction`, `keymap`.
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
  - splitBlock: Enter at the end of a heading starts a paragraph, and formatting carries over.
  - Formatting and selection: toggleMark, setBlockType, selectAll, undo, redo, plus `isMarkActive`.
  - `baseKeymap()` binds them to key names (`Mod-b`, `Enter`…).
  - Formatting (7.7, `state/format.ts`): `setAlign` (`Transform.setBlockAttrs`: the attribute
    on every textblock whose type declares it, one step), `setTextColor` / `setHighlight`
    (a color mark, replacing the one there; `null` removes; stored marks at a caret),
    `alignAt` / `colorAt` for the toolbar, `insertHorizontalRule` (before a textblock at its
    start, after it at its end with a new paragraph, splitting it in the middle).
  - Rules have no caret stop: `arrowAcrossLeaf(dir, from)` selects a rule from a caret at
    the edge of the textblock beside it (Left/Right in `baseKeymap`; Up/Down when the view
    finds the caret on the block's first or last line, from the caret's and the lines' client
    rects) and leaves a selected rule to the text beside it, crossing container boundaries.
  - Links (7.6, `state/links.ts`): `setLink`, `removeLink`, `insertLink`, `linkAt`, with
    `normalizeHref` before `isSafeHref` at every entry (command, dialog, paste); a caret at a
    link's edge edits that link. Mod-K is `openLinkEditor`: core has no UI, so it dispatches
    an empty transaction with `linkEditorRequest` metadata, and `FoliToolbar` (subscribed to
    the editor) opens its dialog. The link button runs the same command, so both paths meet.
  - Lists (7.5, `state/lists.ts`): `toggleList`, `wrapInList`, `splitListItem` (Enter; on an
    empty item, lift it), `sinkListItem` (Tab: into a sublist of the item before, joining one
    that ends it), `liftListItem` (Shift+Tab: into the outer list, or out of a top-level list,
    splitting it; a numbered list after the lifted items goes on counting),
    `liftListItemAtStart` (Backspace at an item's start). A selection that runs past the list
    around its start is cut at that list's end. `toggleList` off lifts the items of the
    innermost list of its type the selection touches, again until none is left (items of an
    outer list that are not selected stay). Enter over a range across items deletes it, then
    splits. `listKeymap()` binds them before `baseKeymap()`; Tab outside a list is not taken.
    Each list change closes the history event before it (own undo step). `joinBackward` after
    a list joins into its last textblock (or deletes a rule ending it); `joinForward` before
    one, or at the end of an item's last block (the next item, or what follows the list),
    pulls the next first textblock in (removing the item, and the list, it leaves empty),
    unless that item goes on with more blocks.
- **Headless editor**: `createEditor({ document })` returns `commands.*`, `run`, `can`,
  `handleKey`, `select`, `getDocument`, `setDocument` and `subscribe`.

Known limits:
- No general slice fitting: paste joins open content, replaces an empty textblock with whole
  blocks, and fits lists and rules as whole blocks at the caret (7.8); see Clipboard below.
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

## Editor view (`@folijs/view`)

`packages/view/src/view.ts`, design per ADR-0003: one `contenteditable` host holding real pages;
nested blocks per ADR-0004 (7.3).
Built in Phase 5 (gate G4 passed provisionally): blocks flow from page to page (5.1) and split
across pages at a line (5.2), with pagination rules (5.3), incremental reflow (5.4), print (5.6)
and benchmarks (5.7, [benchmarks.md](benchmarks.md)); overview in [pagination.md](pagination.md).

- `new EditorView(host, editor, { editable, placeholder })` renders the state of a core
  `Editor` into `host` and subscribes to it. Edits go through `editor.dispatch`, so history,
  plugins and subscribers see every change. `setOptions()` changes the options; `destroy()`
  detaches the view and removes every attribute it added.
- **Blocks are the leaf blocks at any depth** (paragraphs, headings, rules), in document order,
  each with its position and the chain of containers around it (lists, list items). The flow,
  the measurement cache and the line measurement see only these blocks (ADR-0004).
  - **Containers per page:** `place` puts each block fragment into its page inside `ul`/`ol`/`li`
    elements for its containers (`data-foli-wrapper`; the view tracks the elements it created,
    so a pasted or foreign element with the attribute is stray DOM, not a container), reusing the container elements already
    at the same place on the page (same tag, in order), so typing in a list moves no DOM. A list
    continued on the next page gets new containers there; an item continued from the previous
    page shows no marker (`list-style-type: none` inline); ordered list items carry their number
    (`value`), so numbering continues. Containers get block margins and paddings of 0 inline:
    the blocks' margins then collapse through them as between siblings, which the flow assumes.
  - **Block leaves** (`<hr>`) have no leaves or lines: never split, moved whole. A click on one
    selects it as a `NodeSelection`, shown as a DOM range around the element plus the class
    `foli-selected-node`, and read back as a node selection.
  - **Marks with attributes:** a link is an `<a href>` (validated by the schema) that does not
    navigate on click (Ctrl/Cmd+click opens the model's href in a new tab, `noopener`); text color and highlight are spans with `color` / `background-color`.
    Alignment is `text-align` on the block (`start` is the default and is not written).
  - Copy renders the same structures (`renderTree`: real nested lists, `start` on ordered
    lists, without the view's attributes).
- **Descriptors:** one per block (model node, its elements, leaves) and one per inline leaf
  (text node or hard break with its offset in the block). A block split across pages has one
  element per page (`fragments`, with `splits` = the content offsets where each later one
  starts); a text node crossing a split is two leaves. `posFromDOM` / `domFromPos` map through
  them; the DOM is never parsed for content.
  - An element point maps to the start of the first leaf at or after it, else the block end.
    A point in a page or container (between blocks) maps to the start of the next block
    fragment; a position between blocks maps to the start of the next block (before a rule).
  - At a mark boundary the caret is placed in the text before it, matching the marks typed text
    gets.
  - Empty blocks and blocks ending in a hard break get an extra `<br>` without a descriptor.
- **Rendering:** blocks whose model node is unchanged (same identity) keep their DOM; changed
  blocks are rebuilt; stray DOM is removed. Built with `createElement`/`textContent` only.
- **Pages:** the host's only children are `section.foli-page` elements. Each gets the
  document's page size (`width`, `min-height`) and margins (`padding`) inline in mm, from
  `editor.settings`; the theme adds the background, shadow and gap. Blocks are page children.
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
    nor where only an empty page could hold the lines); headings keep with the next block (a
    heading, or a chain of them, moves to the next page when the block after it would start
    there, unless it already starts its page; the flow restarts from a snapshot before it).
  - No reflow or re-split during a composition (moving the DOM the browser composes in would
    break the IME); the next render after it flows.
  - **Print (5.6):** the view keeps a `<style data-foli-print>` in the document's head (and
    in the shadow root holding the host, if any) with the page settings: `@page` of the page
    size without margins (the page's padding holds them); for this view's pages only (the
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
    size wins.
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
- **Input:** `keydown` → the plugin keymaps (as `editor.handleKey`, through the view's
  dispatch). Names are normalized as
  `Mod-Ctrl-Meta-Alt-Shift-key` (`Mod` = Cmd on Apple platforms, Ctrl elsewhere; non-Latin
  layouts fall back to the physical key). Everything else arrives as `beforeinput` and is always
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

### Word pages (`packages/view/src/word/`, 8.6b)

`renderDocumentV3(document, container, { review })` shows a schema v3 document on pages, as
Word lays it out; read-only until the editor moves to v3 (8.7).

- **Blocks** (`blocks.ts`): each paragraph's and run's formatting from core's `Resolver` as
  inline CSS, built with createElement and textContent only. Paragraphs with an outline level
  1-6 are `h1`-`h6`. List markers sit in the hanging indent. Fonts are listed with their
  metric-compatible substitutes (Calibri, Carlito; Cambria, Caladea; Arial, Liberation Sans;
  Times New Roman, Liberation Serif; Courier New, Liberation Mono; Georgia, Gelasio); Foli
  ships no font. Word's line spacing is a multiple of the font's own line height, measured in
  the page (`line-height: normal` of each font) and set per run. Tracked changes show as
  `ins`/`del` (`markup`) or are applied (`final`: deletions left out, a paragraph whose mark was
  deleted merged into the next). Commented text is shaded. Content the model keeps opaque is
  read from its XML with the browser's XML parser (an inert document; text, table structure,
  paragraph style and alignment, and basic run properties are read): a table as a table (grid,
  spans, margins, borders, shading, header rows), a content control or field as its text, a
  picture as nothing.
- **Pages** (`pages.ts`): sections in order (each its page size and margins; a continuous
  section with the same geometry goes on). The blocks are measured in a hidden page of the
  section's width; their lines are the clusters of their text's client rects. The pure `flow`
  places them with Word's spacing (`spacing: "word"`): the space after one paragraph and the
  space before the next add up, a page the text flowed onto drops the space before its first
  paragraph (a page an explicit break started keeps it), and the space after the last paragraph
  on a page may hang below it. Keep with next, keep lines together, page break before, explicit
  page breaks, widow and orphan control (two lines) apply; a table's header rows are repeated
  at the top of each page it continues on (`BlockBox.repeat`). A block split across pages is
  shown as a clip of the whole block per page.
- `pageOf(index)` and `lineOf(index)` give where a top-level node starts (the page, and the
  line on it as Word numbers lines); the corpus harness compares them with Word's
  (`pnpm corpus:pages`, numbers in corpus/README.md).

Not yet: headers and footers, footnotes, floating objects, columns, custom tab stops (default
stops every half inch), widow control turned off for one paragraph, right-aligned or centered
list numbers, and a marker wider than its hanging indent (Word moves the text to the next tab
stop). A table row splits between its lines.

### Clipboard (`packages/view/src/clipboard.ts`)

- **Copy and cut** come from the model, never from the DOM (ADR-0003 finding 5). The selected
  range is written as `text/plain` (blocks, hard and page breaks as line feeds), `text/html`
  (rendered by the view's own renderer, with `white-space: pre-wrap` so spaces survive in other
  apps, and page breaks as `<br data-page-break style="page-break-before: always; …">`) and
  `application/x-foli+json`: `{ open, content }`, the copied blocks as `DocJSON` and whether the
  copy was inside one block. Cut is copy plus `deleteSelection`, as its own undo step.
- **Paste** reads, in order: Foli JSON, then HTML, then plain text (Ctrl/Cmd+Shift+V: plain
  text only). Each candidate goes through `parseContent`, the same validation as loading a
  document; one that fails falls through to the next. Plain text becomes one paragraph per
  line, with the marks typing would get. A paste during a composition is ignored.
  - Content is **open** when no block boundary was copied: plain text, HTML without block
    elements, Foli JSON copied from inside one block. It always joins the text around the
    selection, so the target block keeps its type (text pasted into an empty heading stays a
    heading).
  - **Closed** content (whole blocks) pasted into an empty textblock replaces it, so a pasted
    heading stays a heading. Elsewhere its first and last blocks join the text around the
    selection; text after the selection then ends up in the last pasted block (ProseMirror's
    open-slice behaviour). Where the schema refuses that slice (a list pasted into a
    paragraph), the blocks go in whole (`insertBlocks`): a single list pasted into a list item
    joins that list (its items replace an empty item, or go before, after or between the
    item's halves); other blocks go before or after the caret's textblock, or replace it when
    empty, where its parent takes them (a list item's first paragraph stays first), else
    between its two halves.
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
  text. Copy writes the same structures (lists with `start`, links, colors, alignment, rules),
  so Foli's HTML reads back as the same document. Fixtures: `packages/view/fixtures/clipboard/`.

## Packages

```
foli/
├── apps/playground/     Vite demo; consumes packages by name; no engine logic.
├── packages/
│   ├── core/  @folijs/core   Envelope, schema, immutable model, positions, slices. Pure TS, no DOM.
│   ├── view/  @folijs/view   Editable DOM view (EditorView). Framework-agnostic.
│   ├── react/ @folijs/react  React components + default stylesheet.
│   └── docx/  @folijs/docx   DOCX import to schema v3; package (zip, parts, relationships), XML keeping source text. No DOM.
└── docs/
```

Dependency direction: `playground → react → view → core`, and `docx → core`. Never the reverse.

Planned, created only when needed:

| Package / folder           | When                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| `spikes/two-page/`         | Phase 1, throwaway, never published                                             |
| `@folijs/layout`           | Split out of `@folijs/view` once the layout/view boundary is stable             |
| `@folijs/ui`               | Only if a non-React UI appears; until then the toolbar lives in `@folijs/react` |
| `crates/*`, `@folijs/wasm` | Only for a measured need                                                        |
| `examples/`                | Phase 6 (Vite and Next.js install tests)                                        |

## Dependency policy

- **Forbidden in published packages:** any editor engine (ProseMirror, Tiptap, Lexical, Slate,
  Quill, CKEditor, Draft.js, Editor.js …).
- **Allowed:** general-purpose libraries under permissive licenses (MIT, Apache-2.0, BSD, ISC),
  after checking size and whether existing code already covers the need.
- **Copied code:** only with provenance in `THIRD_PARTY_NOTICES.md` and preserved notices.
- Runtime dependencies today: none besides React (peer) and our own packages.
- Dev-only exception: `@axe-core/playwright` / `axe-core` (MPL-2.0) for the accessibility check
  in Playwright. Test tooling, never bundled or published.

## Build and dev wiring

- Each package exports an `@folijs/source` condition pointing at `src/index.ts`. Vite, Vitest and
  `tsc --noEmit` resolve it, so dev and tests run on source while importing by package name.
- `pnpm build` runs `tsc` per package (topological) to `dist/` with `.d.ts`; build configs drop
  the condition so published types point at `dist`.
- ESM-only, `sideEffects` declared (`@folijs/react`: its CSS only), React and React DOM the only
  peer dependencies (18.2+ or 19), `repository` per package (npm provenance checks that it
  matches the repository that built the package; `directory` links the package's folder).
  Exports: `.` (`types`, `default`) and `@folijs/react/styles.css`; inside the workspace the
  `@folijs/source` condition also maps them to `src`, and `publishConfig.exports` leaves it out of
  the published packages. `build` empties `dist` first, so deleted modules are not shipped.
- `pnpm check` also runs `publint --strict` on every package (exports, `files`, types) and
  `pnpm size`: each package's published entry bundled as an app would (fully minified, its
  Foli dependencies included, React external), and an app importing only `FoliEditor`, against
  gzip budgets (6.4: core 14.1 kB, view 19.9 kB, react 25.3 kB; budgets about 15% above, in
  `scripts/size.mjs`).
- `pnpm examples` installs the packed tarballs into `examples/vite` (React 18, strict
  TypeScript) and `examples/next` (React 19, server rendering) with npm, builds them, and runs
  the success criterion in Playwright; see [examples/README.md](../examples/README.md).

## React integration (`@folijs/react`)

Uncontrolled: the engine owns document state; React observes. `initialContent` is read once;
external replacement goes through an imperative `setDocument()`. No fully controlled `value`
prop: feeding the whole document back on every keystroke defeats incremental rendering.
The view owns its DOM subtree; React never renders children into it. Built in 6.1 (API not
stable before 1.0):

- `useFoliEditor({ initialContent, plugins })`: a headless `Editor` created on the first render
  and kept for the component's lifetime (later options are ignored; StrictMode's extra
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
  `document` is the document right after that change (the change keeps the immutable state),
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
- `FoliToolbar` (6.2): bold, italic, underline, strikethrough; paragraph and heading levels
  1-3 (a pressed heading turns back into a paragraph); undo, redo; page break. Its state is one
  module-level `useEditorState` selector, compared item by item so typing does not re-render it:
  `aria-pressed` from the marks and block types of the selection (O(selection)), `aria-disabled`
  from cheap checks (undo/redo depth; marks, block types and page breaks always apply in schema
  v1), not command dry runs: `editor.can` builds the whole transaction, and a block-type dry run
  over a select-all costs O(blocks) per keystroke.
  One tab stop (`role="toolbar"`, roving `tabindex`: arrows, Home, End, wrapping; with Alt, Ctrl
  or Meta the keys are the browser's; the last button reached by keyboard keeps the stop);
  disabled buttons stay focusable (`aria-disabled`, not `disabled`). `mousedown` is prevented,
  so a click leaves the focus and the selection in the document; a click while the document is
  not focused focuses it (`onClickCommand`, which `FoliEditor` sets), so the change is visible.
  Keyboard activation keeps the focus on the button, and Tab returns to the document at its
  selection; meanwhile a selected range is not highlighted (the view writes the DOM selection
  only into a focused host). The paragraph and heading buttons are toggle buttons; pressing a
  pressed paragraph button does nothing. `FoliToolbar` has no read-only state of its own:
  composed with `<FoliCanvas readOnly />` it needs `disabled` too (commands run through the
  editor, which code may always change). Buttons with a symbol (B, I, U, S, ¶) are named by `aria-label`; the others
  by their visible text (H1, Undo), so speech input matches what is on screen; every button has
  a `title`. Axe (scoped to the toolbar, editable and read-only) and keyboard-only flows run in
  Playwright in all three engines.

## Styling

Plain CSS with custom properties (`--foli-*`) on `.foli-canvas` and `.foli-toolbar` (toolbar
colors and `--foli-focus-ring`). Page geometry is applied in `mm` straight from document
settings. In print the canvas chrome and the toolbar are hidden. No CSS framework.

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
