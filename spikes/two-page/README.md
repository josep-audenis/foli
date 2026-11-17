# Spike: two pages, one editable surface (Phase 1)

Throwaway code. Never published; deleted or rewritten when Phase 4 starts. Results live in
[ADR-0003](../../docs/decisions/ADR-0003-rendering-and-input.md).

One `contenteditable` host holds page containers. A paragraph that crosses a page boundary is
rendered as two `<p class="frag">` elements mapped to the same model paragraph. The toy model
(plain-text paragraphs) is the source of truth; the DOM is re-rendered after every edit, except
during IME composition, where the browser edits the DOM and the spike reads it back.

## Run

```bash
pnpm exec playwright install                           # once: download test browsers
pnpm --filter @folijs/spike-two-page dev --port 5174     # http://localhost:5174
pnpm --filter @folijs/spike-two-page dev --port 5174 --host          # also reachable from phones/other machines on the LAN
pnpm test:e2e --project="spike-*"                      # automated experiments, all three engines
```

`?pages=50` loads a ~50-page document. Paragraph 3 (approximately) is split across pages 1 and 2.

## Manual checklist (fill in, then copy results into ADR-0003)

For each row: put the caret in the **last line of page 1** of a split paragraph, or select across
the page boundary, as stated. "Pass" = text, caret and undo (Ctrl/Cmd+Z) are correct, and no
text is duplicated or lost. In DevTools, `__spike.state()` shows the model and
`__spike.warnings()` lists unexpected DOM changes.

### E3 IME and dead keys

| Platform / browser | Input method                     | Case                                        | Result | Notes |
| ------------------ | -------------------------------- | ------------------------------------------- | ------ | ----- |
| Windows / Chrome   | Microsoft Japanese IME           | compose + commit at end of page 1           |        |       |
| Windows / Chrome   | Microsoft Japanese IME           | compose over selection spanning both pages  |        |       |
| Windows / Firefox  | Microsoft Japanese IME           | compose + commit at end of page 1           |        |       |
| Windows / Chrome   | Microsoft Pinyin (Chinese)       | compose + commit at end of page 1           |        |       |
| Windows / Chrome   | Microsoft Korean IME             | type 한국어 across the boundary             |        |       |
| Windows / Chrome   | US-International dead keys       | type `é ñ ü` at end of page 1               |        |       |
| macOS / Safari     | Japanese – Romaji                | compose + commit at end of page 1           |        |       |
| macOS / Safari     | Japanese – Romaji                | compose over selection spanning both pages  |        |       |
| macOS / Safari     | Option+e e (dead key)            | type `é` at end of page 1                   |        |       |
| macOS / Chrome     | Pinyin – Simplified              | compose + commit at end of page 1           |        |       |
| Android / Chrome   | Gboard (English, autocorrect on) | type, accept a suggestion, backspace a word |        |       |
| Android / Chrome   | Gboard Japanese                  | compose + commit at end of page 1           |        |       |
| iOS / Safari       | Default keyboard                 | type, accept autocorrect, delete            |        |       |

### E5 spellcheck and autocorrect

| Platform / browser | Case                                                               | Result | Notes |
| ------------------ | ------------------------------------------------------------------ | ------ | ----- |
| Windows / Chrome   | misspelled word on page 1 and on page 2 is underlined              |        |       |
| Windows / Chrome   | right-click → replace spelling on page 2 (`insertReplacementText`) |        |       |
| Windows / Firefox  | same replacement                                                   |        |       |
| macOS / Safari     | same replacement; macOS autocorrect while typing                   |        |       |

### E6 screen readers

| Screen reader / browser | Case                                                              | Result | Notes |
| ----------------------- | ----------------------------------------------------------------- | ------ | ----- |
| NVDA / Firefox          | read the split paragraph line by line across the boundary         |        |       |
| NVDA / Chrome           | same; arrow down across the page boundary announces the next line |        |       |
| VoiceOver / Safari      | same                                                              |        |       |
| Any                     | is the split paragraph announced as one paragraph or two?         |        |       |

## Tables across pages (Phase 10.1)

`tables.html` is a static page: a table split across two pages in one editable host, its header
row repeated as non-editable content and one row split at a line. `e2e/tables.spec.ts` records
what Chromium, Firefox and WebKit do with caret movement, selection, clicks and Enter there; the
results and what follows from them are in [ADR-0006](../../docs/decisions/ADR-0006-tables-and-pictures.md).

## Floating pictures (Phase 10.9)

`floats.html` is a static page in one editable host: a picture wrapped square as a CSS float at
the start of its anchor paragraph (offset down by a zero-width spacer float, across by its
margin), a top-and-bottom picture as a float as wide as the column, and pictures behind and in
front of text absolutely positioned at their paragraph. `e2e/floats.spec.ts` checks, in
Chromium, Firefox and WebKit: lines beside the float shortened in its paragraph and the next,
and back at full width under it; ArrowDown reaching every such line without entering the
picture; a click and Home beside it landing on that line after it; typing beside it and right
after it leaving it in place; no line beside a top-and-bottom picture; full-width lines over a
picture behind or in front of text, with clicks reaching the text or the picture. All pass;
what they leave open (clicks on the picture and left of it, Backspace next to it, pages) and
the decision are in [ADR-0006](../../docs/decisions/ADR-0006-tables-and-pictures.md).
