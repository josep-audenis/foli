# Third-party notices

Foli's code is its own (see [ADR-0002](docs/decisions/ADR-0002-own-editing-engine.md)). This file
records code that is copied or closely derived from other projects, with provenance and the
original license notice.

## Tinos (test-only font)

- **Source:** the `@fontsource/tinos` npm package (5.3.0, a root dev dependency), from
  https://github.com/googlefonts/tinos.
- **License:** SIL Open Font License 1.1 (the package's `LICENSE` file).
- **Used in:** `apps/playground/e2e/fixtures.ts`, which serves the Latin faces to the
  playground during Playwright runs so page breaks and screenshots are deterministic. Foli
  does not ship or load any font; nothing of it is in a published package.

## prosemirror-model

- **Source:** https://github.com/ProseMirror/prosemirror-model (`src/replace.ts`), studied as
  published in the 1.x line; no specific commit was copied from.
- **License:** MIT (notice below).
- **Used in:** `packages/core/src/model/replace.ts`.
- **What:** the structure of the replace algorithm (recursive descent to the shared depth, then
  "two-way"/"three-way" joins of open nodes, with content validation of each rebuilt node) and
  its helper names. The code was written independently in Foli's own data structures
  (`ResolvedPos` with per-depth arrays, `Fragment.fromArray` normalization, `ReplaceError`); no
  file was copied verbatim. Recorded here because the result closely follows the original.

```
Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## prosemirror-transform, prosemirror-state, prosemirror-history, prosemirror-commands, prosemirror-schema-list

- **Source:** https://github.com/ProseMirror (the `prosemirror-transform`, `prosemirror-state`,
  `prosemirror-history`, `prosemirror-commands` and `prosemirror-schema-list` repositories),
  studied as published in their 1.x lines; no specific commit was copied from.
- **License:** MIT, same notice and copyright holders as prosemirror-model above.
- **Used in:** `packages/core/src/transform/` (`stepmap.ts`, `steps.ts`, `transform.ts`,
  `structure.ts`), `packages/core/src/model/` (`slice.ts`: `insertAt`/`removeBetween`,
  `content.ts`: `findWrapping`, `resolvedpos.ts`: `blockRange`/`NodeRange`) and
  `packages/core/src/state/` (`selection.ts`, `state.ts`, `history.ts`, `commands.ts`).
- **What:** the designs, written independently in Foli's own data structures:
  - Step maps with mirroring and position recovery, and replace/mark steps with exact inversion.
  - `ReplaceAroundStep` (a replace that keeps a gap of content) and structure steps that refuse
    to overwrite content; the wrap, lift, split and join transforms and their `findWrapping`,
    `liftTarget`, `canSplit` and `canJoin` checks.
  - `NodeSelection`, and non-inclusive marks when choosing the marks for typed text.
  - The list commands (`packages/core/src/state/lists.ts`): splitting, sinking and lifting list
    items with gap-replace steps, and lifting out of a list by merging the items first.
  - The addMark/removeMark range-collection algorithm.
  - Transaction selection mapping, plugin state fields with filter/append hooks.
  - Undo history built from inverted steps.
  - The `(state, dispatch?) => boolean` command signature.

  No file was copied verbatim. Foli differs in several ways:
  - `NodeMarkupStep` (and a batched form) instead of `AttrStep`.
  - Inserting a gap into a slice skips validating the slice's open nodes (the replace validates
    them once joined), so the inverse of a lift out of a list item applies.
  - History rebasing keeps a side per changed range of a step (two for `ReplaceAroundStep`).
  - History rebasing is per-event and eager, not ProseMirror's branch/item structure.
  - Deletion is grapheme- and word-aware via `Intl.Segmenter`.
