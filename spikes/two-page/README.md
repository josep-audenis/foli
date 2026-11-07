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
