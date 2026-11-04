# IME, dead keys and screen readers: manual checklist

Gate G3 needs these checks run by hand on real platforms: automation can only emulate IME in
Chromium (`apps/playground/e2e/ime.spec.ts`). Copy the results into
[ADR-0003](../decisions/ADR-0003-rendering-and-input.md) ("Manual results") with date, OS and
browser versions.

Page-break variants (composition at a fragment edge, a split paragraph read aloud) need
pagination and belong to gate G4.

## Setup

```bash
pnpm install
pnpm dev                     # playground at http://localhost:5173
pnpm dev --host              # also reachable from phones on the LAN
```

Press **Reset** in the playground bar before each row. "Pass" means:

- the text is right, with nothing duplicated or lost;
- the caret ends after the committed text;
- one Ctrl/Cmd+Z removes the whole composition and nothing else;
- reloading the page shows the same document;
- the DevTools console shows no `Foli:` warning.

## IME and dead keys

| Platform / browser | Input method                     | Case                                              | Result | Notes |
| ------------------ | -------------------------------- | ------------------------------------------------- | ------ | ----- |
| Windows / Chrome   | Microsoft Japanese IME           | compose + commit at the end of a paragraph        |        |       |
| Windows / Chrome   | Microsoft Japanese IME           | compose + commit in the middle of bold text       |        |       |
| Windows / Chrome   | Microsoft Japanese IME           | compose over a selection across two paragraphs    |        |       |
| Windows / Chrome   | Microsoft Japanese IME           | cancel a composition with Esc                     |        |       |
| Windows / Firefox  | Microsoft Japanese IME           | the first three rows above                        |        |       |
| Windows / Chrome   | Microsoft Pinyin (Chinese)       | compose + commit, pick a candidate with a number  |        |       |
| Windows / Firefox  | Microsoft Pinyin (Chinese)       | same                                              |        |       |
| Windows / Chrome   | Microsoft Korean IME             | type 한국어 then a space (syllable by syllable)   |        |       |
| Windows / Firefox  | Microsoft Korean IME             | same                                              |        |       |
| Windows / Chrome   | Spanish or US-International      | dead keys: `é ñ ü à`, then ´ + space for a lone ´ |        |       |
| Windows / Firefox  | Spanish or US-International      | same                                              |        |       |
| macOS / Safari     | Japanese – Romaji                | compose + commit; compose over a selection        |        |       |
| macOS / Safari     | Option+e e (dead key)            | type `é` in plain and in bold text                |        |       |
| macOS / Chrome     | Pinyin – Simplified              | compose + commit                                  |        |       |
| Android / Chrome   | Gboard (English, autocorrect on) | type, accept a suggestion, backspace a word       |        |       |
| Android / Chrome   | Gboard Japanese                  | compose + commit                                  |        |       |
| iOS / Safari       | Default keyboard                 | type, accept autocorrect, delete                  |        |       |

Known gap: a composition that inserts a line break or a new paragraph (some Android keyboards)
is discarded with a `Foli:` console warning. Record it if you see one.

## Screen readers

| Screen reader / browser | Case                                                                | Result | Notes |
| ----------------------- | ------------------------------------------------------------------- | ------ | ----- |
| NVDA / Firefox          | focus the editor: announced as an editable multi-line "Document"    |        |       |
| NVDA / Firefox          | read paragraph by paragraph and line by line; arrow through a word  |        |       |
| NVDA / Chrome           | same two rows                                                       |        |       |
| NVDA / Firefox          | type, Backspace, Ctrl+B: typed and deleted characters are announced |        |       |
| VoiceOver / Safari      | the rows above                                                      |        |       |
