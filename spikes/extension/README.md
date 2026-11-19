# Spike: a custom node and a custom mark (Phase 12.1)

Throwaway code. Never published; deleted when 12.3 and 12.4 build the real extension API.
Results live in [ADR-0008](../../docs/decisions/ADR-0008-1.0-contract-and-extensions.md).

An app outside the packages declares `acme:mention` (an inline leaf with `id` and `label`, drawn
as a chip `@label`) and `acme:topic` (a mark with `topic`) in `src/spec.ts`, with a plugin binding
Ctrl+Shift+M (insert a mention) and Ctrl+Shift+K (topic on the selection) in `src/extension.ts`.

The packages are not changed. `vite.config.ts` patches their source as it is served: the Word
schema gets the two types, and the editing renderer asks `globalThis.__foliSpikeViews` how to
draw them. That is the stand-in for 12.3's schema extension and 12.4's node and mark views.

`src/docx.ts` maps the custom content to Word's content controls and back on the document's
JSON (a tagged plain text control per node, a tagged rich text control per run of a mark).

## Run

```bash
pnpm --filter @folijs/spike-extension dev --port 5176  # http://localhost:5176
pnpm test:e2e --project="extension-*"     # the editor, three engines; writes out/*.docx
pnpm exec vitest run spikes/extension     # the .docx mapping, Foli to Foli
# With Word (Windows), after the e2e run: Word opens, edits and saves each file; Foli reads it.
FOLI_WORD=1 pnpm exec vitest run spikes/extension/src/word.test.ts
```
