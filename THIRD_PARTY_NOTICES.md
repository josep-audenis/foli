# Third-party notices

Foli's code is its own (see [ADR-0002](docs/decisions/ADR-0002-own-editing-engine.md)). This file
records code that is copied or closely derived from other projects, with provenance and the
original license notice.

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
