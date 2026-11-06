# Architecture

Foli is an open-source document-editing engine for the web: its own document model,
transactions, view and layout, designed around native pagination, with first-class React
integration. Decision record: [ADR-0002](decisions/ADR-0002-own-editing-engine.md).

This document describes **what exists** and **what is decided**. Planned parts are marked.

## Subsystems

```
┌──────────────────────────────────────────────────────────────┐
│ @foli/react   components · hooks · toolbar                   │
└──────────────────────────────┬───────────────────────────────┘
                               │ mounts, subscribes
┌──────────────────────────────▼───────────────────────────────┐
│ @foli/view    DOM rendering · input · selection · clipboard  │
│               layout & pagination                            │
└──────────────────────────────┬───────────────────────────────┘
                               │ dispatches transactions, renders state
┌──────────────────────────────▼───────────────────────────────┐
│ @foli/core    schema · nodes · positions · steps · mapping   │
│               state · history · commands        (no DOM)     │
└──────────────────────────────▲───────────────────────────────┘
                               │ same JSON format
┌──────────────────────────────┴───────────────────────────────┐
│ Rust (later)  DOCX import/export · batch processing · WASM   │
│               never on the keystroke path                    │
└──────────────────────────────────────────────────────────────┘
```

| Subsystem           | Responsibility                                                                 | Status                                                 |
| ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Document model      | Schema, immutable tree, marks, positions, JSON, validation                     | ✅ (Phase 2)                                           |
| Editing engine      | Steps, position mapping, selection, state, history, commands                   | ✅ headless (Phase 3)                                  |
| View                | Render state to DOM, DOM ↔ model mapping, `beforeinput`, IME, clipboard, focus | ✅ (G3 provisional; manual IME/SR checks open)         |
| Layout              | Measurement, line breaking, page flow, fragments, incremental reflow, print    | Phase 5 (inside `@foli/view` until the seam is proven) |
| React integration   | Components, hooks, toolbar                                                     | Editable `DocumentEditor` ✅; API: Phase 6             |
| Document processing | DOCX/HTML interop, Rust/WASM                                                   | Phase 10                                               |

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

## Editing engine (`@foli/core`)

Implemented headless in Phase 3 (`packages/core/src/transform/`, `packages/core/src/state/`).
The design follows prosemirror-transform, -state, -history and -commands (MIT); the code is
Foli's own (see `THIRD_PARTY_NOTICES.md`).

- **Steps** change the document atomically and are invertible: `ReplaceStep`, `AddMarkStep`,
  `RemoveMarkStep` and `NodeMarkupStep`. `NodeMarkupStep` handles type and attribute changes that
  keep inner positions; it replaces the planned `AttrStep`. A failing step returns a failed
  `StepResult`; `Transform.step` throws `TransformError` and leaves the transform unchanged.
- **Mapping**: each step has a `StepMap`. `Mapping` chains them, with association bias, deletion
  detection, and mirrored maps that recover positions inside re-inserted content.
- **Transform helpers**: replace/delete/insert/insertText, addMark/removeMark (exactly
  invertible), split, join (only between two textblocks), setBlockType, setNodeMarkup.
- **State**: an immutable `EditorState` holds the doc, selection, stored marks and plugin fields.
  A `Transaction` adds selection tracking, stored marks and metadata (`addToHistory`, time).
  Selections are `TextSelection` and `AllSelection`; `NodeSelection` waits for a block leaf node.
- **Plugins** (internal API, used by history and keymaps): state fields, `filterTransaction`,
  `appendTransaction`, `keymap`.
- **History**: undo/redo of inverted steps.
  - Changes are grouped by time (500 ms) and adjacency; consecutive typing collapses into one step.
  - Formatting and block-type changes get their own undo steps.
  - The selection is restored on undo.
  - Changes with `addToHistory: false` are rebased into the stored events.
    - Each rebased step is applied to a running copy of the document and dropped if it no longer
      applies. A step whose target node was deleted is dropped.
    - Positions keep the side of each original step's changed range they were on, so a deletion
      right next to re-inserted content cannot move them across it.
    - Property tests cover recorded edits interleaved with unrecorded marker insertions and
      deletions and with plugin reactions. Arbitrary unrecorded edits that overlap recorded
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
- **Headless editor**: `createEditor({ document })` returns `commands.*`, `run`, `can`,
  `handleKey`, `select`, `getDocument`, `setDocument` and `subscribe`.

Known limits:
- No general slice fitting: paste (Phase 4.3) joins open content or replaces an empty textblock
  with whole blocks; fitting blocks into nested structures comes with lists (Phase 7).
- Splits one level only (lists, Phase 7).
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
- Plugins, `Transaction` metadata and mapping internals are exported but not yet a stable API.

## Editor view (`@foli/view`)

`packages/view/src/view.ts`, design per ADR-0003: one `contenteditable` host holding real pages.
Phase 5 in progress: blocks flow from page to page (5.1) and split across pages at a line
(5.2); rules, incremental reflow and print follow.

- `new EditorView(host, editor, { editable, placeholder })` renders the state of a core
  `Editor` into `host` and subscribes to it. Edits go through `editor.dispatch`, so history,
  plugins and subscribers see every change. `setOptions()` changes the options; `destroy()`
  detaches the view and removes every attribute it added.
- **Descriptors:** one per block (model node, its elements, leaves) and one per inline leaf
  (text node or hard break with its offset in the block). A block split across pages has one
  element per page (`fragments`, with `splits` = the content offsets where each later one
  starts); a text node crossing a split is two leaves. `posFromDOM` / `domFromPos` map through
  them; the DOM is never parsed for content.
  - An element point maps to the start of the first leaf at or after it, else the block end.
  - At a mark boundary the caret is placed in the text before it, matching the marks typed text
    gets.
  - Empty blocks and blocks ending in a hard break get an extra `<br>` without a descriptor.
- **Rendering:** blocks whose model node is unchanged (same identity) keep their DOM; changed
  blocks are rebuilt; stray DOM is removed. Built with `createElement`/`textContent` only.
- **Pages:** the host's only children are `section.foli-page` elements. Each gets the
  document's page size (`width`, `min-height`) and margins (`padding`) inline in mm, from
  `editor.settings`; the theme adds the background, shadow and gap. Blocks are page children.
  - Every render places blocks where they were (a new block joins the page of the block
    before it), measures each block's border-box height and vertical margins in place, and
    flows them with the pure `flow` (`src/layout/flow.ts`): CSS margin collapsing between
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
    break the IME); the next render after it flows. Web fonts finishing loading (`document.fonts`
    `loadingdone`) trigger a re-flow.
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
- Pages: no widow/orphan or keep-with-next rules yet, so a split can leave one line alone on a
  page (5.3). Every render measures every block, and the lines of each block that crosses a
  page (O(document) per keystroke; cache and partial reflow in 5.4). Line measurement assumes
  left-to-right text without vertical-align offsets; block padding and borders are not split
  (a fragment keeps both). Justified text would need `text-align-last` on continued fragments
  (alignment arrives in Phase 7). Page breaks depend on the
  fonts installed (a bundled test font arrives with the fixtures, 5.5). Negative block margins
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
- Paste keeps only schema v1: links keep their text, lists and table cells become paragraphs,
  images and colors are dropped. The fixture corpus is hand-written approximations; real Word,
  Google Docs and LibreOffice captures are part of the open manual checks (ADR-0003).
- Content the schema cannot fit at the selection is not pasted (only possible once nested
  blocks exist).
- The placeholder stylesheet is added when a placeholder is first shown, to the host's shadow
  root or the document head; a host moved into a shadow root after that keeps no styles there.
- The placeholder stylesheet is an inline `<style>`: a Content Security Policy without
  `'unsafe-inline'` for styles blocks it, and the placeholder is not shown (`aria-placeholder`
  still is announced).
- Assumes schema v1 depth (doc > textblock > inline).

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
    open-slice behaviour).
  - A paste starts a new undo step; typing right after it (within the 500 ms grouping window)
    joins that step.
- **HTML reader** (`htmlToDoc`): the HTML is parsed with `DOMParser` into an inert document and
  never inserted. Known block tags become paragraphs or headings; `b/strong`, `i/em`, `u/ins`,
  `s/strike/del` and inline `font-weight`, `font-style` and `text-decoration` become marks
  (Google Docs' `<b style="font-weight:normal">` wrapper is honoured; a child's
  `text-decoration: none` keeps the parent's line, as in CSS). Whitespace collapses as in HTML
  layout, except in `pre` and `white-space: pre*`; non-breaking spaces become spaces. Hidden
  text (`display: none`, `hidden`, Word's `mso-hide: all`), scripts, styles, images, media, form
  controls, Word's list bullets and empty `<o:p>` are dropped; everything else keeps only its
  text. Fixtures: `packages/view/fixtures/clipboard/`.

## Packages

```
foli/
├── apps/playground/     Vite demo; consumes packages by name; no engine logic.
├── packages/
│   ├── core/  @foli/core   Envelope, schema, immutable model, positions, slices. Pure TS, no DOM.
│   ├── view/  @foli/view   Editable DOM view (EditorView). Framework-agnostic.
│   └── react/ @foli/react  React components + default stylesheet.
└── docs/
```

Dependency direction: `playground → react → view → core`. Never the reverse.

Planned, created only when needed:

| Package / folder         | When                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| `spikes/two-page/`       | Phase 1, throwaway, never published                                           |
| `@foli/layout`           | Split out of `@foli/view` once the layout/view boundary is stable             |
| `@foli/ui`               | Only if a non-React UI appears; until then the toolbar lives in `@foli/react` |
| `crates/*`, `@foli/wasm` | Phase 10                                                                      |
| `examples/`              | Phase 6 (Vite and Next.js install tests)                                      |

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

- Each package exports an `@foli/source` condition pointing at `src/index.ts`. Vite, Vitest and
  `tsc --noEmit` resolve it, so dev and tests run on source while importing by package name.
- `pnpm build` runs `tsc` per package (topological) to `dist/` with `.d.ts`; build configs drop
  the condition so published types point at `dist`.
- ESM-only, `sideEffects` declared, React as a peer dependency.

## React integration (target)

Uncontrolled: the engine owns document state; React observes. `initialContent` is read once;
external replacement goes through an imperative `setDocument()`. No fully controlled `value`
prop: feeding the whole document back on every keystroke defeats incremental rendering.
The view owns its DOM subtree; React never renders children into it.

## Styling

Plain CSS with custom properties (`--foli-*`) on `.foli-canvas`. Page geometry is applied in
`mm` straight from document settings. No CSS framework.

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
