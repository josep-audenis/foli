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
| View                | Render state to DOM, DOM ↔ model mapping, `beforeinput`, IME, clipboard, focus | Editing slice ✅ (Phase 4.1); IME, clipboard: Phase 4  |
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
    joinBackward/Forward, insertHardBreak.
  - splitBlock: Enter at the end of a heading starts a paragraph, and formatting carries over.
  - Formatting and selection: toggleMark, setBlockType, selectAll, undo, redo, plus `isMarkActive`.
  - `baseKeymap()` binds them to key names (`Mod-b`, `Enter`…).
- **Headless editor**: `createEditor({ document })` returns `commands.*`, `run`, `can`,
  `handleKey`, `select`, `getDocument`, `setDocument` and `subscribe`.

Known limits:
- No general slice fitting (comes with paste in Phase 4).
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
- Selections snap out of surrogate pairs but not to full grapheme clusters; the view must place
  carets at cluster boundaries (Phase 4).
- Plugins, `Transaction` metadata and mapping internals are exported but not yet a stable API.

## Editor view (`@foli/view`)

Phase 4 in progress (`packages/view/src/view.ts`). Design per ADR-0003 (one `contenteditable`
host); pages and fragments arrive in Phase 5, so today the whole document is one continuous host.

- `new EditorView(host, editor)` renders the state of a core `Editor` into `host` and
  subscribes to it. Edits go through `editor.dispatch`, so history, plugins and subscribers see
  every change. `destroy()` detaches it.
- **Descriptors:** one per block (model node, element, leaves) and one per inline leaf (text
  node or hard break with its offset in the block). `posFromDOM` / `domFromPos` map through
  them; the DOM is never parsed for content.
  - An element point maps to the start of the first leaf at or after it, else the block end.
  - At a mark boundary the caret is placed in the text before it, matching the marks typed text
    gets.
  - Empty blocks and blocks ending in a hard break get an extra `<br>` without a descriptor.
- **Rendering:** blocks whose model node is unchanged (same identity) keep their DOM; changed
  blocks are rebuilt; stray DOM is removed. Built with `createElement`/`textContent` only.
- **Input:** `keydown` → the plugin keymaps (`editor.handleKey`). Names are normalized as
  `Mod-Ctrl-Meta-Alt-Shift-key` (`Mod` = Cmd on Apple platforms, Ctrl elsewhere; non-Latin
  layouts fall back to the physical key). Everything else arrives as `beforeinput` and is always
  prevented. It maps to commands: insertText, insertReplacementText (target range),
  insertParagraph, insertLineBreak, the delete types (target range, else by character or word),
  historyUndo/Redo, and format*.
- **Selection:** read from the live DOM before every key and input event (`selectionchange` is
  asynchronous) and on `selectionchange`, and compared with the model selection by position.
  A user caret move clears stored marks. The model selection is written back only when the DOM
  does not already show it, so native caret affinity survives. An `AllSelection` is shown as the
  text range between its ends.

Known limits (each is a later Phase 4 task in the roadmap):
- Composition and any other unprevented DOM change are discarded by re-rendering (no IME
  read-back yet, 4.2). A blur ends a composition the browser never closed.
- DOM changes that fire no `input` event (browser extensions, translation) are not detected:
  a reused block keeps the stale DOM its descriptors point into, and stray nodes before the
  first block shift host-level positions. The `MutationObserver` safety net is 4.2.
- Delete input types for whole lines rely on the browser's target range; without one they
  delete a character (4.4).
- Paste and drop do nothing; copy and cut use the browser's DOM serialization (4.3).
- No scroll-into-view after programmatic selection changes; no grapheme-cluster caret snapping (4.4).
- No read-only mode or placeholder (4.5).
- Assumes schema v1 depth (doc > textblock > inline).

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
